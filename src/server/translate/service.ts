import { randomUUID } from 'node:crypto';
import type { GlossaryEntry, ProviderResult, TranslateProviderId, TranslateRequest, TranslationJob, ProviderTestResult } from '../../shared/types';
import type { Host, Run, Storage } from '../adapter/host';
import { AppError, errorInfo } from '../../shared/error-codes';
import { validateRequest } from './provider';
import { BaiduProvider } from './baidu';
import { DeepLProvider } from './deepl';
import { HostModelProvider } from './host-model';
import { OpenAIProvider } from './openai';
import { glossaryKey, normalizeGlossary, protectGlossary, restoreGlossary } from './glossary';
import { cacheKey, TranslationCache } from './cache';
import { TranslationHistory } from './history';
import { Vault } from '../vault/store';
import { bounded, retry } from '../retry';
export class TranslationService {
  private cache:TranslationCache;
  private historyStore:TranslationHistory;
  constructor(private host:Host,private store:Storage,private vault:Vault,private timeoutMs:number){
    this.cache=new TranslationCache(store);this.historyStore=new TranslationHistory(store);
  }
  bind(store:Storage){this.store=store;this.cache.bind(store);this.historyStore.bind(store);}
  async credentials() {
    try{return JSON.parse(await this.vault.get('translation')) as {appid:string;secret:string};}
    catch(e){if(e instanceof AppError&&e.code==='NOT_FOUND')return {appid:'',secret:''};throw e;}
  }
  async openaiCredentials() {
    try{return JSON.parse(await this.vault.get('openai')) as {baseUrl:string;apiKey:string};}
    catch(e){if(e instanceof AppError&&e.code==='NOT_FOUND')return {baseUrl:this.host.config.openaiBaseUrl||'',apiKey:this.host.config.openaiApiKey||''};throw e;}
  }
  async deeplCredentials() {
    try{return JSON.parse(await this.vault.get('deepl')) as {apiKey:string};}
    catch(e){if(e instanceof AppError&&e.code==='NOT_FOUND')return {apiKey:this.host.config.deeplApiKey||''};throw e;}
  }
  async providers(run?:Run,current?:any) {
    const [credentials,openai,deepl,settings]=await Promise.all([
      this.credentials(),
      this.openaiCredentials(),
      this.deeplCredentials(),
      current??this.store.get<any>('preferences').then(value=>value||{})
    ]);
    const openaiModel=settings.openaiModel||this.host.config.openaiModel||'';
    return [{id:'baidu',configured:!!(credentials.appid&&credentials.secret)},{id:'deepl',configured:!!deepl.apiKey},{id:'hostModel',configured:!!(settings.model||run?.host?.models?.respond)},{id:'openai',configured:!!(openai.baseUrl&&openaiModel&&(openai.apiKey||/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/)/i.test(openai.baseUrl)))}];
  }
  private async resolveProviderId(requested:TranslateRequest['provider'],settings:any):Promise<TranslateProviderId>{
    const supported:TranslateProviderId[]=['baidu','deepl','hostModel','openai'];
    return [requested,settings.provider,this.host.config.translateProvider]
      .find((value):value is TranslateProviderId=>supported.includes(value))||'hostModel';
  }
  private async makeProvider(providerId:TranslateProviderId,run:Run,settings:any,glossary:GlossaryEntry[]) {
    const credentials=providerId==='baidu'?await this.credentials():{appid:'',secret:''};
    const openai=providerId==='openai'?await this.openaiCredentials():{baseUrl:'',apiKey:''};
    const deepl=providerId==='deepl'?await this.deeplCredentials():{apiKey:''};
    const model=settings.openaiModel||this.host.config.openaiModel||'';
    const provider=providerId==='baidu'?new BaiduProvider(credentials.appid,credentials.secret):
      providerId==='deepl'?new DeepLProvider(deepl.apiKey):
      providerId==='openai'?new OpenAIProvider(openai.baseUrl,openai.apiKey,model,glossary):
      providerId==='hostModel'?new HostModelProvider(run.host.models.respond.bind(run.host.models),run.host.models.list?.bind(run.host.models),settings.model||''):(()=>{throw new AppError('VALIDATION',false,'configuration');})();
    const key=providerId==='openai'?`${openai.baseUrl}|${model}`:providerId==='baidu'?credentials.appid:
      providerId==='deepl'?deepl.apiKey.trim().endsWith(':fx')?'deepl-free':'deepl-pro':settings.model||'';
    return {provider,key};
  }
  async history(limit=20):Promise<TranslationJob[]> {return this.historyStore.list(limit);}
  async test(providerId:TranslateProviderId|undefined,run:Run):Promise<ProviderTestResult>{
    const settings=await this.store.get<any>('preferences')||{},glossary=normalizeGlossary(settings.glossary);
    const id=await this.resolveProviderId(providerId,settings);
    const {provider}=await this.makeProvider(id,run,settings,glossary);
    if(!provider.isConfigured())return {provider:provider.id,configured:false,ok:false,latencyMs:0,error:errorInfo(new AppError('VALIDATION',false,'configuration'))};
    const started=Date.now();
    try{
      const value=await bounded<ProviderResult>(signal=>provider.translate({text:'Hello world',from:'auto',to:'zh'},signal),run.signal,this.host.lifecycle,this.timeoutMs);
      return {provider:provider.id,configured:true,ok:true,latencyMs:value.latencyMs,sample:Array.from(value.translated).slice(0,200).join('')};
    }catch(error){return {provider:provider.id,configured:true,ok:false,latencyMs:Date.now()-started,error:errorInfo(error)};}
  }
  async cacheStats(){return this.cache.stats();}
  async clearCache(){return this.cache.clear();}
  async run(req:TranslateRequest,run:Run):Promise<TranslationJob>{
    validateRequest(req);
    const settings=await this.store.get<any>('preferences')||{},glossary=normalizeGlossary(settings.glossary);
    const providerId=await this.resolveProviderId(req.provider,settings);
    const {provider,key:providerKey}=await this.makeProvider(providerId,run,settings,glossary);
    if(!provider.isConfigured())throw new AppError('VALIDATION',false,'configuration');
    const key=cacheKey([providerId,providerKey,req.from,req.to,req.text,glossaryKey(glossary)]);
    if(!req.retryNonce){const hit=await this.cache.get(key);if(hit)return {...hit,cached:true};}
    const protectedText=protectGlossary(req.text,glossary);
    let attempts=0;
    const result=await retry(async(signal,attempt)=>{
      attempts=attempt;
      const value=await provider.translate({...req,text:protectedText.text},signal);
      return {...value,translated:restoreGlossary(value.translated,protectedText.tokens)};
    },run.signal,this.host.lifecycle,this.timeoutMs);
    const job:TranslationJob={id:randomUUID(),request:{text:req.text,from:req.from,to:req.to,provider:provider.id,retryNonce:req.retryNonce},status:'done',result,attempts,createdAt:Date.now()};
    await this.historyStore.add(job);await this.cache.put(key,job);return job;
  }
  async retry(id:string,provider:TranslateRequest['provider'],run:Run){
    const job=(await this.history(50)).find(j=>j.id===id);if(!job)throw new AppError('NOT_FOUND');
    return this.run({...job.request,provider:provider||job.request.provider,retryNonce:randomUUID()},run);
  }
}

import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateModel } from '../../sdk/harness/contracts.mjs';
import { contract } from './contract';
import { partition, scope, dataScope, configOf } from './adapter/host';
import type { Dispose, Host, Run, Storage } from './adapter/host';
import { Vault } from './vault/store';
import { TranslationService } from './translate/service';
import { normalizeGlossary } from './translate/glossary';
import { openaiEndpoint } from './translate/openai';
import { MailService } from './mail/service';
import { normalizeAppearance } from './appearance';
import { decodeAppearanceSave } from '../shared/appearance-wire';
import { AppearanceFiles } from './appearance-files';
import type { BackgroundSlot } from './appearance-files';
import { RssService } from './rss/service';
import { ImageProxy } from './media';
import { ImapConnector } from './mail/imap';
import type { Connector } from './mail/connector';
import { rpcNames, languages } from '../shared/rpc-contract';
import { normalizeNotifications } from '../shared/notifications';
import { normalizeMailBodyZoom } from '../shared/mail';
import { assert, AppError, errorInfo } from '../shared/error-codes';
import { bounded } from './retry';
import { logRecord,publishLog } from './log';
import type {LogRecord,LogLevel} from './log';
import {validateRpc} from './rpc/validate';
export { contract };
const canonical=(value:any)=>JSON.parse(JSON.stringify(value));
const appearanceSlot=(value:unknown):BackgroundSlot=>value==='mobile'?'mobile':'desktop';
const appearanceNameKey=(slot:BackgroundSlot)=>slot==='mobile'?'backgroundMobileName':'backgroundName';
export interface Dependencies {real?:Connector}
export function apply(ctx:Host,deps:Dependencies={}) {
  const config=configOf(ctx.config),real=deps.real||new ImapConnector(ctx.lifecycle,config.timeoutMs);
  const runtimes=new Map<string,Promise<ReturnType<typeof createRuntime>>>();
  const queues=new Map<string,Promise<unknown>>(), diagnostics=new Map<string,LogRecord[]>();
  // 后台轮询与交互请求分队列：轮询可被调度器取消或等待网络，不能阻塞页面读取本地缓存。
  const lane=(key:string,name:string,input?:any)=>{
    const group=name==='media.image'?'media:'+String(input?.url||''):name==='mail.poll'?'mail-poll':name==='rss.poll'?'rss-poll':
      name==='rss.entry.summarize'||name==='rss.digest.generate'?'rss-ai':
      name.startsWith('mail.')?'mail':name.startsWith('translate.')?'translate':
      name.startsWith('rss.')?'rss':name.startsWith('appearance.')?'appearance':'app';
    return key+':'+group;
  };
  const operations=new Map<string,AbortController>();
  // 内部异常日志：只保留错误类型与消息，并遮蔽邮箱地址，便于定位契约或存储问题。
  const detailOf=(error:unknown)=>{
    const raw=error instanceof Error?`${error.name}: ${error.message}`:String(error);
    const key=(error as {storeKey?:unknown})?.storeKey,bytes=(error as {storeBytes?:unknown})?.storeBytes;
    return (raw+(key?` storeKey=${String(key)} storeBytes=${String(bytes||0)}`:''))
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]+/gi,value=>value[0]+'***@'+value.split('@')[1])
      .replace(/\s+/g,' ').slice(0,240);
  };
  // 存储写入失败时附带键名与体积，便于定位宿主 2MB 单键上限。
  const tracked=(store:Storage):Storage=>({
    namespace:(...segments)=>tracked(store.namespace(...segments)),
    get:<T>(key:string)=>store.get<T>(key),
    delete:(key:string)=>store.delete(key),
    keys:()=>store.keys(),
    set:async(key:string,value:any)=>{
      try{await store.set(key,value);}
      catch(error){
        try{(error as any).storeKey=key;(error as any).storeBytes=Buffer.byteLength(JSON.stringify(value)||'');}catch{/* 忽略不可序列化的值。 */}
        throw error;
      }
    }
  });
  const appearanceFiles=new AppearanceFiles(ctx.paths.dataDir);
  const imageProxy=new ImageProxy(ctx.lifecycle);
  const diagnosticIdentities=32;
  function rememberDiagnostic(key:string,entry:LogRecord) {
    let entries=diagnostics.get(key);
    if(!entries){diagnostics.set(key,entries=[]);}
    entries.push(entry);if(entries.length>100)entries.shift();
    while(diagnostics.size>diagnosticIdentities){const oldest=diagnostics.keys().next().value;if(oldest===undefined)break;diagnostics.delete(oldest);}
  }
  const controller=new AbortController(),dispose=async()=>{controller.abort();real.close();appearanceFiles.dispose();imageProxy.clear();
    const active=[...runtimes.values()];runtimes.clear();queues.clear();
    await Promise.allSettled(active.map(async runtime=>{const value=await runtime;value.mail.close();value.rss.close();}));};
  const hostAbort=()=>dispose();ctx.signal.addEventListener('abort',hostAbort,{once:true});
  const resource=ctx.lifecycle.add(dispose);
  function createRuntime(store:ReturnType<typeof scope>,vault:Vault,key:string) {
    const translator=new TranslationService(ctx,store,vault,config.timeoutMs);
    const mail=new MailService(ctx,store,vault,real,translator,config.timeoutMs,config.maxBytes,key);
    const rss=new RssService(ctx,vault,join(ctx.paths.dataDir,key,'rss'),undefined,config.timeoutMs);
    return {store,vault,translator,mail,rss};
  }
  async function runtime(run:Run) {
    const key=partition(run);
    if(!runtimes.has(key)){
      const created=(async()=>{
        const store=tracked(dataScope(run)),vault=new Vault(join(ctx.paths.dataDir,key),ctx.config.vaultPassphrase);
        const result=createRuntime(store,vault,key);
        const legacy=scope(run);
        const [legacyPreferences,saved]=await Promise.all([legacy.get<any>('preferences'),legacy.get<any>('settings')]);
        // v2 命名空间首次启用时只搬运小对象；邮件与正文由 MailService 单独迁移。
        const currentPreferences=await store.get<any>('preferences');
        if(legacyPreferences&&!currentPreferences){
          const supported=['baidu','deepl','hostModel','openai'];
          const provider=supported.includes(legacyPreferences.provider)?legacyPreferences.provider:'hostModel';
          const cleaned={...legacyPreferences,provider};delete cleaned.mode;delete cleaned.initialized;
          await store.set('preferences',cleaned);
          await legacy.set('preferences',cleaned).catch(()=>{});
        }
        for(const name of ['history','translate-cache','appearance-bg-meta','appearance-bg-mobile-meta']){
          const value=await legacy.get(name).catch(()=>undefined);
          if(value!==undefined&&await store.get(name)===undefined)await store.set(name,value);
        }
        await result.mail.init(legacy);
        await Promise.all([store.delete('mode'),store.delete('initialized')]);
        // 迁移只读入宿主已绑定身份的旧键，密钥立刻转入 vault。
        if(saved?.appid&&saved?.secret){await vault.put('translation',JSON.stringify({appid:saved.appid,secret:saved.secret}));await store.set('settings',{appid:saved.appid,from:saved.from||'auto',to:saved.to||'zh'});}
        if(ctx.config.baiduAppId&&ctx.config.baiduSecret)await vault.put('translation',JSON.stringify({appid:ctx.config.baiduAppId,secret:ctx.config.baiduSecret}));
        if(ctx.config.openaiBaseUrl&&ctx.config.openaiApiKey)await vault.put('openai',JSON.stringify({baseUrl:ctx.config.openaiBaseUrl,apiKey:ctx.config.openaiApiKey}));
        if(ctx.config.deeplApiKey)await vault.put('deepl',JSON.stringify({apiKey:ctx.config.deeplApiKey}));
        return result;
      })().catch(error=>{runtimes.delete(key);throw error;});
      runtimes.set(key,created);
    }
    const result=await runtimes.get(key)!;
    // run.signal 只覆盖本次 RPC；存储必须逐次重新绑定，不能复用已结束调用的作用域。
    const activeStore=tracked(dataScope(run));
    result.store=activeStore;
    result.translator.bind(activeStore);
    result.mail.bind(activeStore);
    return result;
  }
  async function handle(name:string,input:any,run:Run,preferences:any) {
    validateRpc(name,input);
    assert(input===undefined||(input&&typeof input==='object'&&!Array.isArray(input)));input=input||{};
    const r=await runtime(run),{mail,translator,store,vault,rss}=r;
    const announceAppearance=(updatedAt:number)=>{try{run.messages.emit('appearance.updated',{eventId:randomUUID(),updatedAt},{audience:'plugin'});}catch{/* 通知失败不影响保存。 */}};
    switch(name){
      case 'app.bootstrap':{
        const [providers,accounts]=await Promise.all([translator.providers(run,preferences),mail.accounts()]);
        return {providers,accounts,languages,vaultWarning:!ctx.config.vaultPassphrase};
      }
      case 'translate.run':return translator.run(input,run);
      case 'translate.retry':assert(typeof input.jobId==='string');return translator.retry(input.jobId,input.provider,run);
      case 'translate.history':assert(input.limit===undefined||(Number.isInteger(input.limit)&&input.limit>0));return translator.history(input.limit);
      case 'translate.test':return translator.test(input.provider,run);
      case 'translate.cache-stats':return translator.cacheStats();
      case 'translate.cache-clear':return translator.clearCache();
      case 'mail.account.add':return mail.add({...input},run);
      case 'mail.account.rename':return mail.rename(input.accountId,input.alias);
      case 'mail.account.remove':return mail.remove(input.accountId);
      case 'mail.account.test':return mail.test(input.accountId,run);
      case 'mail.list':assert(input.accountIds===undefined||(Array.isArray(input.accountIds)&&input.accountIds.every((x:any)=>typeof x==='string')));return mail.list(input,run);
      case 'mail.get':return mail.get(input.accountId,input.messageId,run);
      case 'mail.unread-status':return mail.unreadStatus(input.accountId,input.messageIds);
      case 'mail.image-domains':return mail.imageDomains(input.accountId,input.messageId,run);
      case 'mail.images':return mail.loadImages(input.accountId,input.messageId,input.confirmed,input.allowedDomains,run);
      case 'media.image':assert(typeof input.url==='string');return {data:await imageProxy.load(input.url,run.signal)};
      case 'mail.attachment':return mail.attachment(input.accountId,input.messageId,input.attachmentId,run);
      case 'mail.reply':return mail.reply(input.accountId,input.messageId,input.body,run);
      case 'mail.draft.list':return mail.listDrafts();
      case 'mail.draft.get':return mail.getDraft(input.id);
      case 'mail.draft.save':return mail.saveDraft(input);
      case 'mail.draft.upload-start':return mail.draftUploads.start(input.bytes,input.kind);
      case 'mail.draft.upload-chunk':return mail.draftUploads.append(input.wire);
      case 'mail.draft.upload-drop':return mail.draftUploads.drop(input.uploadId);
      case 'mail.draft.commit':{
        const bytes=mail.draftUploads.complete(input.uploadId,'snapshot');
        let draft:unknown;
        try{draft=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));validateModel(contract,'mailDraftSaveInput',draft);validateRpc('mail.draft.save',draft);}
        catch{throw new AppError('VALIDATION');}
        const result=mail.saveDraft(draft as Parameters<typeof mail.saveDraft>[0]);
        mail.draftUploads.drop(input.uploadId);return result;
      }
      case 'mail.draft.delete':return mail.deleteDraft(input.id);
      case 'mail.delete':return mail.deleteMessage(input.accountId,input.messageId,run);
      case 'mail.send':return mail.sendDraft(input.id,run);
      case 'mail.mark-read':return mail.markRead(input.accountId,input.messageId,input.read,run);
      case 'mail.mark-all-read':assert(input.accountIds===undefined||(Array.isArray(input.accountIds)&&input.accountIds.every((x:any)=>typeof x==='string')));return mail.markAllRead(input.accountIds,run);
      case 'mail.bilingual':assert(languages.slice(1).includes(input.target));return mail.bilingual(input,run);
      case 'rss.bootstrap':return rss.bootstrap();
      case 'rss.folder.add':assert(typeof input.name==='string'&&input.name.trim().length>0&&input.name.length<=30);return rss.addFolder(input.name);
      case 'rss.folder.remove':assert(typeof input.id==='string');return rss.removeFolder(input.id);
      case 'rss.folder.reorder':assert(Array.isArray(input.ids));return rss.reorderFolders(input.ids);
      case 'rss.feed.add':assert(typeof input.url==='string');return rss.addFeed(input);
      case 'rss.feed.rename':assert(typeof input.id==='string'&&typeof input.title==='string'&&input.title.trim().length>0&&input.title.length<=120);return rss.renameFeed(input.id,input.title);
      case 'rss.feed.move':assert(typeof input.id==='string');return rss.moveFeed(input.id,typeof input.folderId==='string'&&input.folderId?input.folderId:undefined);
      case 'rss.feed.reorder':assert(Array.isArray(input.ids));return rss.reorderFeeds(input.ids);
      case 'rss.feed.remove':assert(typeof input.id==='string');return rss.removeFeed(input.id);
      case 'rss.feed.refresh':return rss.refresh(typeof input.id==='string'?input.id:undefined);
      case 'rss.entries.list':return rss.listEntries(input);
      case 'rss.entries.mark-all-read':return rss.markAllRead({
        folderId: typeof input.folderId==='string'&&input.folderId?input.folderId:undefined,
        feedId: typeof input.feedId==='string'&&input.feedId?input.feedId:undefined,
        view: typeof input.view==='string'?input.view:undefined,
        query: typeof input.query==='string'?input.query:undefined,
      });
      case 'rss.entry.get':assert(typeof input.id==='string');return rss.getEntry(input.id);
      case 'rss.entry.mark-read':assert(typeof input.id==='string'&&typeof input.read==='boolean');return rss.markRead(input.id,input.read);
      case 'rss.entry.star':assert(typeof input.id==='string'&&typeof input.starred==='boolean');return rss.star(input.id,input.starred);
      case 'rss.entry.summarize':assert(typeof input.id==='string');return rss.summarize(input.id,run,input.lang==='en'?'en':input.lang==='zh'?'zh':undefined);
      case 'rss.digest.get':{const digest=rss.getDigest();return digest?{digest}:{};}
      case 'rss.digest.generate':return rss.generateDigest(run,input.period==='week'?'week':'day');
      case 'rss.settings.get':return {settings:rss.getSettings(),aiConfigured:await rss.aiConfigured(run)};
      case 'rss.settings.save':{const settings=rss.saveSettings(input);return {settings,aiConfigured:await rss.aiConfigured(run)};}
      case 'rss.opml.import':assert(typeof input.content==='string');return rss.importOpml(input.content);
      case 'rss.opml.export':return rss.opmlExport();
      case 'settings.get':{
        const baidu=await translator.credentials(),openai=await translator.openaiCredentials(),providers=await translator.providers(run,preferences);
        const clean={...preferences};delete clean.mode;delete clean.initialized;
        const provider=['baidu','deepl','hostModel','openai'].includes(preferences.provider)?preferences.provider:'hostModel';
        return {...clean,provider,appid:baidu.appid,configured:providers.find(p=>p.id==='baidu')!.configured,openaiBaseUrl:openai.baseUrl,openaiModel:preferences.openaiModel||ctx.config.openaiModel||'',openaiConfigured:providers.find(p=>p.id==='openai')!.configured,deeplConfigured:providers.find(p=>p.id==='deepl')!.configured,glossary:normalizeGlossary(preferences.glossary),notifications:normalizeNotifications(preferences.notifications),syncReadReceipts:preferences.syncReadReceipts===true,mailBodyZoom:normalizeMailBodyZoom(preferences.mailBodyZoom)};
      }
      case 'settings.save':{
        assert(input.logLevel===undefined||['off','error','warn','info'].includes(input.logLevel));
        assert(input.provider===undefined||['baidu','deepl','hostModel','openai'].includes(input.provider));
        assert(input.selection===undefined||typeof input.selection==='boolean');
        assert(input.appid===undefined||(typeof input.appid==='string'&&input.appid.length<=100));
        assert(input.secret===undefined||(typeof input.secret==='string'&&input.secret.length<=512));
        if(input.appid!==undefined&&!input.secret){
          const oldBaidu=await translator.credentials();
          if(oldBaidu.secret&&input.appid!==oldBaidu.appid)throw new AppError('VALIDATION',false,'configuration');
        }
        if(input.model!==undefined)assert(typeof input.model==='string'&&input.model.length<=200);
        if(input.openaiModel!==undefined)assert(typeof input.openaiModel==='string'&&input.openaiModel.length<=200);
        if(input.openaiBaseUrl!==undefined){assert(typeof input.openaiBaseUrl==='string'&&input.openaiBaseUrl.length<=300);if(input.openaiBaseUrl)openaiEndpoint(input.openaiBaseUrl);}
        if(input.openaiApiKey!==undefined)assert(typeof input.openaiApiKey==='string'&&input.openaiApiKey.length<=512);
        if(input.deeplApiKey!==undefined)assert(typeof input.deeplApiKey==='string'&&input.deeplApiKey.length<=512);
        assert(input.syncReadReceipts===undefined||typeof input.syncReadReceipts==='boolean');
        assert(input.mailBodyZoom===undefined||(typeof input.mailBodyZoom==='number'&&Number.isInteger(input.mailBodyZoom)&&input.mailBodyZoom>=20&&input.mailBodyZoom<=200));
        assert(input.notifications===undefined||(input.notifications&&typeof input.notifications==='object'&&!Array.isArray(input.notifications)));
        const glossary=input.glossary===undefined?normalizeGlossary(preferences.glossary):normalizeGlossary(input.glossary);
        if(input.secret){assert(input.appid);await vault.put('translation',JSON.stringify({appid:input.appid,secret:input.secret}));}
        const old=await translator.openaiCredentials();
        const baseUrl=input.openaiBaseUrl??old.baseUrl,apiKey=input.openaiApiKey||old.apiKey;
        if(input.openaiBaseUrl!==undefined||input.openaiApiKey)await vault.put('openai',JSON.stringify({baseUrl,apiKey}));
        if(input.deeplApiKey)await vault.put('deepl',JSON.stringify({apiKey:input.deeplApiKey}));
        const savedProvider=['baidu','deepl','hostModel','openai'].includes(preferences.provider)?preferences.provider:'hostModel';
        await store.set('preferences',{provider:input.provider||savedProvider,selection:input.selection??preferences.selection??true,model:input.model??preferences.model??'',openaiModel:input.openaiModel??preferences.openaiModel??'',glossary,logLevel:input.logLevel||preferences.logLevel||'info',notifications:normalizeNotifications(input.notifications===undefined?preferences.notifications:input.notifications),syncReadReceipts:input.syncReadReceipts??(preferences.syncReadReceipts===true),mailBodyZoom:normalizeMailBodyZoom(input.mailBodyZoom??preferences.mailBodyZoom)});
        return {saved:true};
      }
      case 'app.diagnostics':return {entries:(diagnostics.get(partition(run))||[]).slice(-100)};
      case 'appearance.get':{
        const owner=partition(run);
        const desktop=await appearanceFiles.migrate(owner,store);
        const mobile=await appearanceFiles.get(owner,store,'mobile');
        const saved=normalizeAppearance(await store.get('appearance'));
        const settings={...saved,backgroundName:desktop?.name||'',backgroundMobileName:mobile?.name||''};
        if(settings.backgroundName!==saved.backgroundName||settings.backgroundMobileName!==saved.backgroundMobileName)await store.set('appearance',settings);
        const updatedAt=Number(await store.get('appearance-updated'))||desktop?.updatedAt||mobile?.updatedAt||0;
        return {
          settings,hasBackground:!!desktop,hasMobileBackground:!!mobile,
          ...(desktop?{backgroundName:desktop.name,backgroundMime:desktop.mime,backgroundBytes:desktop.bytes}:{}),
          ...(mobile?{mobileBackgroundName:mobile.name,mobileBackgroundMime:mobile.mime,mobileBackgroundBytes:mobile.bytes}:{}),
          updatedAt
        };
      }
      case 'appearance.save':{
        const owner=partition(run);
        const desktop=await appearanceFiles.migrate(owner,store);
        const mobile=await appearanceFiles.get(owner,store,'mobile');
        if(run.signal.aborted)throw new AppError('TIMEOUT',true);
        const settings=normalizeAppearance({...input,backgroundName:desktop?.name||'',backgroundMobileName:mobile?.name||''});
        const updatedAt=Date.now();
        await store.set('appearance',settings);await store.set('appearance-updated',updatedAt);
        traceAppearance(name,input,'persisted');
        announceAppearance(updatedAt);
        return {saved:true};
      }
      case 'appearance.background-start':{
        await appearanceFiles.migrate(partition(run),store);
        return appearanceFiles.start(partition(run),appearanceSlot(input.slot),input.name,input.mime);
      }
      case 'appearance.background-chunk':return appearanceFiles.chunk(partition(run),input.uploadId,input.data);
      case 'appearance.background-complete':{
        await appearanceFiles.migrate(partition(run),store);
        const slot=appearanceSlot(input.slot);
        const meta=await appearanceFiles.complete(partition(run),store,input.uploadId,input.name,input.mime,slot);
        const current=normalizeAppearance(await store.get('appearance'));
        const updatedAt=Date.now();
        await store.set('appearance',{...current,[appearanceNameKey(slot)]:meta.name});
        await store.set('appearance-updated',updatedAt);
        announceAppearance(updatedAt);
        return {saved:true,name:meta.name,bytes:meta.bytes};
      }
      case 'appearance.background-read':{
        const slot=appearanceSlot(input.slot),owner=partition(run);
        const meta=await appearanceFiles.get(owner,store,slot);assert(meta);
        return appearanceFiles.read(owner,store,input.offset,input.length,slot);
      }
      case 'appearance.background-clear':{
        const slot=appearanceSlot(input.slot);
        const current=normalizeAppearance(await store.get('appearance'));
        await appearanceFiles.clear(partition(run),store,slot);
        const updatedAt=Date.now();
        await store.set('appearance',{...current,[appearanceNameKey(slot)]:''});
        await store.set('appearance-updated',updatedAt);
        announceAppearance(updatedAt);
        return {cleared:true};
      }
      case 'appearance.reset':{
        await appearanceFiles.clear(partition(run),store,'desktop');
        await appearanceFiles.clear(partition(run),store,'mobile');await store.delete('appearance');
        const updatedAt=Date.now();
        await store.set('appearance-updated',updatedAt);
        announceAppearance(updatedAt);
        return {reset:true};
      }
      default:throw new AppError('NOT_FOUND');
    }
  }
  function traceAppearance(name:string,input:unknown,phase:string) {
    if(name!=='appearance.save'&&name!=='appearance.get')return;
    const id=(input as {__requestId?:unknown}|null)?.__requestId;
    const expected=name==='appearance.save'?/^as-[a-f0-9]{12}$/:/^as-[a-f0-9]{12}-check$/;
    if(typeof id==='string'&&expected.test(id))ctx.log.info(`[ekko-tools] ${name} trace=${id} phase=${phase}`);
  }
  const registrations=rpcNames.map(name=>ctx.extensions.rpc.register(name,async(input:any,run)=>{
    const definition=contract.rpc[name] as {input:string;output:string};
    if(name==='app.cancel'){
      if(!input||typeof input!=='object'||typeof input.requestId!=='string')return {ok:false,error:errorInfo(new AppError('VALIDATION'))};
      try{validateModel(contract,definition.input,canonical(input));}catch{return {ok:false,error:errorInfo(new AppError('VALIDATION'))};}
      operations.get(partition(run)+':'+input.requestId)?.abort();return {ok:true,data:{cancelled:true}};
    }
    traceAppearance(name,input,'received');
    // 契约入参校验：规范化为纯 JSON（丢弃 undefined 键）后按模型校验，失败返回 VALIDATION 信封。
    try{
      input=input===undefined||input===null?{}:canonical(input);
      if(name==='appearance.save'&&!Object.hasOwn(input,'wire')){
        validateModel(contract,'appearanceSaveLegacyInput',input);
      }else{
        validateModel(contract,definition.input,input);
        if(name==='appearance.save')input={...decodeAppearanceSave(input.wire),__requestId:input.__requestId};
      }
    }
    catch{traceAppearance(name,input,'rejected');return {ok:false as const,error:errorInfo(new AppError('VALIDATION'))};}
    const operation=new AbortController(),operationId=partition(run)+':'+(typeof input?.__requestId==='string'?input.__requestId:randomUUID());
    operations.set(operationId,operation);
    const partitionKey=partition(run),key=lane(partitionKey,name,input),previous=queues.get(key)||Promise.resolve();
    const next=previous.catch(()=>{ctx.log.error('[ekko-tools] queue_recovered',{category:'internal'});}).then(async()=>{
      const started=Date.now();let level:LogLevel='info';
      traceAppearance(name,input,'running');
      const record=(entry:LogRecord)=>{if(publishLog(ctx.log,level,entry))rememberDiagnostic(partitionKey,entry);};
      try{
        const signal=AbortSignal.any([run.signal,controller.signal,operation.signal]);
        if(signal.aborted)throw new AppError('TIMEOUT',true);
        const data=await bounded(async s=>{
          const active={...run,signal:s},r=await runtime(active),preferences=await r.store.get<any>('preferences')||{};
          level=preferences.logLevel||'info';return handle(name,input,active,preferences);
        },signal,ctx.lifecycle,90000);
        // 契约出参校验：规范化后按模型校验，违反契约按 INTERNAL 失败关闭，不向客户端泄漏未登记结构。
        let payload:any;
        try{payload=canonical(data);validateModel(contract,definition.output,payload);}
        catch(e){level='error';ctx.log.error(`[ekko-tools] ${name} output_invalid detail=${detailOf(e)}`);record(logRecord(name,'failure',Date.now()-started,input?.accountId,'INTERNAL','internal'));return {ok:false as const,error:errorInfo(new AppError('INTERNAL'))};}
        if(name!=='mail.draft.upload-chunk')record(logRecord(name,'success',Date.now()-started,input?.accountId));
        traceAppearance(name,input,'returning');
        return {ok:true as const,data:payload};
      }catch(e){
        const error=errorInfo(e);
        traceAppearance(name,input,`failed_${error.code}`);
        if(error.code==='INTERNAL')ctx.log.error(`[ekko-tools] ${name} detail=${detailOf(e)}`);
        record(logRecord(name,'failure',Date.now()-started,input?.accountId,error.code,error.category));return {ok:false as const,error};
      }finally {operations.delete(operationId);}
    });
    queues.set(key,next);void next.then(()=>{if(queues.get(key)===next)queues.delete(key);},()=>{if(queues.get(key)===next)queues.delete(key);ctx.log.error('[ekko-tools] queue_failed',{category:'internal'});});return next;
  }));
  const background:Dispose[]=[];
  if(ctx.extensions.actions&&ctx.scheduler)try{
    const activePolls=new Set<string>();
    background.push(ctx.extensions.actions.register({
      name:'mail.poll',description:'后台同步 IMAP 新邮件并写入本地缓存，只推送真实新增邮件。',
      inputSchema:{type:'object',properties:{},additionalProperties:false},
      execute:async(_input,run)=>{
        const key=lane(partition(run),'mail.poll');
        // 上一轮同步未结束时跳过本轮，避免慢网络下轮询任务堆积。
        if(activePolls.has(key))return {checked:0,updated:0,skipped:true};
        activePolls.add(key);
        try{
          const r=await runtime(run),accounts=await r.mail.accounts();
          if(!accounts.length)return {checked:0,updated:0};
          const pollRun:Run={...run,messages:{emit:(type,data)=>run.messages.emit(type,data,{audience:'plugin'})}};
          // 逐账号同步：单个账号超时或异常不拖垮整轮，总耗时控制在调度上下文有效期内。
          const sync=await r.store.get<Record<string,{lastSyncAt?:number}>>('mail-sync')||{};
          const ordered=[...accounts].sort((left,right)=>(sync[left.id]?.lastSyncAt||0)-(sync[right.id]?.lastSyncAt||0));
          const deadline=Date.now()+25000;
          let checked=0,updated=0,failed=0;
          for(const account of ordered){
            if(run.signal.aborted||Date.now()>deadline)break;
            try{
              const result=await r.mail.list({accountIds:[account.id],limit:50,refresh:true},pollRun,'background');
              checked+=result.total;updated+=result.updated;
            }catch(e){
              failed++;
              const error=errorInfo(e);
              ctx.log.warn(`[ekko-tools] mail_poll_account_failed account=${account.alias||account.provider} code=${error.code} detail=${detailOf(e)}`);
            }
          }
          return {checked,updated,...(failed?{failed}:{})};
        }catch(e){const error=errorInfo(e);ctx.log.warn(`[ekko-tools] mail_poll_failed code=${error.code} category=${error.category} detail=${detailOf(e)}`);return {checked:0,updated:0};}
        finally{activePolls.delete(key);}
      }
    }));
    background.push(ctx.scheduler.every('mail-poll',30000,'mail.poll',{}));
    background.push(ctx.extensions.actions.register({
      name:'rss.poll',description:'后台抓取启用的 RSS 订阅并写入本地阅读库。',
      inputSchema:{type:'object',properties:{},additionalProperties:false},
      execute:async(_input,run)=>{
        const key=lane(partition(run),'rss.poll');
        if(activePolls.has(key))return {checked:0,newEntries:0,failed:0,skipped:true};
        activePolls.add(key);
        try{
          const r=await runtime(run),result=await r.rss.poll();
          if(result.newEntries>0)run.messages.emit('rss.updated',{newCount:result.newEntries,at:Date.now()},{audience:'plugin'});
          return result;
        }catch(e){const error=errorInfo(e);ctx.log.warn(`[ekko-tools] rss_poll_failed code=${error.code} category=${error.category} detail=${detailOf(e)}`);return {checked:0,newEntries:0,failed:0};}
        finally{activePolls.delete(key);}
      }
    }));
    background.push(ctx.scheduler.every('rss-poll',60000,'rss.poll',{}));
  }catch{ctx.log.warn('[ekko-tools] mail_poll_unavailable',{category:'automation'});}
  return async()=>{
    ctx.signal.removeEventListener('abort',hostAbort);
    await resource();for(const release of background)await release();for(const release of registrations)await release();
  };
}

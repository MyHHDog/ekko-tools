import type { TranslateRequest } from '../../shared/types';
import { AppError } from '../../shared/error-codes';
import type { TranslateProvider } from './provider';

const sourceLanguage:Record<string,string>={zh:'ZH',en:'EN',ja:'JA',ko:'KO',fr:'FR',de:'DE',es:'ES',ru:'RU'};
const targetLanguage:Record<string,string>={zh:'ZH-HANS',en:'EN',ja:'JA',ko:'KO',fr:'FR',de:'DE',es:'ES',ru:'RU'};
const detectedLanguage:Record<string,string>={ZH:'zh',EN:'en',JA:'ja',KO:'ko',FR:'fr',DE:'de',ES:'es',RU:'ru'};

export function deeplEndpoint(apiKey:string) {
  return apiKey.trim().endsWith(':fx')?'https://api-free.deepl.com/v2/translate':'https://api.deepl.com/v2/translate';
}

export class DeepLProvider implements TranslateProvider {
  readonly id='deepl' as const;
  constructor(private apiKey:string,private request:typeof fetch=fetch){}
  isConfigured(){return Boolean(this.apiKey.trim());}
  async translate(req:TranslateRequest,signal:AbortSignal){
    if(!this.isConfigured())throw new AppError('VALIDATION',false,'configuration');
    const started=Date.now(),body=new URLSearchParams({text:req.text,target_lang:targetLanguage[req.to]});
    if(req.from!=='auto')body.set('source_lang',sourceLanguage[req.from]);
    const response=await this.request(deeplEndpoint(this.apiKey),{method:'POST',redirect:'error',signal,
      headers:{authorization:`DeepL-Auth-Key ${this.apiKey.trim()}`,'content-type':'application/x-www-form-urlencoded'},body});
    if(!response.ok)throw new AppError(response.status===429?'RATE_LIMITED':[401,403].includes(response.status)?'AUTH_FAILED':response.status===456?'PROVIDER_QUOTA':'PROVIDER_BAD_RESPONSE',response.status===429||response.status>=500);
    const raw=await response.text();
    if(raw.length>1024*1024)throw new AppError('PROVIDER_BAD_RESPONSE');
    let data:any;try{data=JSON.parse(raw);}catch{throw new AppError('PROVIDER_BAD_RESPONSE');}
    if(!Array.isArray(data.translations)||!data.translations.length||!data.translations.every((v:any)=>typeof v.text==='string'&&v.text.trim()))throw new AppError('PROVIDER_BAD_RESPONSE');
    return {provider:this.id,translated:data.translations.map((v:any)=>v.text).join('\n'),
      detectedFrom:detectedLanguage[String(data.translations[0].detected_source_language||'').toUpperCase()]||req.from,
      latencyMs:Date.now()-started,usage:{chars:Array.from(req.text).length}};
  }
}

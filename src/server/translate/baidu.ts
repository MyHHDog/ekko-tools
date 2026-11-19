import { createHash, randomBytes } from 'node:crypto';
import type { TranslateRequest } from '../../shared/types';
import { AppError } from '../../shared/error-codes';
import type { TranslateProvider } from './provider';
const languageMap: Record<string,string>={auto:'auto',zh:'zh',en:'en',ja:'jp',ko:'kor',fr:'fra',de:'de',es:'spa',ru:'ru'};
export function baiduError(code: string) {
  if(['52003','54001','58000','90107'].includes(code))return new AppError('AUTH_FAILED');
  if(['54003','54005'].includes(code))return new AppError('RATE_LIMITED',true);
  if(code==='54004')return new AppError('PROVIDER_QUOTA');
  if(code==='58001')return new AppError('UNSUPPORTED_LANGUAGE');
  if(code==='52001')return new AppError('TIMEOUT',true);
  return new AppError('PROVIDER_BAD_RESPONSE',code==='52002');
}
export class BaiduProvider implements TranslateProvider {
  readonly id='baidu' as const;
  constructor(private appid:string,private secret:string,private request:typeof fetch=fetch){}
  isConfigured(){return Boolean(this.appid&&this.secret);}
  async translate(req:TranslateRequest,signal:AbortSignal){
    if(!this.isConfigured())throw new AppError('AUTH_FAILED');
    const started=Date.now(),salt=randomBytes(12).toString('hex');
    const sign=createHash('md5').update(this.appid+req.text+salt+this.secret,'utf8').digest('hex');
    const response=await this.request('https://fanyi-api.baidu.com/api/trans/vip/translate',{method:'POST',redirect:'error',signal,body:new URLSearchParams({appid:this.appid,q:req.text,salt,sign,from:languageMap[req.from],to:languageMap[req.to]})});
    if(!response.ok)throw new AppError(response.status===429?'RATE_LIMITED':[401,403].includes(response.status)?'AUTH_FAILED':'PROVIDER_BAD_RESPONSE',response.status===429||response.status>=500);
    const raw=await response.text();
    if(raw.length>1024*1024)throw new AppError('PROVIDER_BAD_RESPONSE');
    let data:any;try{data=JSON.parse(raw);}catch{throw new AppError('PROVIDER_BAD_RESPONSE');}
    if(data.error_code)throw baiduError(String(data.error_code));
    if(!Array.isArray(data.trans_result)||!data.trans_result.every((v:any)=>typeof v.dst==='string')||!data.trans_result.length)throw new AppError('PROVIDER_BAD_RESPONSE');
    return {provider:this.id,translated:data.trans_result.map((v:any)=>v.dst).join('\n'),detectedFrom:Object.keys(languageMap).find(k=>languageMap[k]===data.from)||req.from,latencyMs:Date.now()-started};
  }
}

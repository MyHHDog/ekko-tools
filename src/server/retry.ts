import { AppError, errorInfo } from '../shared/error-codes';
import type { Lifecycle } from './adapter/host';
export function delay(ms: number, signal: AbortSignal, lifecycle: Lifecycle) {
  return new Promise<void>((resolve,reject)=>{
    let release: ()=>void=()=>{},settled=false;
    const finish=(cancel=false)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);release();cancel?reject(new AppError('TIMEOUT',true)):resolve();};
    const abort=()=>finish(true), timer=setTimeout(()=>finish(),ms);
    release=lifecycle.add(abort); signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted) abort();
  });
}
export async function bounded<T>(work:(signal:AbortSignal)=>Promise<T>,signal:AbortSignal,lifecycle:Lifecycle,timeoutMs=20000) {
  const controller=new AbortController(), cancel=()=>controller.abort();
  signal.addEventListener('abort',cancel,{once:true});
  if(signal.aborted) cancel();
  let rejectAbort: (error: unknown)=>void=()=>{};
  const timer=setTimeout(cancel,timeoutMs);
  const release=lifecycle.add(cancel);
  const aborted=()=>rejectAbort(new AppError('TIMEOUT',true));
  try {
    return await Promise.race([new Promise<T>((_,reject)=>{rejectAbort=reject;controller.signal.addEventListener('abort',aborted,{once:true});if(controller.signal.aborted)aborted();}),work(controller.signal)]);
  } finally {clearTimeout(timer);release();signal.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',aborted);}
}
export async function retry<T>(work:(signal:AbortSignal,attempt:number)=>Promise<T>,signal:AbortSignal,lifecycle:Lifecycle,timeoutMs=20000,totalMs=90000) {
  const started=Date.now();
  for(let attempt=0;;attempt++){
    const remaining=totalMs-(Date.now()-started);
    if(signal.aborted||remaining<=0)throw new AppError('TIMEOUT',true);
    try{return await bounded(s=>work(s,attempt+1),signal,lifecycle,Math.min(timeoutMs,remaining));}
    catch(error){
      const info=errorInfo(error);
      if(!info.retryable||attempt>=3||signal.aborted)throw error;
      const wait=info.code==='RATE_LIMITED'?5000:1000*2**attempt;
      if(Date.now()-started+wait>=totalMs)throw new AppError('TIMEOUT',true);
      await delay(wait,signal,lifecycle);
    }
  }
}

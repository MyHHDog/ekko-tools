import type { ClientHost } from './adapter/host';
import type { ErrorInfo } from '../shared/types';
import { t } from './i18n';
import { uuid } from './uuid';
export class RpcError extends Error {
  constructor(public info:ErrorInfo){super(info.message);}
}
const pending=new WeakMap<ClientHost,Map<string,Set<string>>>();
export function cancelPending(ctx:ClientHost,owner:string) {
  for(const requestId of pending.get(ctx)?.get(owner)||[])void ctx.rpc.call('app.cancel',{requestId}).catch(()=>{console.warn('[ekko-tools] cancel_unconfirmed');});
  pending.get(ctx)?.delete(owner);
}
export async function call<T=any>(ctx:ClientHost,name:string,input?:any):Promise<T> {
  const owner=input?.__owner||'general',id=uuid();
  const payload=JSON.parse(JSON.stringify({...input,__requestId:id}));
  if(!pending.has(ctx))pending.set(ctx,new Map());const owners=pending.get(ctx)!;
  if(!owners.has(owner))owners.set(owner,new Set());owners.get(owner)!.add(id);
  try{
    const result=await ctx.rpc.call<T>(name,payload);
    if(!result.ok)throw new RpcError(result.error);return result.data;
  }finally{owners.get(owner)?.delete(id);}
}
export function readable(error:unknown) {
  if(error instanceof RpcError)return error.info;
  const detail=error instanceof Error&&error.message?error.message.slice(0,300):'';
  return {code:'INTERNAL',message:detail||t('操作未完成，请重试'),retryable:false};
}
export function uiTask(ctx:ClientHost,work:()=>Promise<unknown>,onError?:(error:ReturnType<typeof readable>)=>void){
  void Promise.resolve().then(work).catch(error=>{const safe=readable(error);if(onError)onError(safe);else ctx.ui.notify(safe.message,'error');});
}
export async function copyText(text:string,element:HTMLElement,ctx:ClientHost) {
  try{await navigator.clipboard.writeText(text);ctx.ui.notify(t('已复制'),'success');return true;}catch{/* 受限 iframe 使用选区降级。 */}
  const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(element);
  element.focus();
  selection?.removeAllRanges();selection?.addRange(range);
  try{if(document.execCommand('copy')){ctx.ui.notify(t('已复制'),'success');return true;}}catch{/* 保留选区供手动复制。 */}
  ctx.ui.notify(t('已选中译文，请按 Ctrl/⌘+C 复制'));return false;
}

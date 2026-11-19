import type { Result } from '../../shared/types';
export interface ClientHost {
  plugin?:{id:string};
  identity?:{userId:number;profile:string};
  slot:string;view?:string;location:{path:string;query:Record<string,string|string[]>};signal:AbortSignal;
  rpc:{call<T=any>(name:string,input?:any):Promise<Result<T>>};
  messages:{on(type:string,fn:(event:any)=>void):()=>void};
  ui:{confirm(message:string):Promise<boolean>;notify(message:string,level?:'info'|'error'|'success'):void;navigate(path:string):void;selectModel?(options?:any):Promise<any>};
  lifecycle:{add(dispose:()=>void):()=>void};
}
export function resolveSlot(ctx:ClientHost):'sidebar'|'translate'|'mail'|'reading'|'settings' {
  if(ctx.slot==='workspace-sidebar')return 'sidebar';
  const view=ctx.view||ctx.location.path.split('/').pop();
  if(ctx.slot==='settings'||view==='settings')return 'settings';
  if((ctx.slot==='workspace'||ctx.slot==='page')&&view==='mail')return 'mail';
  if((ctx.slot==='workspace'||ctx.slot==='page')&&view==='reading')return 'reading';
  if(ctx.slot!=='workspace'&&ctx.slot!=='page')console.warn('ekko-tools：未知插槽，回落到翻译');
  return 'translate';
}
export function mailPath(accountId:string,messageId:string) {
  return '/studio/plugins/ekko-tools/mail?'+new URLSearchParams({accountId,id:messageId});
}
export const settingsPath = '/studio/plugin-settings/ekko-tools/settings';
export const appPath = '/studio/plugins/ekko-tools/translate';
export const readingPath = '/studio/plugins/ekko-tools/reading';

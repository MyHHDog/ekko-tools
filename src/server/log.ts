import { createHash } from 'node:crypto';
export function redact(value: unknown): unknown {
  if (typeof value==='string') return value.replace(/[\w.+-]+@[\w.-]+\.[a-z]+/gi, a=>a[0]+'***@'+a.split('@')[1]);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>
    [k,/pass|secret|token|auth|cookie|code/i.test(k)?'[REDACTED]':/body|text|html|content|attachment|stack/i.test(k)?'[OMITTED]':k==='subject'?String(v).length:redact(v)]));
  return value;
}
export function diagnostic(event: string, accountId?: string, errorCode?: string) {
  return {ts:Date.now(),level:errorCode?'error':'info',event,accountIdHash:accountId?createHash('sha256').update(accountId).digest('hex').slice(0,8):undefined,errorCode};
}
export type LogLevel='off'|'error'|'warn'|'info';
export interface LogRecord {ts:number;prefix:'ekko-tools';level:Exclude<LogLevel,'off'>;event:string;outcome:'success'|'failure';accountIdHash?:string;errorCode?:string;category?:string;durationMs:number}
const ranks={off:0,error:1,warn:2,info:3};
export function logRecord(event:string,outcome:'success'|'failure',durationMs:number,accountId?:string,errorCode?:string,category?:string):LogRecord {
  return {ts:Date.now(),prefix:'ekko-tools',level:outcome==='failure'?'error':'info',event,outcome,
    accountIdHash:accountId?createHash('sha256').update(accountId).digest('hex').slice(0,8):undefined,errorCode,category,durationMs};
}
export function publishLog(sink:{info:(message:string,data?:any)=>void;warn:(message:string,data?:any)=>void;error:(message:string,data?:any)=>void},level:LogLevel,record:LogRecord){
  if(ranks[record.level]>ranks[level])return false;
  const detail=record.outcome==='failure'
    ?` code=${record.errorCode||'INTERNAL'} category=${record.category||'internal'}`
    :'';
  sink[record.level]('[ekko-tools] '+record.event+detail,record);return true;
}

import { createHash } from 'node:crypto';
export type Dispose = () => void | Promise<void>;
export interface Storage { namespace(...segments: string[]): Storage; get<T = any>(key: string): Promise<T | undefined>; set(key: string, value: any): Promise<void>; delete(key: string): Promise<void>; keys(): Promise<string[]> }
export interface Lifecycle { add(dispose: Dispose): Dispose }
export interface Run { identity: {userId: number; profile: string}; signal: AbortSignal; state: {plugin: Storage}; messages: {emit(type: string, data: any, options?: {audience?: 'caller' | 'plugin'}): void}; host: {models: {respond(input: any): Promise<any>; list(): Promise<any>}} }
export interface Host extends Omit<Run,'messages'> { config: Record<string, any>; paths: {dataDir: string}; lifecycle: Lifecycle; extensions: {rpc: {register(name: string, handler: (input: any, run: Run) => Promise<any>): Dispose}; actions?: {register(action: {name: string; description: string; inputSchema: any; execute(input: Record<string, any>, run: Run): Promise<any>}): Dispose}}; scheduler?: {every(id: string, intervalMs: number, action: string, input?: Record<string, any>): Dispose}; log: {info(message: string, data?: any): void; warn(message: string, data?: any): void; error(message: string, data?: any): void} }
export function partition(run: Run) { return createHash('sha256').update(JSON.stringify([run.identity.userId,run.identity.profile])).digest('hex'); }
// 宿主存储只接受纯 JSON：写入前统一丢弃 undefined，避免 RPC 可选字段导致 PLUGIN_SCHEMA。
function jsonStorage(store: Storage): Storage {
  const clean=(value:any)=>value===undefined?null:JSON.parse(JSON.stringify(value));
  return {namespace:(...segments)=>jsonStorage(store.namespace(...segments)),get:<T>(key:string)=>store.get<T>(key),
    set:(key,value)=>store.set(key,clean(value)),delete:key=>store.delete(key),keys:()=>store.keys()};
}
export function scope(run: Run) { return jsonStorage(run.state.plugin.namespace('users',String(run.identity.userId),'profiles',run.identity.profile)); }
// v2 命名空间与历史大对象隔离，邮件/RSS 主体已迁至 SQLite，这里只放偏好与小缓存。
export function dataScope(run: Run) { return jsonStorage(run.state.plugin.namespace('v2','users',String(run.identity.userId),'profiles',run.identity.profile)); }
export function configOf(config: Record<string, any>) { return { timeoutMs: Math.min(20000,Math.max(3000,Number(config.timeoutMs)||20000)), maxBytes: Math.min(25,Math.max(1,Number(config.maxAttachmentMB)||10))*1024*1024 }; }

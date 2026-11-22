import { createHash } from 'node:crypto';
import type { CacheStats, TranslationJob } from '../../shared/types';
import type { Storage } from '../adapter/host';

const TTL=7*24*60*60*1000,MAX_ENTRIES=100,MAX_BYTES=512*1024;
type Entry={at:number;job:TranslationJob};

export function cacheKey(parts:unknown[]) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export class TranslationCache {
  private mutation:Promise<unknown>=Promise.resolve();
  constructor(private store:Storage){}
  bind(store:Storage){this.store=store;}
  private async read(){return await this.store.get<Record<string,Entry>>('translate-cache')||{};}
  private queue<T>(work:()=>Promise<T>):Promise<T>{
    const next=this.mutation.catch(()=>undefined).then(work);
    this.mutation=next.then(()=>undefined,()=>undefined);
    return next;
  }
  async get(key:string){
    return this.queue(async()=>{
      const all=await this.read(),entry=all[key];if(!entry)return;
      if(Date.now()-entry.at>TTL){delete all[key];await this.store.set('translate-cache',all);return;}
      return structuredClone(entry.job);
    });
  }
  async stats():Promise<CacheStats>{
    return this.queue(async()=>{
      const all=await this.read(),now=Date.now();
      let pruned=false;
      for(const [key,entry] of Object.entries(all))if(now-entry.at>TTL){delete all[key];pruned=true;}
      if(pruned)await this.store.set('translate-cache',all);
      const entries=Object.keys(all).length,times=Object.values(all).map(entry=>entry.at);
      return entries?{entries,bytes:Buffer.byteLength(JSON.stringify(all)),oldestAt:Math.min(...times),newestAt:Math.max(...times)}:{entries:0,bytes:0};
    });
  }
  async clear():Promise<CacheStats>{
    return this.queue(async()=>{
      const all=await this.read(),cleared=Object.keys(all).length;
      await this.store.set('translate-cache',{});
      return {entries:0,bytes:0,cleared};
    });
  }
  async put(key:string,job:TranslationJob){
    return this.queue(async()=>{
      const all=await this.read();all[key]={at:Date.now(),job:structuredClone({...job,cached:undefined})};
      while(Object.keys(all).length>MAX_ENTRIES||Buffer.byteLength(JSON.stringify(all))>MAX_BYTES)delete all[Object.keys(all).sort((a,b)=>all[a].at-all[b].at)[0]];
      await this.store.set('translate-cache',all);
    });
  }
}

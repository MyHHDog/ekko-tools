import {ImapFlow} from 'imapflow';
import type {Lifecycle,Dispose} from '../adapter/host';
import {errorInfo} from '../../shared/error-codes';
import type {ErrorInfo} from '../../shared/types';
export type Factory=(options:ConstructorParameters<typeof ImapFlow>[0])=>ImapFlow;
export interface Entry {client:ImapFlow;dispose:Dispose;timerRelease?:Dispose;error?:ErrorInfo;inflight:number}
export class ImapPool {
  private entries=new Map<string,Entry>();
  constructor(private lifecycle:Lifecycle,private factory:Factory,private idleMs=300000){}
  async acquire(id:string,options:ConstructorParameters<typeof ImapFlow>[0]){
    let entry=this.entries.get(id);
    if(entry?.client.usable===false){this.close(id);entry=undefined;}
    if(entry){entry.timerRelease?.();entry.timerRelease=undefined;entry.inflight++;return entry;}
    const client=this.factory(options);
    entry={client,dispose:()=>{},inflight:1};
    const active=entry;
    active.dispose=this.lifecycle.add(()=>{active.timerRelease?.();active.timerRelease=undefined;client.close();this.entries.delete(id);});
    client.on('error',error=>{active.error=errorInfo(error);this.remove(id,active);});
    client.on('close',()=>this.remove(id,active));
    this.entries.set(id,active);
    try{await client.connect();if(options.auth)options.auth.pass='';return active;}
    catch(error){this.remove(id,active);throw error;}
    finally{if(options.auth)options.auth.pass='';}
  }
  release(id:string,entry:Entry){
    if(this.entries.get(id)!==entry)return;
    entry.inflight=Math.max(0,entry.inflight-1);
    if(entry.inflight>0)return;
    entry.timerRelease?.();
    const timer=setTimeout(()=>{entry.timerRelease?.();entry.timerRelease=undefined;this.remove(id,entry);},this.idleMs);
    entry.timerRelease=this.lifecycle.add(()=>{clearTimeout(timer);});
  }
  close(id:string){const entry=this.entries.get(id);if(entry)this.remove(id,entry);}
  closeAll(){for(const [id,entry] of [...this.entries])this.remove(id,entry);}
  private remove(id:string,entry:Entry){
    if(this.entries.get(id)!==entry)return;
    this.entries.delete(id);
    entry.timerRelease?.();entry.timerRelease=undefined;
    entry.dispose();
  }
}

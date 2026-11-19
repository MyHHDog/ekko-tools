import {ImapFlow} from 'imapflow';
import type {Lifecycle,Dispose} from '../adapter/host';
import {errorInfo} from '../../shared/error-codes';
import type {ErrorInfo} from '../../shared/types';
export type Factory=(options:ConstructorParameters<typeof ImapFlow>[0])=>ImapFlow;
export interface Entry {client:ImapFlow;release:Dispose;timerRelease?:Dispose;error?:ErrorInfo}
export class ImapPool {
  private entries=new Map<string,Entry>();
  constructor(private lifecycle:Lifecycle,private timeoutMs:number,private factory:Factory,private idleMs=30000){}
  async acquire(id:string,options:ConstructorParameters<typeof ImapFlow>[0]){
    let entry=this.entries.get(id);
    if(entry?.client.usable===false){this.close(id);entry=undefined;}
    if(entry){entry.timerRelease?.();entry.timerRelease=undefined;return entry;}
    const client=this.factory(options);
    entry={client,release:()=>{}};
    const active=entry;
    active.release=this.lifecycle.add(()=>{active.timerRelease?.();active.timerRelease=undefined;client.close();this.entries.delete(id);});
    client.on('error',error=>{active.error=errorInfo(error);active.release();});
    client.on('close',()=>{if(this.entries.get(id)===active)active.release();});
    this.entries.set(id,active);
    try{await client.connect();if(options.auth)options.auth.pass='';return active;}
    catch(error){active.release();throw error;}
    finally{if(options.auth)options.auth.pass='';}
  }
  idle(id:string,entry:Entry){
    if(this.entries.get(id)!==entry)return;
    entry.timerRelease?.();
    const timer=setTimeout(()=>{entry.timerRelease?.();entry.timerRelease=undefined;entry.release();},Math.min(this.idleMs,this.timeoutMs));
    entry.timerRelease=this.lifecycle.add(()=>{clearTimeout(timer);});
  }
  close(id:string){this.entries.get(id)?.release();}
  closeAll(){for(const entry of [...this.entries.values()])entry.release();}
}

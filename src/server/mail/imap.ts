import { ImapFlow } from 'imapflow';
import type { Connector, Credentials, ReplyMessage, ReplyResult } from './connector';
import { serverEndpoint } from './presets';
import { sendReply, verifySmtp } from './smtp';
import { parseMime } from './parse';
import { AppError, assert } from '../../shared/error-codes';
import type { Lifecycle } from '../adapter/host';
import type { Account, MailSummary } from '../../shared/types';
import {ImapPool} from './imap-pool';
import type {Factory,Entry} from './imap-pool';
export class ImapConnector implements Connector {
  private pool:ImapPool;
  private snapshots=new Map<string,{validity:string;next:number}>();
  constructor(private lifecycle:Lifecycle,private timeoutMs:number,private factory:Factory=o=>new ImapFlow(o)){this.pool=new ImapPool(lifecycle,timeoutMs,factory);}
  private async session<T>(acc:Credentials,signal:AbortSignal,fn:(client:ImapFlow)=>Promise<T>,readOnly=true):Promise<T>{
    const {provider,address}=acc.account, endpoint=serverEndpoint(acc.account,'imap');
    const poolId=acc.account.id+(readOnly?'':':rw');
    let entry:Entry|undefined;const abort=()=>this.pool.close(poolId);
    const options={host:endpoint.host,port:endpoint.port,secure:endpoint.secure,doSTARTTLS:endpoint.secure?undefined:true,tls:{rejectUnauthorized:true,minVersion:'TLSv1.2'},
      auth:{user:acc.account.username||address,pass:acc.secret,loginMethod:'LOGIN'},logger:false,logRaw:false,emitLogs:false,disableAutoIdle:true,
      disableAutoEnable:true,disableCompression:true,disableBinary:true,clientInfo:{name:'ekko-tools',version:'0.1.0'},
      connectionTimeout:this.timeoutMs,greetingTimeout:this.timeoutMs,socketTimeout:this.timeoutMs} as ConstructorParameters<typeof ImapFlow>[0];
    signal.addEventListener('abort',abort,{once:true});
    try {
      if(signal.aborted)throw new AppError('TIMEOUT',true);
      entry=await this.pool.acquire(poolId,options);const client=entry.client;
      if(signal.aborted){abort();throw new AppError('TIMEOUT',true);}
      await client.mailboxOpen('INBOX',{readOnly});
      const value=await fn(client);if(entry.error)throw new AppError(entry.error.code,entry.error.retryable,entry.error.category);return value;
    } catch(error) {
      const e=error as {authenticationFailed?:boolean;responseStatus?:string;message?:string;responseText?:string;response?:unknown};
      this.pool.close(poolId);
      let response='';try{response=JSON.stringify(e.response||{});}catch{/* 忽略不可序列化的服务端响应。 */}
      const detail=`${e.message||''} ${e.responseText||''} ${response}`.toLowerCase();
      if(e.authenticationFailed||(e.responseStatus==='NO'&&/(auth|login|password|credential|unsafe|denied|授权|登录)/.test(detail)))
        throw new AppError(provider==='gmail'?'AUTH_REQUIRED_APP_PASSWORD':'AUTH_FAILED');
      throw error;
    } finally {signal.removeEventListener('abort',abort);if(entry)this.pool.idle(poolId,entry);if(options.auth)options.auth.pass='';acc.secret='';}
  }
  async test(acc:Credentials,signal:AbortSignal) {
    const secret=acc.secret;
    await this.session(acc,signal,async()=>{});
    if(acc.account.provider==='custom')await verifySmtp(acc.account,secret,signal,this.timeoutMs);
    return {status:'connected' as const,checkedAt:Date.now()};
  }
  async list(acc:Credentials,q:{cursor?:string;limit:number},signal:AbortSignal){
    return this.session(acc,signal,async client=>{
      const box=client.mailbox;assert(box,'PROVIDER_BAD_RESPONSE');
      const validity=String(box.uidValidity), previous=this.snapshots.get(acc.account.id);
      const reset=Boolean(previous&&previous.validity!==validity), items:MailSummary[]=[];
      const end=q.cursor?Math.min(Number(q.cursor),box.exists):box.exists;
      assert(Number.isInteger(end)&&end>=0);
      if(!end)return {items,reset};
      const start=Math.max(1,end-q.limit+1);
      const incremental=!q.cursor&&previous&&!reset&&previous.next<=box.uidNext;
      const nextCursor=start>1?String(start-1):undefined;
      if(incremental&&previous.next===box.uidNext)return {items,reset,nextCursor};
      const range=incremental?`${previous.next}:${box.uidNext-1}`:`${start}:${end}`;
      for await(const mail of client.fetch(range,{uid:true,envelope:true,flags:true,bodyStructure:true},{uid:!!incremental})){
        if(signal.aborted)throw new AppError('TIMEOUT',true);
        const env=mail.envelope;
        items.push({accountId:acc.account.id,messageId:`${validity}:${mail.uid}`,from:{name:env?.from?.[0]?.name,address:env?.from?.[0]?.address||''},
          subject:env?.subject||'(无主题)',snippet:'',date:env?.date?.getTime()||0,unread:!mail.flags?.has('\\Seen'),
          hasAttachments:JSON.stringify(mail.bodyStructure||{}).includes('attachment')});
      }
      this.snapshots.set(acc.account.id,{validity,next:box.uidNext});
      return {items,nextCursor,reset};
    });
  }
  async fetch(acc:Credentials,messageId:string,signal:AbortSignal){
    return this.session(acc,signal,async client=>{
      const [validity,uid]=messageId.split(':');assert(/^\d+$/.test(validity)&&/^\d+$/.test(uid));
      assert(client.mailbox&&String(client.mailbox.uidValidity)===validity,'NOT_FOUND');
      const metadata=await client.fetchOne(uid,{size:true},{uid:true});assert(metadata,'NOT_FOUND');
      assert((metadata.size||0)<=36*1024*1024,'ATTACHMENT_TOO_LARGE');
      const mail=await client.fetchOne(uid,{source:{maxLength:36*1024*1024},flags:true},{uid:true});
      assert(mail&&mail.source,'NOT_FOUND');
      const parsed=await parseMime(mail.source,messageId).catch(()=>{throw new AppError('PROVIDER_BAD_RESPONSE',false,'parse');});
      parsed.unread=!mail.flags?.has('\\Seen');return parsed;
    });
  }
  async olderCursor(acc:Credentials,messageIds:string[],signal:AbortSignal){
    return this.session(acc,signal,async client=>{
      const box=client.mailbox;assert(box,'PROVIDER_BAD_RESPONSE');
      const currentValidity=String(box.uidValidity);
      const uids=messageIds.filter(id=>id.startsWith(currentValidity+':'))
        .map(id=>Number(id.slice(currentValidity.length+1)))
        .filter(uid=>Number.isInteger(uid)&&uid>0);
      if(!uids.length)return undefined;
      const oldestUid=Math.min(...uids);
      const found=await client.fetchOne(String(oldestUid),{uid:true},{uid:true});
      if(!found||found.seq<=1)return undefined;
      return String(found.seq-1);
    });
  }
  async seen(acc:Credentials,messageIds:string[],signal:AbortSignal){
    return this.session(acc,signal,async client=>{
      const box=client.mailbox;assert(box,'PROVIDER_BAD_RESPONSE');
      const validity=String(box.uidValidity),uids=messageIds.filter(id=>id.startsWith(validity+':'))
        .map(id=>Number(id.slice(validity.length+1))).filter(uid=>Number.isInteger(uid)&&uid>0);
      const result:Record<string,boolean>={};if(!uids.length)return result;
      for(let start=0;start<uids.length;start+=500){
        for await(const mail of client.fetch(uids.slice(start,start+500),{uid:true,flags:true},{uid:true}))
          result[validity+':'+mail.uid]=mail.flags?.has('\\Seen')??false;
      }
      return result;
    });
  }
  private async flag(acc:Credentials,messageIds:string[],read:boolean,signal:AbortSignal){
    return this.session(acc,signal,async client=>{
      const box=client.mailbox;assert(box,'PROVIDER_BAD_RESPONSE');
      const validity=String(box.uidValidity),uids=messageIds.filter(id=>id.startsWith(validity+':'))
        .map(id=>Number(id.slice(validity.length+1))).filter(uid=>Number.isInteger(uid)&&uid>0);
      assert(uids.length,'NOT_FOUND');
      for(let start=0;start<uids.length;start+=500){
        const batch=uids.slice(start,start+500);
        if(read)await client.messageFlagsAdd(batch,['\\Seen'],{uid:true});
        else await client.messageFlagsRemove(batch,['\\Seen'],{uid:true});
      }
    },false);
  }
  async markRead(acc:Credentials,messageId:string,read:boolean,signal:AbortSignal){await this.flag(acc,[messageId],read,signal);}
  async markReadMany(acc:Credentials,messageIds:string[],read:boolean,signal:AbortSignal){await this.flag(acc,messageIds,read,signal);}
  async reply(acc:Credentials,message:ReplyMessage,signal:AbortSignal):Promise<ReplyResult>{return sendReply(acc.account,acc.secret,message,signal,this.timeoutMs);}
  closeAccount(id:string){this.pool.close(id);this.pool.close(id+':rw');this.snapshots.delete(id);}
  close(){this.pool.closeAll();this.snapshots.clear();}
}

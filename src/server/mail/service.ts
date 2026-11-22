import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Account, MailMessage, MailSummary, AddAccountInput, BilingualBody, ErrorInfo } from '../../shared/types';
import type { Connector } from './connector';
import type { RawMail } from './parse';
import { normalize } from './parse';
import { dangerous, filename } from './sanitize';
import { validateAccount } from './presets';
import { cleanDraftFilename, isMailboxAddress, maxDraftAttachmentBytes, normalizeEndpoint } from '../../shared/mail';
import type { MailDraftSave } from '../../shared/mail';
import {renderMailMarkdown} from '../../shared/mail-markdown';
import type { Host, Run, Storage } from '../adapter/host';
import type { Vault } from '../vault/store';
import { AppError, assert, errorInfo } from '../../shared/error-codes';
import { bounded, retry } from '../retry';
import type { TranslationService } from '../translate/service';
import { needsTranslation } from '../translate/provider';
import {remoteImages,image} from './images';
import { MailBodyFiles } from './body-files';
import { MailStorage } from './store';
import {DraftUploads} from './draft-uploads';
import { validateEvent } from '../contract';
const clip=(value:string,size:number)=>Array.from(value.trim()).slice(0,size).join('');
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]||char));
const headerText=(value:string,size:number)=>value.replace(/[\r\n\u0000]/g,' ').trim().slice(0,size);
function emailChunks(text:string,limit=5000){
  const chunks:string[]=[];let rest=text.replace(/\r\n/g,'\n').trim();
  while(rest){
    const chars=Array.from(rest);
    if(chars.length<=limit){chunks.push(rest);break;}
    const window=chars.slice(0,limit).join('');let cut=limit;
    for(const marker of ['\n\n','\n','。','！','？','. ','! ','? ','；','; ']){
      const at=window.lastIndexOf(marker);
      if(at>=Math.floor(limit*.55)){cut=Array.from(window.slice(0,at+marker.length)).length;break;}
    }
    const part=chars.slice(0,cut).join('').trim();
    if(part)chunks.push(part);
    rest=chars.slice(cut).join('').trim();
  }
  return chunks;
}
const rawWeight=(mail:RawMail)=>mail.text.length+(mail.html?.length||0)+mail.attachments.reduce((total,item)=>total+item.dataBase64.length,0);
const CACHE_LIMIT=20000,CACHE_BYTES=1_500_000;
const BODY_LIMIT=100,BODY_BYTES=8*1024*1024,BODY_ENTRY_BYTES=1_900_000;
interface MailSyncState {
  initialized?: boolean;
  lastSyncAt?: number;
  lastErrorAt?: number;
  lastError?: ErrorInfo;
  oldestCursor?: string;
  exhausted?: boolean;
  knownCount?: number;
}
interface StoredBody{at:number;raw:RawMail}
type OperationMode='foreground'|'background'|'silent';
export class MailService {
  private raw=new Map<string,RawMail>();
  private rawBytes=0;
  private bilingualCache=new Map<string,BilingualBody>();
  private images=new Map<string,Record<string,string>>();
  private backgroundFailures=new Map<string,number>();
  private readRevisions=new Map<string,number>();
  private pendingPulls=new Map<string,{count:number;removed:Set<string>}>();
  private sendingDrafts=new Set<string>();
  readonly draftUploads=new DraftUploads();
  private mutation:Promise<unknown>=Promise.resolve();
  private bodies:MailBodyFiles;
  private store:MailStorage;
  private preferences:Storage;
  constructor(private host:Host,preferences:Storage,private vault:Vault,private real:Connector,private translator:TranslationService,private timeoutMs:number,private maxBytes:number,key:string){
    this.preferences=preferences;
    this.store=new MailStorage(join(host.paths.dataDir,key,'mail','mail.db'));
    this.bodies=new MailBodyFiles(join(host.paths.dataDir,key));
    host.lifecycle.add(()=>this.close());
  }
  bind(store:Storage){this.preferences=store;}
  close(){this.draftUploads.clear();this.store.close();}
  // 旧键值库只读一次：邮件主体与索引导入 SQLite，正文迁移到独立文件。
  async init(legacy:Storage){
    if(this.store.imported())return;
    const read=async<T>(key:string)=>{try{return await legacy.get<T>(key);}catch{return undefined;}};
    const [accounts,cache,sync,known,readFlags,pending,translated,bilingual,images,bodyIndex]=await Promise.all([
      read<Account[]>('accounts'),read<MailSummary[]>('mail-cache'),read<Record<string,any>>('mail-sync'),
      read<Record<string,number>>('mail-known'),read<Record<string,boolean>>('read'),
      read<Record<string,boolean>>('read-pending'),read<Record<string,boolean>>('translated'),
      read<Record<string,unknown>>('bilingual'),read<Record<string,unknown>>('images'),
      read<Record<string,{at:number;bytes:number}>>('mail-body-index')
    ]);
    await this.store.importLegacy({accounts:(accounts||[]).filter(account=>(account as any).mock!==true),cache,sync,known,
      read:readFlags,pending,translated,bilingual,images});
    const oldBodies=new MailBodyFiles(this.host.paths.dataDir);
    const keys=await legacy.keys().catch(()=>[] as string[]);
    for(const key of keys.filter(key=>key.startsWith('mail-body:'))){
      try{
        const stored=await legacy.get<StoredBody>(key);
        const raw=stored?.raw&&typeof stored.raw.messageId==='string'?stored.raw:undefined;
        if(raw){
          const stripped=key.slice('mail-body:'.length),split=stripped.indexOf(':');
          const bytes=await this.bodies.put(stripped,this.forStorage(raw));
          this.store.putBodyIndex(stripped,split>0?stripped.slice(0,split):'',split>0?stripped.slice(split+1):stripped,bytes);
        }
        // 仅在读取成功后删除旧键，异常时保留给下次启动重试。
        await legacy.delete(key).catch(()=>{});
      }catch{/* 单封正文迁移失败不阻断运行时启动 */}
    }
    for(const [key,info] of Object.entries(bodyIndex||{})){
      if(!key.startsWith('mail-body:'))continue;
      const stripped=key.slice('mail-body:'.length);
      if(!info)continue;
      try{
        const raw=await oldBodies.get(key);
        if(!raw)continue;
        const split=stripped.indexOf(':'),bytes=await this.bodies.put(stripped,this.forStorage(raw));
        this.store.putBodyIndex(stripped,split>0?stripped.slice(0,split):'',split>0?stripped.slice(split+1):stripped,bytes);
        await oldBodies.delete(key).catch(()=>{});
      }catch{/* 旧正文文件迁移失败时保留原文件 */}
    }
    this.store.markImported();
    // 旧键值库保留一份空账号表，避免旧客户端再次读回演示账号。
    await legacy.set('accounts',[]).catch(()=>{});
    await legacy.delete('mode').catch(()=>{});
    await legacy.delete('initialized').catch(()=>{});
    for(const key of ['mail-cache','mail-sync','mail-known','read','read-pending','translated',
      'bilingual','images','mail-body-index'])await legacy.delete(key).catch(()=>{});
  }
  private cachePut<T>(map:Map<string,T>,key:string,value:T,limit:number){
    map.delete(key);map.set(key,value);
    while(map.size>limit){const oldest=map.keys().next().value;if(oldest===undefined)break;map.delete(oldest);}
  }
  private cacheRaw(key:string,value:RawMail){
    const previous=this.raw.get(key);if(previous)this.rawBytes-=rawWeight(previous);
    this.raw.delete(key);this.raw.set(key,value);this.rawBytes+=rawWeight(value);
    while(this.raw.size>12||(this.raw.size>1&&this.rawBytes>64*1024*1024)){
      const oldest=this.raw.keys().next().value;if(oldest===undefined)break;
      const dropped=this.raw.get(oldest);this.raw.delete(oldest);if(dropped)this.rawBytes-=rawWeight(dropped);
    }
  }
  private dropRaw(key:string){
    const dropped=this.raw.get(key);if(!dropped)return;
    this.raw.delete(key);this.rawBytes=Math.max(0,this.rawBytes-rawWeight(dropped));
  }
  // 正文落盘，SQLite 只保存索引；剔除超大附件二进制，下载时按需重取。
  private bodyKey(id:string,messageId:string){return id+':'+messageId;}
  private forStorage(raw:RawMail){
    const copy=structuredClone(raw);copy.text=copy.text.slice(0,512*1024);
    if(copy.html)copy.html=copy.html.slice(0,512*1024);
    for(const item of copy.attachments)if(item.size>512*1024||item.dataBase64.length>1400000)item.dataBase64='';
    while(Buffer.byteLength(JSON.stringify(copy))>BODY_ENTRY_BYTES){
      const big=copy.attachments.find(item=>!!item.dataBase64);
      if(big){big.dataBase64='';continue;}
      if(copy.html&&copy.html.length>1024){copy.html=copy.html.slice(0,Math.floor(copy.html.length/2));continue;}
      if(copy.text.length>1024){copy.text=copy.text.slice(0,Math.floor(copy.text.length/2));continue;}
      break;
    }
    return copy;
  }
  private async touchBodyIndex(key:string,bytes:number){
    const index=await this.store.get<Record<string,{at:number;bytes:number}>>('mail-body-index')||{};
    index[key]={at:Date.now(),bytes};
    let total=Object.values(index).reduce((sum,item)=>sum+item.bytes,0);
    const order=Object.keys(index).sort((a,b)=>index[a].at-index[b].at);
    while((Object.keys(index).length>BODY_LIMIT||total>BODY_BYTES)&&order.length){
      const oldest=order.shift()!;total-=index[oldest].bytes;delete index[oldest];
      await this.bodies.delete(oldest);await this.store.delete(oldest);
    }
    await this.store.set('mail-body-index',index);
  }
  private async bodyGet(key:string){
    const file=await this.bodies.get(key);
    if(file)return file;
    return undefined;
  }
  private async bodyPut(key:string,raw:RawMail){
    const value=this.forStorage(raw),bytes=await this.bodies.put(key,value);
    await this.touchBodyIndex(key,bytes);
  }
  private async bodyDeletePrefix(prefix:string){
    const index=await this.store.get<Record<string,{at:number;bytes:number}>>('mail-body-index')||{};
    let changed=false;
    for(const key of Object.keys(index))if(key.startsWith(prefix)){delete index[key];await this.bodies.delete(key);await this.store.delete(key);changed=true;}
    if(changed)await this.store.set('mail-body-index',index);
    for(const key of await this.store.keys())if(key.startsWith('mail-body:'+prefix))await this.store.delete(key);
  }
  async accounts():Promise<Account[]>{
    const all=(await this.store.get<Account[]>('accounts')||[]).filter(account=>(account as any).mock!==true);
    let changed=false;
    for(const account of all)if(account.provider==='custom'){
      let fixed=false;
      if(account.imap&&normalizeEndpoint(account.imap,'imap'))fixed=true;
      if(account.smtp&&normalizeEndpoint(account.smtp,'smtp'))fixed=true;
      if(fixed){
        changed=true;
        if(account.state.status==='offline'||account.state.status==='auth_failed')account.state={status:'connecting'};
      }
    }
    if(changed)await this.store.set('accounts',all);
    return all;
  }
  private async account(id:string){const account=(await this.accounts()).find(a=>a.id===id);assert(account,'NOT_FOUND');return account;}
  private async save(account:Account){const all=await this.accounts();await this.store.set('accounts',[...all.filter(a=>a.id!==account.id),account]);}
  // 摘要缓存是列表的唯一数据源：按日期升序保存，超出条数或字节预算时从最旧开始淘汰。
  private async loadCache(){return await this.store.get<MailSummary[]>('mail-cache')||[];}
  // 网络请求保持并行，落库与通知判定统一串行，避免后台轮询覆盖前台已读状态。
  private mutate<T>(work:()=>Promise<T>):Promise<T>{
    const next=this.mutation.catch(()=>undefined).then(work);
    this.mutation=next.then(()=>undefined,()=>undefined);
    return next;
  }
  private async trackPull<T>(accountId:string,work:(removed:Set<string>)=>Promise<T>){
    const pull=this.pendingPulls.get(accountId)||{count:0,removed:new Set<string>()};
    this.pendingPulls.set(accountId,pull);pull.count++;
    try{return await work(pull.removed);}
    finally{if(--pull.count===0)this.pendingPulls.delete(accountId);}
  }
  private async saveCache(cache:MailSummary[]){
    const kept=[...cache].sort((a,b)=>a.date-b.date||a.messageId.localeCompare(b.messageId));
    const sizes=kept.map(item=>Buffer.byteLength(JSON.stringify(item))+1);
    let total=sizes.reduce((sum,size)=>sum+size,2),start=0;
    while(start<kept.length-20&&(kept.length-start>CACHE_LIMIT||total>CACHE_BYTES)){total-=sizes[start];start++;}
    const saved=start?kept.slice(start):kept;await this.store.set('mail-cache',saved);return saved;
  }
  private async loadSync(){return await this.store.get<Record<string,MailSyncState>>('mail-sync')||{};}
  private async loadKnown(){return await this.store.get<Record<string,number>>('mail-known')||{};}
  private materialize(cache:MailSummary[],flags:Record<string,boolean>){
    for(const mail of cache){const key=mail.accountId+':'+mail.messageId;if(flags[key]!==undefined)mail.unread=!flags[key];}
    return cache;
  }
  private async readbackEnabled(){const preferences=await this.preferences.get<any>('preferences')||{};return preferences.syncReadReceipts===true;}
  private async pendingReads(){return await this.store.get<Record<string,boolean>>('read-pending')||{};}
  private advanceReadRevision(accountId:string){this.readRevisions.set(accountId,(this.readRevisions.get(accountId)||0)+1);}
  private finishReadback(accountId:string,messageIds:string[],read:boolean){
    return this.mutate(async()=>{
      this.advanceReadRevision(accountId);
      for(const messageId of messageIds)if(this.store.pendingRead(accountId,messageId)===read)
        this.store.deletePendingRead(accountId,messageId);
    });
  }
  private async persistBilingual(key:string,value:BilingualBody){
    this.cachePut(this.bilingualCache,key,structuredClone(value),20);
    const saved=await this.store.get<Record<string,BilingualBody>>('bilingual')||{};
    delete saved[key];saved[key]=structuredClone(value);
    while(Object.keys(saved).length>20||Buffer.byteLength(JSON.stringify(saved))>1_400_000)delete saved[Object.keys(saved)[0]];
    await this.store.set('bilingual',saved);
    const translated=await this.store.get<Record<string,boolean>>('translated')||{};
    translated[key.slice(0,key.lastIndexOf(':'))]=value.segments.some(s=>!!s.translated);await this.store.set('translated',translated);
  }
  // 远程图片缓存持久化：内存优先，store 兜底（≤10 封 / 8MB），重启后已确认图片不再重发请求。
  private async imagesFor(key:string):Promise<Record<string,string>>{
    const cached=this.images.get(key);if(cached)return cached;
    const saved=(await this.store.get<Record<string,Record<string,string>>>('images'))?.[key];
    if(saved)this.cachePut(this.images,key,saved,10);
    return saved||{};
  }
  private async saveImages(key:string,value:Record<string,string>){
    this.cachePut(this.images,key,value,10);
    const saved=await this.store.get<Record<string,Record<string,string>>>('images')||{};
    delete saved[key];saved[key]=value;
    while(Object.keys(saved).length>10||Buffer.byteLength(JSON.stringify(saved))>1_400_000)delete saved[Object.keys(saved)[0]];
    await this.store.set('images',saved);
  }
  private emit(run:Run,type:string,data:object){run.messages.emit(type,{eventId:randomUUID(),...data});}
  private async operation<T>(account:Account,run:Run,fn:(connector:Connector,credentials:{account:Account;secret:string},signal:AbortSignal)=>Promise<T>,mode:OperationMode='foreground',quick=false) {
    const silent=mode==='silent',background=mode==='background',previous=account.state.status;
    if(!silent&&!background&&previous!=='connected'){account.state={status:'connecting'};this.emit(run,'account.state',{accountId:account.id,state:account.state});}
    try {
      const work=async(signal:AbortSignal)=>{
        const credentials={account,secret:await this.vault.get(account.id)};
        try{return await fn(this.real,credentials,signal);}finally{credentials.secret='';}
      };
      const value=quick?await bounded(work,run.signal,this.host.lifecycle,Math.min(this.timeoutMs,10000)):await retry(work,run.signal,this.host.lifecycle,this.timeoutMs);
      this.backgroundFailures.delete(account.id);
      if(!silent){
        account.state={status:'connected',checkedAt:Date.now()};await this.save(account);
        if(previous!=='connected')this.emit(run,'account.state',{accountId:account.id,state:account.state});
      }
      return value;
    } catch(e){
      if(e&&typeof e==='object')(e as any).accountId=account.id;
      if(!silent){
        const error=errorInfo(e),auth=error.code.startsWith('AUTH_');
        const failures=background?(this.backgroundFailures.get(account.id)||0)+1:0;
        if(background)this.backgroundFailures.set(account.id,failures);
        // 后台轮询的偶发网络抖动不立即打断界面状态，连续三次失败才标记离线。
        if(auth||!background||failures>=3){
          const next=auth?{status:'auth_failed' as const,error}:{status:'offline' as const,error};
          const changed=account.state.status!==next.status;
          account.state=next;await this.save(account);
          if(changed)this.emit(run,'account.state',{accountId:account.id,state:account.state});
        }
      }
      throw e;
    }
  }
  async add(input:AddAccountInput,run:Run){
    const address=input.address.trim(),secret=input.provider==='gmail'?input.secret.replace(/\s/g,''):input.secret.trim();
    const custom=input.provider==='custom'?{username:input.username?.trim()||undefined,imap:input.imap,smtp:input.smtp}:undefined;
    validateAccount(input.provider,address,secret,custom);
    const colorToken=input.provider==='163'?'a1':input.provider==='qq'?'a2':input.provider==='gmail'?'a3':'a4';
    const all=await this.accounts(),existing=all.find(a=>a.address.toLowerCase()===address.toLowerCase());
    const account:Account=existing||{id:randomUUID(),provider:input.provider,address,alias:clip(input.alias||(input.provider==='custom'?'IMAP':input.provider),6),
      colorToken,state:{status:'connecting'},createdAt:Date.now()};
    account.provider=input.provider;account.address=address;account.colorToken=colorToken;
    if(input.alias?.trim())account.alias=clip(input.alias,6);
    if(input.provider==='custom'){
      account.username=custom?.username;account.imap={...input.imap!};account.smtp={...input.smtp!};
      normalizeEndpoint(account.imap,'imap');normalizeEndpoint(account.smtp,'smtp');
    }else{
      delete account.username;delete account.imap;delete account.smtp;
    }
    this.real.closeAccount?.(account.id);await this.vault.put(account.id,secret);
    input.secret='';await this.save(account);
    await this.operation(account,run,(connector,c,s)=>connector.test(c,s),'foreground',true);return account;
  }
  async test(id:string,run:Run) {
    const account=await this.account(id);
    return this.operation(account,run,(connector,c,s)=>connector.test(c,s),'foreground',true);
  }
  // 只改本地展示名，不重测连接、不改凭据或连接状态。
  async rename(id:string,alias:string) {
    const account=await this.account(id);
    const value=alias.trim();
    assert(value&&Array.from(value).length<=6);
    account.alias=value;
    await this.save(account);
    return account;
  }
  private async clearMessages(id:string){
    await this.bodyDeletePrefix(id+':');
    this.store.clearAccount(id);
    for(const key of this.raw.keys())if(key.startsWith(id+':'))this.dropRaw(key);
    for(const key of this.bilingualCache.keys())if(key.startsWith(id+':'))this.bilingualCache.delete(key);
    for(const key of this.images.keys())if(key.startsWith(id+':'))this.images.delete(key);
  }
  async remove(id:string) {
    this.real.closeAccount?.(id);
    await this.account(id);await this.vault.delete(id);
    await this.store.set('accounts',(await this.accounts()).filter(a=>a.id!==id));
    await this.clearMessages(id);
    this.readRevisions.delete(id);
    return {removed:true as const};
  }
  async deleteMessage(id:string,messageId:string,run:Run){
    const account=await this.account(id),key=this.bodyKey(id,messageId);
    assert(this.real.moveToTrash,'MAIL_TRASH_UNAVAILABLE');
    await this.operation(account,run,(connector,credentials,signal)=>connector.moveToTrash!(credentials,messageId,signal),'silent',true);
    await this.mutate(async()=>{
      this.pendingPulls.get(id)?.removed.add(messageId);
      await this.bodies.delete(key);
      this.store.removeMessage(id,messageId);
      this.dropRaw(key);this.images.delete(key);
      for(const item of this.bilingualCache.keys())if(item.startsWith(key+':'))this.bilingualCache.delete(item);
    });
    const event={eventId:randomUUID(),accountId:id,messageId};
    validateEvent('mail.deleted',event);
    run.messages.emit('mail.deleted',event,{audience:'plugin'});
    return {deleted:true};
  }
  // 合并一页服务器结果；通知只统计从未记录过且最终仍为未读的 messageId，首次同步与 UIDVALIDITY 重建不通知。
  private async mergePage(account:Account,run:Run,page:{items:MailSummary[];nextCursor?:string;reset?:boolean},seen:Record<string,boolean>|undefined,notify:boolean,readRevision:number|undefined,removed:Set<string>){
    return this.mutate(()=>this.mergePageNow(account,run,{...page,items:page.items.filter(item=>!removed.has(item.messageId))},
      seen&&Object.fromEntries(Object.entries(seen).filter(([id])=>!removed.has(id))),notify,this.readRevisions.get(account.id)===readRevision));
  }
  private async mergePageNow(account:Account,run:Run,page:{items:MailSummary[];nextCursor?:string;reset?:boolean},seen:Record<string,boolean>|undefined,notify:boolean,mergeServerFlags:boolean){
    if(page.reset)await this.clearMessages(account.id);
    const cache=await this.loadCache(),flags=await this.store.get<Record<string,boolean>>('read')||{};
    const pending=await this.pendingReads(),known=await this.loadKnown(),sync=await this.loadSync(),state=sync[account.id]||{};
    const prior=cache.filter(mail=>mail.accountId===account.id),priorIds=new Set(prior.map(mail=>mail.messageId));
    const knownThisAccount=Object.keys(known).filter(key=>key.startsWith(account.id+':')).length;
    const indexMissing=state.knownCount!==undefined&&state.knownCount>0&&knownThisAccount===0;
    const baseline=!!page.reset||!state.initialized||indexMissing||(!knownThisAccount&&prior.length>0);
    const fresh=page.items.filter(item=>!priorIds.has(item.messageId)&&!known[account.id+':'+item.messageId]);
    const serverSeen={...(seen||{})};for(const item of page.items)if(serverSeen[item.messageId]===undefined)serverSeen[item.messageId]=!item.unread;
    const cleared:string[]=[],readUpdates:{accountId:string;messageId:string;read:boolean}[]=[];
    if(mergeServerFlags&&await this.readbackEnabled())for(const [messageId,isSeen] of Object.entries(serverSeen)){
      const key=account.id+':'+messageId;
      if(pending[key]!==undefined){if(pending[key]===isSeen)cleared.push(key);continue;}
      if(flags[key]!==isSeen){flags[key]=isSeen;readUpdates.push({accountId:account.id,messageId,read:isSeen});}
    }
    const merged=[...cache.filter(mail=>mail.accountId!==account.id||!page.items.some(item=>item.messageId===mail.messageId)),...page.items];
    this.materialize(merged,flags);
    const knownEntries:{accountId:string;messageId:string;at:number}[]=[];
    for(const mail of merged)if(mail.accountId===account.id&&known[mail.accountId+':'+mail.messageId]===undefined){
      known[mail.accountId+':'+mail.messageId]=Date.now();
      knownEntries.push({accountId:mail.accountId,messageId:mail.messageId,at:known[mail.accountId+':'+mail.messageId]});
    }
    if(cleared.length)await this.store.deletePendingReads(cleared);
    if(readUpdates.length)await this.store.setReadFlags(readUpdates);
    // 已见过的 messageId 不随缓存淘汰一起删除，否则旧邮件重新进入
    // 最新一页时会被误判为“新邮件”并重复提醒。
    await this.saveCache(merged);
    if(knownEntries.length)await this.store.markKnown(knownEntries);
    const next=sync[account.id]||{};next.initialized=true;next.lastSyncAt=Date.now();delete next.lastError;delete next.lastErrorAt;
    if(page.nextCursor){
      next.oldestCursor=page.nextCursor;
      next.exhausted=false;
    }else{
      delete next.oldestCursor;
      next.exhausted=true;
    }
    next.knownCount=await this.store.knownCount(account.id);
    await this.store.saveSyncState(account.id,next);
    if(notify&&!baseline){
      const messageIds:string[]=[];
      for(const item of fresh){
        const pendingRead=await this.store.pendingRead(account.id,item.messageId);
        const read=pendingRead!==undefined?pendingRead:await this.store.readFlag(account.id,item.messageId);
        if(read===undefined?item.unread:!read)messageIds.push(item.messageId);
      }
      if(messageIds.length)
      this.emit(run,'mail.arrived',{accountId:account.id,count:messageIds.length,messageIds});
    }
    return baseline?0:fresh.length;
  }
  private async pullNewest(account:Account,run:Run,limit:number,notify:boolean,mode:OperationMode,removed:Set<string>){
    const prior=(await this.loadCache()).filter(mail=>mail.accountId===account.id),readback=await this.readbackEnabled();
    const readRevision=this.readRevisions.get(account.id);
    const {page,seen}=await this.operation(account,run,async(connector,c,s)=>{
      const page=await connector.list(c,{limit},s);
      let seen:Record<string,boolean>|undefined;
      if(readback&&connector.seen&&prior.length)try{seen=await connector.seen(c,prior.slice(-500).map(mail=>mail.messageId),s);}catch{/* flags 读取失败时保留本地状态，下次同步校正。 */}
      return {page,seen};
    },mode);
    return await this.mergePage(account,run,page,seen,notify,readRevision,removed);
  }
  private async oldestCachedMessageIds(accountId:string,limit:number){
    const cache=await this.loadCache();
    return cache.filter(mail=>mail.accountId===accountId)
      .sort((a,b)=>a.date-b.date||a.messageId.localeCompare(b.messageId))
      .slice(0,Math.max(limit,20)).map(mail=>mail.messageId);
  }
  private async pullOlder(account:Account,run:Run,state:MailSyncState,limit:number,mode:OperationMode,removed:Set<string>){
    const cachedMessageIds=state.oldestCursor?[]:await this.oldestCachedMessageIds(account.id,limit);
    const readRevision=this.readRevisions.get(account.id);
    const page=await this.operation(account,run,async(connector,c,s)=>{
      let cursor=state.oldestCursor;
      if(!cursor&&connector.olderCursor)cursor=await connector.olderCursor(c,cachedMessageIds,s);
      if(!cursor)return undefined;
      return connector.list(c,{limit,cursor},s);
    },mode);
    if(!page){
      await this.mutate(async()=>{
        const sync=await this.loadSync();
        await this.store.saveSyncState(account.id,{...(sync[account.id]||state),initialized:true,exhausted:true});
      });
      return false;
    }
    if(page.reset){await this.pullNewest(account,run,limit,false,mode,removed);return true;}
    await this.mergePage(account,run,page,undefined,false,readRevision,removed);
    return true;
  }
  unreadStatus(accountId:string,messageIds:string[]){
    return {messageIds:this.store.unreadMessageIds(accountId,messageIds)};
  }
  async list(input:any,run:Run,mode:OperationMode='foreground'){
    const accounts=(await this.accounts()).filter(a=>!input.accountIds?.length||input.accountIds.includes(a.id));
    const limit=Number(input.limit||20),offset=Number(input.cursor||0),refresh=input.refresh===true;
    assert(Number.isInteger(limit)&&limit>0&&limit<=100&&Number.isInteger(offset)&&offset>=0);
    const partial:ErrorInfo[]=[];let updated=0,sync=await this.loadSync();
    // 默认只读本地缓存；refresh=true、首次使用或缓存为空时才访问 IMAP。
    for(const account of accounts){
      if(!refresh&&sync[account.id]?.initialized)continue;
      try{await this.trackPull(account.id,removed=>this.pullNewest(account,run,Math.max(limit,50),refresh,mode,removed));updated++;}
      catch(e){
        const error=errorInfo(e);partial.push({...error,accountId:account.id});
        await this.mutate(async()=>{
          const latest=await this.loadSync();
          await this.store.saveSyncState(account.id,{...(latest[account.id]||{}),lastError:error,lastErrorAt:Date.now()});
        });
      }
    }
    let cache=await this.loadCache();sync=await this.loadSync();
    const visible=()=>cache.filter(mail=>accounts.some(account=>account.id===mail.accountId));
    // 滚动到本地缓存末尾时才向服务器拉取更早的邮件，普通翻页不发请求。
    if(offset>0&&offset>=visible().length){
      for(const account of accounts){
        const state=sync[account.id];
        if(!state||state.exhausted===true)continue;
        if(!state.oldestCursor&&!this.real.olderCursor)continue;
        try{if(await this.trackPull(account.id,removed=>this.pullOlder(account,run,state,50,mode,removed)))updated++;}catch(e){partial.push({...errorInfo(e),accountId:account.id});}
      }
      cache=await this.loadCache();sync=await this.loadSync();
    }
    const flags=await this.store.get<Record<string,boolean>>('read')||{},translated=await this.store.get<Record<string,boolean>>('translated')||{};
    const ids=new Set(accounts.map(account=>account.id));
    const items=cache.filter(mail=>ids.has(mail.accountId)).map(mail=>({...mail,translated:!!translated[mail.accountId+':'+mail.messageId],
      unread:flags[mail.accountId+':'+mail.messageId]===undefined?mail.unread:!flags[mail.accountId+':'+mail.messageId]}))
      .sort((a,b)=>b.date-a.date||a.messageId.localeCompare(b.messageId));
    const unreadByAccount:Record<string,number>={};
    for(const mail of cache)if(flags[mail.accountId+':'+mail.messageId]===undefined?mail.unread:!flags[mail.accountId+':'+mail.messageId])
      unreadByAccount[mail.accountId]=(unreadByAccount[mail.accountId]||0)+1;
    const pageItems=items.slice(offset,offset+limit),consumed=offset+pageItems.length;
    const hasOlderPage=accounts.some(account=>{
      const state=sync[account.id];
      if(state?.oldestCursor)return true;
      if(!this.real.olderCursor||state?.exhausted===true)return false;
      return cache.some(mail=>mail.accountId===account.id);
    });
    const next=consumed<items.length||hasOlderPage?String(consumed):undefined;
    const lastSyncAt=Math.max(0,...accounts.map(account=>sync[account.id]?.lastSyncAt||0));
    return {items:pageItems,...(next?{nextCursor:next}:{}),partial,updated,total:accounts.length,cached:items.length,unreadByAccount,...(lastSyncAt?{lastSyncAt}:{})};
  }
  private async getRaw(id:string,messageId:string,run:Run,refetch=false) {
    const account=await this.account(id),key=id+':'+messageId,bodyKey=this.bodyKey(id,messageId);
    let raw=refetch?undefined:this.raw.get(key)||await this.bodyGet(bodyKey);
    if(!raw){raw=await this.operation(account,run,(connector,c,s)=>connector.fetch(c,messageId,s));await this.bodyPut(bodyKey,raw);}
    this.cacheRaw(key,raw);
    return {account,raw};
  }
  private async upsertSummary(mail:MailMessage){
    await this.mutate(async()=>{
      const cache=await this.loadCache();
      const summary:MailSummary={accountId:mail.accountId,messageId:mail.messageId,from:mail.from,subject:mail.subject,
        snippet:mail.snippet,date:mail.date,unread:mail.unread,hasAttachments:mail.hasAttachments,lang:mail.lang,translated:mail.translated};
      const next=[...cache.filter(mail=>mail.accountId!==summary.accountId||mail.messageId!==summary.messageId),summary];
      await this.saveCache(next);
      await this.store.markKnown([{accountId:summary.accountId,messageId:summary.messageId,at:Date.now()}]);
    });
  }
  async get(id:string,messageId:string,run:Run):Promise<MailMessage>{
    const {account,raw}=await this.getRaw(id,messageId,run);
    const mail=normalize(raw,account,this.maxBytes,await this.imagesFor(id+':'+messageId));
    const pending=await this.store.pendingRead(id,messageId);
    const read=pending!==undefined?pending:await this.store.readFlag(id,messageId);
    if(read!==undefined)mail.unread=!read;
    raw.unread=mail.unread;await this.upsertSummary(mail);
    return mail;
  }
  async imageDomains(id:string,messageId:string,run:Run){
    const {raw}=await this.getRaw(id,messageId,run);return {domains:[...new Set(remoteImages(raw.html||'').map(url=>new URL(url).hostname.toLowerCase()))]};
  }
  async loadImages(id:string,messageId:string,confirmed:boolean,allowedDomains:string[],run:Run){
    assert(confirmed===true);
    const {account,raw}=await this.getRaw(id,messageId,run),images:Record<string,string>={};
    const urls=remoteImages(raw.html||''),available=new Set(urls.map(url=>new URL(url).hostname.toLowerCase()));
    const allowed=allowedDomains.map(domain=>domain.trim().toLowerCase());
    assert(allowed.every(domain=>available.has(domain)),'VALIDATION');
    const baseBytes=Buffer.byteLength(normalize(raw,account,this.maxBytes,{}).html||'');
    const imageBudget=Math.max(0,460*1024-baseBytes);
    let failed=0,bytes=0;
    const queue=[...urls];
    await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{
      while(queue.length){
        const url=queue.shift()!;
        const domain=new URL(url).hostname.toLowerCase();
        if(!allowed.includes(domain)){failed++;continue;}
        try{
          const data=await image(url,run.signal,this.host.lifecycle,allowed);
          if(bytes+data.length>imageBudget){failed++;continue;}
          images[url]=data;bytes+=data.length;
        }catch{failed++;}
      }
    }));
    await this.saveImages(id+':'+messageId,images);
    return {...normalize(raw,account,this.maxBytes,images),imageNotice:failed?`已加载 ${Object.keys(images).length} 张图片，${failed} 张未加载`:`已加载 ${Object.keys(images).length} 张图片`};
  }
  async attachment(id:string,messageId:string,attachmentId:string,run:Run) {
    const {account,raw}=await this.getRaw(id,messageId,run);
    let attachment=raw.attachments.find(a=>a.id===attachmentId);
    if(attachment&&!attachment.dataBase64){
      const fresh=await this.getRaw(id,messageId,run,true);
      attachment=fresh.raw.attachments.find(a=>a.id===attachmentId);
    }
    assert(attachment,'NOT_FOUND');assert(!dangerous(attachment.filename,attachment.mime));
    assert(attachment.size<=this.maxBytes,'ATTACHMENT_TOO_LARGE');
    assert(Buffer.byteLength(attachment.dataBase64,'base64')<=this.maxBytes,'ATTACHMENT_TOO_LARGE');
    return {filename:filename(attachment.filename),mime:attachment.mime,size:attachment.size,dataBase64:attachment.dataBase64};
  }
  async markRead(id:string,messageId:string,read:boolean,run:Run) {
    const account=await this.account(id);assert(typeof read==='boolean');
    const key=id+':'+messageId,readback=await this.readbackEnabled();
    await this.mutate(async()=>{
      this.advanceReadRevision(id);
      await this.store.setReadFlag(id,messageId,read);
      // 先登记待回写覆盖，避免后台同步在 IMAP 写入完成前用旧服务器状态覆盖本机已读。
      if(readback)await this.store.setPendingRead(id,messageId,read);
      const cache=await this.loadCache(),summary=cache.find(mail=>mail.accountId===id&&mail.messageId===messageId);
      if(summary){summary.unread=!read;await this.saveCache(cache);}
      const raw=this.raw.get(key);if(raw)raw.unread=!read;
    });
    this.emit(run,'mail.read',{accountId:id,messageId,read});
    let synced:boolean|undefined;
    if(readback){
      synced=false;
      if(this.real.markRead)try{
        await this.operation(account,run,(connector,c,s)=>connector.markRead!(c,messageId,read,s),'silent');
        await this.finishReadback(id,[messageId],read);synced=true;
      }catch{/* 保留 read_pending，下次同步继续以本机状态为准。 */}
    }
    return synced===undefined?{ok:true}:{ok:true,synced};
  }
  async markAllRead(accountIds:string[]|undefined,run:Run) {
    const ids=Array.isArray(accountIds)&&accountIds.length?new Set(accountIds):undefined;
    let updated=0;const pending:Record<string,string[]>={},readback=await this.readbackEnabled();
    await this.mutate(async()=>{
      const cache=await this.store.get<MailSummary[]>('mail-cache')||[],flags=await this.store.get<Record<string,boolean>>('read')||{};
      const updates:{accountId:string;messageId:string;read:boolean}[]=[];
      for(const mail of cache){
        if(ids&&!ids.has(mail.accountId))continue;
        const key=mail.accountId+':'+mail.messageId,unread=flags[key]===undefined?mail.unread:!flags[key];
        if(!unread)continue;
        flags[key]=true;updated++;(pending[mail.accountId]||(pending[mail.accountId]=[])).push(mail.messageId);
        updates.push({accountId:mail.accountId,messageId:mail.messageId,read:true});
        mail.unread=false;
        const raw=this.raw.get(key);if(raw)raw.unread=false;
      }
      if(updates.length){
        for(const accountId of Object.keys(pending))this.advanceReadRevision(accountId);
        await this.store.setReadFlags(updates);
        if(readback)await this.store.setPendingReads(updates);
        await this.saveCache(cache);
      }
    });
    let synced:boolean|undefined;
    if(readback){
      synced=true;const accounts=await this.accounts();
      for(const [accountId,messageIds] of Object.entries(pending)){
        const account=accounts.find(item=>item.id===accountId);
        if(!account||!this.real.markReadMany){synced=false;continue;}
        try{
          await this.operation(account,run,(connector,c,s)=>connector.markReadMany!(c,messageIds,true,s),'silent');
          await this.finishReadback(accountId,messageIds,true);
        }catch{synced=false;}
      }
    }
    return synced===undefined?{updated}:{updated,synced};
  }
  listDrafts(){return this.store.listDrafts();}
  getDraft(id:string){
    const draft=this.store.getDraft(id);assert(draft,'NOT_FOUND');return draft;
  }
  saveDraft({id,accountId,to,subject,body,format,attachments}:MailDraftSave){
    if(id)assert(!this.sendingDrafts.has(id),'TIMEOUT');
    const existing=id?this.getDraft(id):undefined;
    const previous=existing?.attachments??[], additions:({id:string;name:string;bytes:number;content:Buffer})[]=[];
    const selected=attachments===undefined?previous:attachments.map(file=>{
      const saved=previous.find(item=>item.id===file.id);
      if(saved)return saved;
      const name=cleanDraftFilename(file.name);
      assert(name&&name===file.name&&!dangerous(name,''));
      const content=this.draftUploads.complete(file.id,'attachment'),meta={id:file.id,name,bytes:content.length};
      additions.push({...meta,content});return meta;
    });
    assert(new Set(selected.map(file=>file.id)).size===selected.length);
    assert(selected.reduce((sum,file)=>sum+file.bytes,0)<=maxDraftAttachmentBytes);
    const mode=format??existing?.format;
    const saved=this.store.saveDraft({id:id??randomUUID(),accountId,to,subject,body,updatedAt:Date.now(),
      ...(mode?{format:mode}:{}),...(selected.length?{attachments:selected}:{})},!!id,additions);
    for(const file of additions)this.draftUploads.drop(file.id);
    return saved;
  }
  deleteDraft(id:string){
    assert(!this.sendingDrafts.has(id),'TIMEOUT');return this.store.deleteDraft(id);
  }
  async sendDraft(id:string,run:Run){
    assert(!this.sendingDrafts.has(id),'TIMEOUT');
    const draft=this.getDraft(id),to=draft.to.trim(),subject=draft.subject.trim(),text=draft.body;
    assert(isMailboxAddress(to)&&subject&&!/[\x00-\x1f\x7f]/.test(draft.subject)&&(text.trim()||draft.attachments?.length));
    const account=await this.account(draft.accountId),send=this.real.reply?.bind(this.real);assert(send,'INTERNAL');
    return bounded(async signal=>{
      assert(!signal.aborted,'TIMEOUT');
      this.sendingDrafts.add(id);
      try{
        const secret=await this.vault.get(account.id);
        assert(!signal.aborted,'TIMEOUT');
        const attachments=draft.attachments?.length?this.store.draftAttachments(id):undefined;
        const html=draft.format==='markdown'&&text.trim()?renderMailMarkdown(text):undefined;
        const sent=await send({account,secret},{to,subject,text,...(html?{html}:{}),...(attachments?{attachments}:{})},signal);
        this.store.deleteDraft(id);
        return {sent:true,...(sent.messageId?{messageId:headerText(sent.messageId,900)}:{})};
      }finally{this.sendingDrafts.delete(id);}
    },run.signal,this.host.lifecycle,draft.attachments?.length?this.timeoutMs:Math.min(this.timeoutMs,10000));
  }
  async reply(id:string,messageId:string,body:string,run:Run) {
    const account=await this.account(id),text=body.trim();
    assert(text.length>0&&text.length<=20000,'VALIDATION');
    const send=this.real.reply?.bind(this.real);assert(send,'INTERNAL');
    const {raw}=await this.getRaw(id,messageId,run);
    const to=(raw.replyTo||[]).find(item=>item.address)?.address||raw.from.address;
    assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(to),'VALIDATION');
    const subject=headerText(/^re\s*:/i.test(raw.subject)?raw.subject:`Re: ${raw.subject}`,900);
    const original=(raw.text||'').trim().slice(0,12000);
    const quote=original?`\n\n--- ${headerText(raw.from.name||raw.from.address,200)} 的原邮件 ---\n${original}`:'';
    const html=`<div>${escapeHtml(text).replace(/\n/g,'<br>')}</div>${original?`<blockquote style="margin:14px 0 0;padding-left:12px;border-left:2px solid #ccc;color:#666">${escapeHtml(original).replace(/\n/g,'<br>')}</blockquote>`:''}`;
    const inReplyTo=raw.rfcMessageId?headerText(raw.rfcMessageId,900):undefined;
    const references=[...(raw.references||[]),...(inReplyTo?[inReplyTo]:[])]
      .map(item=>headerText(item,900)).filter(Boolean).slice(-20);
    const sent=await this.operation(account,run,(connector,c,s)=>send(c,{to,subject,text:text+quote,html,inReplyTo,references},s),'silent',true);
    return {sent:true,...(sent.messageId?{messageId:headerText(sent.messageId,900)}:{})};
  }
  async bilingual(input:any,run:Run) {
    const mail=await this.get(input.accountId,input.messageId,run),key=input.accountId+':'+input.messageId+':'+input.target;
    const sources=emailChunks(mail.text),stored=this.bilingualCache.get(key)||(await this.store.get<Record<string,BilingualBody>>('bilingual'))?.[key];
    const previous=stored&&stored.segments.length===sources.length&&stored.segments.every((segment,index)=>segment.source===sources[index])?stored:undefined;
    if(previous&&!input.retry&&!Number.isInteger(input.segmentIndex)&&!input.continue)return previous;
    const result:BilingualBody=previous||{messageId:mail.messageId,segments:sources.map((source,index)=>({source,index})),complete:false};
    let budget=5000;const start=input.continue?result.segments.findIndex(s=>!s.translated&&!s.error):0;
    for(const segment of result.segments.slice(Math.max(start,0))){
      if(run.signal.aborted)throw new AppError('TIMEOUT');
      if(Number.isInteger(input.segmentIndex)&&segment.index!==input.segmentIndex)continue;
      if(segment.translated&&!input.retry)continue;
      if(segment.source.length>budget)break;
      budget-=segment.source.length;
      try{segment.translated=needsTranslation(segment.source,input.target)?(await this.translator.run({text:segment.source,from:'auto',to:input.target},run)).result!.translated:segment.source;delete segment.error;}
      catch(e){segment.error=errorInfo(e);}
      await this.persistBilingual(key,result);this.emit(run,'translate.progress',{jobId:key,done:segment.index+1,total:sources.length,segment:structuredClone(segment)});
    }
    result.complete=result.segments.every(s=>!!s.translated);await this.persistBilingual(key,result);return structuredClone(result);
  }
}

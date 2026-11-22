import {describe,it,expect,vi} from 'vitest';
import {readdirSync} from 'node:fs';
import {FixtureConnector} from '../fixtures/connector';
import {memoryStorage} from '../harness-host';
import {harness,unwrap,addFixtures} from '../helpers';
import type {Credentials} from '../../src/server/mail/connector';
import type {RawMail} from '../../src/server/mail/parse';
import {mailBodiesDir,openMailDb} from '../mail-db';

class GrowingConnector extends FixtureConnector {
  private extras=new Map<string,RawMail[]>();
  add(accountId:string,mail:RawMail){this.extras.set(accountId,[...(this.extras.get(accountId)||[]),mail]);}
  async list(acc:Credentials,q:{cursor?:string;limit:number},signal:AbortSignal){
    const base=await super.list(acc,q,signal);
    if(q.cursor)return base;
    const extra=(this.extras.get(acc.account.id)||[]).map(mail=>({accountId:acc.account.id,messageId:mail.messageId,
      from:mail.from,subject:mail.subject,snippet:mail.text.slice(0,140),date:mail.date,unread:mail.unread,hasAttachments:false}));
    return {...base,items:[...extra,...base.items].slice(0,q.limit)};
  }
}

class EmptyThenGrowingConnector extends FixtureConnector {
  private extras=new Map<string,RawMail[]>();
  add(accountId:string,mail:RawMail){this.extras.set(accountId,[...(this.extras.get(accountId)||[]),mail]);}
  async list(acc:Credentials,q:{cursor?:string;limit:number},signal:AbortSignal){
    await this.test(acc,signal);
    const all=(this.extras.get(acc.account.id)||[]).map(mail=>({accountId:acc.account.id,messageId:mail.messageId,
      from:mail.from,subject:mail.subject,snippet:mail.text.slice(0,140),date:mail.date,unread:mail.unread,hasAttachments:false}));
    const start=Number(q.cursor||0);
    return {items:all.slice(start,start+q.limit),nextCursor:start+q.limit<all.length?String(start+q.limit):undefined};
  }
}

class BulkConnector extends FixtureConnector {
  constructor(private total=20){super();}
  async olderCursor(_acc:Credentials,messageIds:string[],_signal:AbortSignal){
    const indexes=messageIds.map(id=>Number(id.replace('bulk-',''))).filter(value=>Number.isInteger(value)&&value>=0);
    if(!indexes.length)return undefined;
    const next=Math.max(...indexes)+1;
    return next<this.total?String(next):undefined;
  }
  async list(acc:Credentials,q:{cursor?:string;limit:number},signal:AbortSignal){
    await this.test(acc,signal);
    const all=Array.from({length:this.total},(_,index)=>({accountId:acc.account.id,messageId:'bulk-'+index,
      from:{name:'Bulk',address:'bulk@example.com'},subject:'Bulk '+index,snippet:'',date:1_800_000_000_000-index,
      unread:true,hasAttachments:false}));
    const start=Number(q.cursor||0);
    return {items:all.slice(start,start+q.limit),nextCursor:start+q.limit<all.length?String(start+q.limit):undefined};
  }
}

describe('本地优先与真实通知',()=>{
  it('较早发出的后台同步不会恢复已删除的邮件或丢弃同批新邮件',async()=>{
    const real=Object.assign(new GrowingConnector(),{moveToTrash:vi.fn(async()=>{})}),h=await harness({real});
    let release=()=>{},enter=()=>{};
    const gate=new Promise<void>(resolve=>{release=resolve}),entered=new Promise<void>(resolve=>{enter=resolve});
    let poll:Promise<unknown>|undefined;
    try{
      const account=await unwrap(h,'mail.account.add',{provider:'163',address:'bulk@163.com',secret:'auth-code'});
      const initial=await unwrap(h,'mail.list');
      const original=real.list.bind(real),messageId=initial.items[0].messageId;
      real.add(account.id,{messageId:'fresh',from:{address:'sender@example.com'},subject:'Fresh',date:1_800_000_000_000,text:'Body',unread:true,attachments:[]});
      vi.spyOn(real,'list').mockImplementationOnce(async(acc,query,signal)=>{
        const page=await original(acc,query,signal);enter();await gate;return page;
      });
      poll=h.runAction('mail.poll');await entered;
      await unwrap(h,'mail.delete',{accountId:account.id,messageId});
      release();await poll;
      const page=await unwrap(h,'mail.list');
      expect(page.items.map((mail:any)=>mail.messageId)).not.toContain(messageId);
      expect(page.items[0].messageId).toBe('fresh');
      expect(h.events.filter(event=>event.type==='mail.arrived').map(event=>event.data.messageIds)).toEqual([['fresh']]);
    }finally{release();await poll;await h.close();}
  });

  it('通知复核只返回当前账号本地仍未读的邮件，不访问 IMAP',async()=>{
    const real=new BulkConnector(2),list=vi.spyOn(real,'list'),h=await harness({real});
    try{
      const [account,other]=await addFixtures(h);
      await unwrap(h,'mail.list',{accountIds:[account.id]});
      await unwrap(h,'mail.mark-read',{accountId:account.id,messageId:'bulk-0',read:true});
      list.mockClear();
      const messageIds=['bulk-0','bulk-1','bulk-1','unknown'];
      expect(await unwrap(h,'mail.unread-status',{accountId:account.id,messageIds})).toEqual({messageIds:['bulk-1']});
      expect(await unwrap(h,'mail.unread-status',{accountId:other.id,messageIds})).toEqual({messageIds:[]});
      expect(list).not.toHaveBeenCalled();
    }finally{await h.close();}
  });

  it('首次同步后列表与翻页只读本地，滚动到缓存末尾才拉取更早邮件',async()=>{
    const real=new BulkConnector(120),list=vi.spyOn(real,'list'),h=await harness({real});
    try{
      await unwrap(h,'mail.account.add',{provider:'163',address:'bulk@163.com',secret:'auth-code'});
      const first=await unwrap(h,'mail.list',{limit:20});
      expect(first.items).toHaveLength(20);expect(first.lastSyncAt).toBeGreaterThan(0);
      expect(list).toHaveBeenCalledTimes(1);
      list.mockClear();
      const second=await unwrap(h,'mail.list',{limit:20,cursor:first.nextCursor});
      expect(second.items).toHaveLength(20);expect(list).not.toHaveBeenCalled();
      const third=await unwrap(h,'mail.list',{limit:20,cursor:second.nextCursor});
      expect(third.items).toHaveLength(10);expect(third.nextCursor).toBe('50');expect(list).not.toHaveBeenCalled();
      const fourth=await unwrap(h,'mail.list',{limit:20,cursor:third.nextCursor});
      expect(fourth.items).toHaveLength(20);expect(list).toHaveBeenCalledTimes(1);
      expect(h.events.filter(event=>event.type==='mail.arrived')).toHaveLength(0);
    }finally{await h.close();}
  });

  it('首次同步 20 封不通知，真正新增 1 封只通知一次',async()=>{
    const real=new GrowingConnector(),h=await harness({real});
    try{
      const accounts=await addFixtures(h),gmail=accounts.find((account:any)=>account.provider==='gmail');
      const first=await unwrap(h,'mail.list',{limit:20});
      expect(first.items).toHaveLength(16);
      expect(h.events.filter(event=>event.type==='mail.arrived')).toHaveLength(0);
      await unwrap(h,'mail.list',{limit:20,refresh:true});
      expect(h.events.filter(event=>event.type==='mail.arrived')).toHaveLength(0);
      real.add(gmail.id,{messageId:'gmail-new',from:{name:'New',address:'new@example.com'},subject:'New mail',
        date:1_800_000_000_000,text:'new body',unread:true,attachments:[]});
      await unwrap(h,'mail.list',{limit:20,refresh:true});
      const arrived=h.events.filter(event=>event.type==='mail.arrived');
      expect(arrived).toHaveLength(1);expect(arrived[0].data).toMatchObject({accountId:gmail.id,count:1,messageIds:['gmail-new']});
      await unwrap(h,'mail.list',{limit:20,refresh:true});
      expect(h.events.filter(event=>event.type==='mail.arrived')).toHaveLength(1);
    }finally{await h.close();}
  });

  it('并发同步同一封新邮件只通知一次',async()=>{
    const real=new GrowingConnector(),h=await harness({real});
    try{
      const accounts=await addFixtures(h),gmail=accounts.find((account:any)=>account.provider==='gmail');
      await unwrap(h,'mail.list',{limit:20});
      real.add(gmail.id,{messageId:'gmail-concurrent',from:{name:'Concurrent',address:'concurrent@example.com'},
        subject:'Concurrent mail',date:1_800_000_000_010,text:'concurrent body',unread:true,attachments:[]});
      await Promise.all([
        unwrap(h,'mail.list',{accountIds:[gmail.id],limit:20,refresh:true}),
        unwrap(h,'mail.list',{accountIds:[gmail.id],limit:20,refresh:true}),
      ]);
      const arrived=h.events.filter(event=>event.type==='mail.arrived');
      expect(arrived).toHaveLength(1);
      expect(arrived[0].data).toMatchObject({accountId:gmail.id,count:1,messageIds:['gmail-concurrent']});
    }finally{await h.close();}
  });

  it('新发现但已读的邮件不通知，混合增量只统计未读',async()=>{
    const real=new GrowingConnector(),h=await harness({real});
    try{
      const accounts=await addFixtures(h),gmail=accounts.find((account:any)=>account.provider==='gmail');
      await unwrap(h,'mail.list',{limit:20});
      expect(h.events.filter(event=>event.type==='mail.arrived')).toHaveLength(0);

      real.add(gmail.id,{messageId:'gmail-read-new',from:{name:'Read',address:'read@example.com'},subject:'Already read',
        date:1_800_000_000_001,text:'read body',unread:false,attachments:[]});
      await unwrap(h,'mail.list',{limit:20,refresh:true});
      expect(h.events.filter(event=>event.type==='mail.arrived')).toHaveLength(0);

      real.add(gmail.id,{messageId:'gmail-unread-new',from:{name:'Unread',address:'unread@example.com'},subject:'Unread',
        date:1_800_000_000_002,text:'unread body',unread:true,attachments:[]});
      await unwrap(h,'mail.list',{limit:20,refresh:true});
      let arrived=h.events.filter(event=>event.type==='mail.arrived');
      expect(arrived).toHaveLength(1);expect(arrived[0].data).toMatchObject({accountId:gmail.id,count:1});

      real.add(gmail.id,{messageId:'gmail-mixed-read',from:{name:'Mixed read',address:'mixed-read@example.com'},
        subject:'Mixed read',date:1_800_000_000_003,text:'read body',unread:false,attachments:[]});
      real.add(gmail.id,{messageId:'gmail-mixed-unread',from:{name:'Mixed unread',address:'mixed-unread@example.com'},
        subject:'Mixed unread',date:1_800_000_000_004,text:'unread body',unread:true,attachments:[]});
      await unwrap(h,'mail.list',{limit:20,refresh:true});
      arrived=h.events.filter(event=>event.type==='mail.arrived');
      expect(arrived).toHaveLength(2);expect(arrived[1].data).toMatchObject({accountId:gmail.id,count:1});
    }finally{await h.close();}
  });

  it('已见索引丢失后重新同步旧邮件按基线处理，不误报新邮件',async()=>{
    const real=new GrowingConnector(),h=await harness({real});
    try{
      const accounts=await addFixtures(h);
      const gmail=accounts.find((account:any)=>account.provider==='gmail');
      const first=await unwrap(h,'mail.list',{limit:20});
      expect(first.items.length).toBeGreaterThan(0);
      expect(h.events.filter(event=>event.type==='mail.arrived')).toHaveLength(0);
      const db=openMailDb(h.directory);
      db.exec('DELETE FROM messages; DELETE FROM known_messages;');
      db.close();
      const again=await unwrap(h,'mail.list',{limit:20,refresh:true});
      expect(again.items.length).toBeGreaterThan(0);
      expect(h.events.filter(event=>event.type==='mail.arrived')).toHaveLength(0);
      await unwrap(h,'mail.list',{accountIds:[gmail.id],limit:20,refresh:true});
      expect(h.events.filter(event=>event.type==='mail.arrived')).toHaveLength(0);
    }finally{await h.close();}
  });

  it('首次同步确实是空收件箱时，之后第一封新邮件仍会通知',async()=>{
    const real=new EmptyThenGrowingConnector(),h=await harness({real});
    try{
      const accounts=await addFixtures(h),gmail=accounts.find((account:any)=>account.provider==='gmail');
      const first=await unwrap(h,'mail.list',{limit:20});
      expect(first.items).toHaveLength(0);
      expect(h.events.filter(event=>event.type==='mail.arrived')).toHaveLength(0);
      real.add(gmail.id,{messageId:'first-real',from:{name:'First',address:'first@example.com'},subject:'First mail',
        date:1_800_000_000_000,text:'first body',unread:true,attachments:[]});
      await unwrap(h,'mail.list',{accountIds:[gmail.id],limit:20,refresh:true});
      const arrived=h.events.filter(event=>event.type==='mail.arrived');
      expect(arrived).toHaveLength(1);
      expect(arrived[0].data).toMatchObject({accountId:gmail.id,count:1,messageIds:['first-real']});
    }finally{await h.close();}
  });

  it('通知发出前重新读取已读状态，并发标为已读的新邮件不再提示',async()=>{
    const real=new GrowingConnector(),h=await harness({real});
    try{
      const accounts=await addFixtures(h),account=accounts.find((item:any)=>item.provider==='gmail');
      for(const other of accounts.filter((item:any)=>item.id!==account.id))
        await unwrap(h,'mail.account.remove',{accountId:other.id});
      await unwrap(h,'mail.list',{limit:20});
      real.add(account.id,{messageId:'race-new',from:{name:'Race',address:'race@example.com'},subject:'Race',
        date:1_800_000_000_000,text:'race body',unread:true,attachments:[]});
      const original=real.list.bind(real);
      let blocked=false,release=()=>{},enteredResolve=()=>{};
      const gate=new Promise<void>(resolve=>{release=resolve});
      const entered=new Promise<void>(resolve=>{enteredResolve=resolve});
      // 阻塞网络返回阶段而不是落库阶段：此时写锁尚未获取，前台已读操作可以立即完成。
      vi.spyOn(real,'list').mockImplementation(async(acc,q,signal)=>{
        const page=await original(acc,q,signal);
        if(!blocked&&!q.cursor){blocked=true;enteredResolve();await gate;}
        return page;
      });
      const poll=h.runAction('mail.poll');
      await entered;
      await unwrap(h,'mail.mark-read',{accountId:account.id,messageId:'race-new',read:true});
      release();
      await poll;
      expect(h.events.filter(event=>event.type==='mail.arrived')).toHaveLength(0);
    }finally{await h.close();vi.restoreAllMocks();}
  });

  it.each([false,true])('后台同步不会用旧服务器状态覆盖已读（回写已完成：%s）',async(writeFinished)=>{
    const real=new GrowingConnector(),h=await harness({real});
    let releaseList=()=>{},releaseMark=()=>{};
    try{
      const accounts=await addFixtures(h),account=accounts.find((item:any)=>item.provider==='gmail');
      for(const other of accounts.filter((item:any)=>item.id!==account.id))
        await unwrap(h,'mail.account.remove',{accountId:other.id});
      await unwrap(h,'settings.save',{syncReadReceipts:true});
      await unwrap(h,'mail.list',{limit:20});
      await unwrap(h,'mail.mark-all-read',{accountIds:[account.id]});
      real.add(account.id,{messageId:'race-writeback',from:{name:'Writeback',address:'writeback@example.com'},
        subject:'Writeback',date:1_800_000_000_000,text:'writeback body',unread:true,attachments:[]});
      const originalList=real.list.bind(real),originalMark=real.markRead.bind(real);
      let listBlocked=false,listEnteredResolve=()=>{},markEnteredResolve=()=>{};
      const listGate=new Promise<void>(resolve=>{releaseList=resolve});
      const listEntered=new Promise<void>(resolve=>{listEnteredResolve=resolve});
      const markGate=new Promise<void>(resolve=>{releaseMark=resolve});
      const markEntered=new Promise<void>(resolve=>{markEnteredResolve=resolve});
      vi.spyOn(real,'list').mockImplementation(async(acc,q,signal)=>{
        const page=await originalList(acc,q,signal);
        if(!listBlocked&&!q.cursor){listBlocked=true;listEnteredResolve();await listGate;}
        return page;
      });
      vi.spyOn(real,'markRead').mockImplementation(async(acc,messageId,read,signal)=>{
        markEnteredResolve();await markGate;
        return originalMark(acc,messageId,read,signal);
      });
      const poll=h.runAction('mail.poll');
      await listEntered;
      const marking=unwrap(h,'mail.mark-read',{accountId:account.id,messageId:'race-writeback',read:true});
      await markEntered;
      if(writeFinished){
        releaseMark();
        expect(await marking).toEqual({ok:true,synced:true});
      }
      releaseList();
      await poll;
      expect(h.events.filter(event=>event.type==='mail.arrived')).toHaveLength(0);
      const db=openMailDb(h.directory);
      expect(db.prepare('SELECT read FROM read_pending WHERE account_id=? AND message_id=?')
        .get(account.id,'race-writeback')).toEqual(writeFinished?undefined:{read:1});
      db.close();
      releaseMark();
      expect(await marking).toEqual({ok:true,synced:true});
      const afterMark=openMailDb(h.directory);
      expect(afterMark.prepare('SELECT COUNT(*) n FROM read_pending').get()).toEqual({n:0});
      afterMark.close();
      const cached=await unwrap(h,'mail.list',{accountIds:[account.id]});
      expect(cached.items.find((mail:any)=>mail.messageId==='race-writeback')?.unread).toBe(false);
      expect(cached.unreadByAccount[account.id]??0).toBe(0);
    }finally{releaseList();releaseMark();await h.close();vi.restoreAllMocks();}
  });

  it('单账号筛选只裁剪列表，仍返回全部账号未读数',async()=>{
    const real=new FixtureConnector(),h=await harness({real});
    try{
      const accounts=await addFixtures(h),gmail=accounts.find((account:any)=>account.provider==='gmail');
      const all=await unwrap(h,'mail.list',{limit:100});
      const filtered=await unwrap(h,'mail.list',{accountIds:[gmail.id],limit:100});
      expect(filtered.items.every((mail:any)=>mail.accountId===gmail.id)).toBe(true);
      expect(filtered.unreadByAccount).toEqual(all.unreadByAccount);
      expect(Object.keys(filtered.unreadByAccount).length).toBeGreaterThan(1);
    }finally{await h.close();}
  });

});

describe('已读状态与本地正文',()=>{
  it('标记已读立即反映到列表、统计和详情，服务器刷新不反弹',async()=>{
    const real=new FixtureConnector(),h=await harness({real});
    try{
      const accounts=await addFixtures(h),gmail=accounts.find((account:any)=>account.provider==='gmail');
      const before=await unwrap(h,'mail.list',{limit:100}),item=before.items.find((mail:any)=>mail.messageId==='gmail-1');
      expect(item.unread).toBe(true);const unreadBefore=before.unreadByAccount[gmail.id];
      expect(await unwrap(h,'mail.mark-read',{accountId:gmail.id,messageId:'gmail-1',read:true})).toEqual({ok:true});
      let list=await unwrap(h,'mail.list',{limit:100});
      expect(list.items.find((mail:any)=>mail.messageId==='gmail-1').unread).toBe(false);
      expect(list.unreadByAccount[gmail.id]).toBe(unreadBefore-1);
      expect((await unwrap(h,'mail.get',{accountId:gmail.id,messageId:'gmail-1'})).unread).toBe(false);
      await unwrap(h,'settings.save',{syncReadReceipts:true});
      expect(await unwrap(h,'mail.mark-read',{accountId:gmail.id,messageId:'gmail-1',read:true})).toEqual({ok:true,synced:true});
      list=await unwrap(h,'mail.list',{limit:100,refresh:true});
      expect(list.items.find((mail:any)=>mail.messageId==='gmail-1').unread).toBe(false);
      real.setSeen({account:gmail,secret:''},'gmail-1',false);
      list=await unwrap(h,'mail.list',{limit:100,refresh:true});
      expect(list.items.find((mail:any)=>mail.messageId==='gmail-1').unread).toBe(true);
      expect((await unwrap(h,'mail.get',{accountId:gmail.id,messageId:'gmail-1'})).unread).toBe(true);
    }finally{await h.close();}
  });

  it('打开过的正文写入本地，重启后不重复请求 IMAP',async()=>{
    const storage=memoryStorage(),first=new FixtureConnector(),h1=await harness({storage,real:first});
    const accounts=await addFixtures(h1),gmail=accounts.find((account:any)=>account.provider==='gmail');
    const fetch=vi.spyOn(first,'fetch');
    await unwrap(h1,'mail.get',{accountId:gmail.id,messageId:'gmail-1'});
    expect(fetch).toHaveBeenCalledTimes(1);
    await h1.close(false);
    const second=new FixtureConnector(),fetchAgain=vi.spyOn(second,'fetch'),h2=await harness({storage,directory:h1.directory,real:second});
    try{
      const mail=await unwrap(h2,'mail.get',{accountId:gmail.id,messageId:'gmail-1'});
      expect(mail.subject).toBe('Quarterly launch checklist');
      expect(fetchAgain).not.toHaveBeenCalled();
    }finally{await h2.close();}
  });
  it('超大正文与附件改存文件，不占用 2MB 单键存储',async()=>{
    const real=new FixtureConnector(),original=real.fetch.bind(real);
    vi.spyOn(real,'fetch').mockImplementation(async(acc,messageId,signal)=>{
      const raw=await original(acc,messageId,signal);
      raw.text='正文'.repeat(120_000);
      raw.html='<p>'+'内容'.repeat(80_000)+'</p>';
      raw.attachments=[{id:'0',filename:'big.bin',mime:'application/octet-stream',
        size:6*1024*1024,inline:false,dataBase64:'A'.repeat(8*1024*1024)}];
      return raw;
    });
    const h=await harness({real});
    try{
      const accounts=await addFixtures(h),gmail=accounts.find((account:any)=>account.provider==='gmail');
      const mail=await unwrap(h,'mail.get',{accountId:gmail.id,messageId:'gmail-1'});
      expect(mail.text.length).toBeGreaterThan(0);
      const db=openMailDb(h.directory);
      expect(db.prepare('SELECT key FROM body_index WHERE account_id=? AND message_id=?').get(gmail.id,'gmail-1')).toBeTruthy();
      db.close();
      expect(readdirSync(mailBodiesDir(h.directory)).length).toBe(1);
    }finally{await h.close();}
  });

  it('旧键值库的账号、邮件与已读状态迁移到 SQLite 并清空旧键',async()=>{
    const map=new Map<string,any>();
    const legacyKey=(name:string)=>JSON.stringify(['users','1','profiles','test',name]);
    const account={id:'legacy-1',provider:'custom',address:'legacy@example.com',alias:'旧账号',colorToken:'a4',
      imap:{host:'imap.example.com',port:993,secure:true},smtp:{host:'smtp.example.com',port:465,secure:true},
      state:{status:'connected',checkedAt:1},createdAt:1};
    const message={accountId:'legacy-1',messageId:'m1',from:{name:'Old',address:'old@example.com'},
      subject:'Legacy',snippet:'old mail',date:1000,unread:true,hasAttachments:false};
    map.set(legacyKey('accounts'),[account]);
    map.set(legacyKey('mail-cache'),[message]);
    map.set(legacyKey('mail-sync'),{'legacy-1':{initialized:true,lastSyncAt:1}});
    map.set(legacyKey('read'),{'legacy-1:m1':true});
    map.set(legacyKey('mail-body-index'),{'legacy-1:m1':{at:1,bytes:10}});
    const storage=memoryStorage(map),h=await harness({storage,real:new FixtureConnector()});
    try{
      const list=await unwrap(h,'mail.list',{limit:10});
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({messageId:'m1',subject:'Legacy',unread:false});
      expect(map.get(legacyKey('accounts'))).toEqual([]);
      expect(map.has(legacyKey('mail-cache'))).toBe(false);
      expect(map.has(legacyKey('read'))).toBe(false);
      const db=openMailDb(h.directory);
      expect(db.prepare('SELECT subject FROM messages WHERE message_id=?').get('m1')).toMatchObject({subject:'Legacy'});
      db.close();
    }finally{await h.close();}
  });
});

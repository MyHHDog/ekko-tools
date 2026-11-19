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
      expect(arrived).toHaveLength(1);expect(arrived[0].data).toMatchObject({accountId:gmail.id,count:1});
      await unwrap(h,'mail.list',{limit:20,refresh:true});
      expect(h.events.filter(event=>event.type==='mail.arrived')).toHaveLength(1);
    }finally{await h.close();}
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

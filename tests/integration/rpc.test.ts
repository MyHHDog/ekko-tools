import {describe,it,expect,afterEach,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {addFixtures,harness,unwrap,lifecycle} from '../helpers';
import {ImapConnector} from '../../src/server/mail/imap';
import {FixtureConnector} from '../fixtures/connector';
import {openMailDb} from '../mail-db';
import {rpcNames} from '../../src/shared/rpc-contract';
import {partition} from '../../src/server/adapter/host';
import {Vault} from '../../src/server/vault/store';
import {AppError} from '../../src/shared/error-codes';
import {join} from 'node:path';

const open:Awaited<ReturnType<typeof harness>>[]=[];
afterEach(async()=>{for(const h of open.splice(0))await h.close();vi.restoreAllMocks();vi.useRealTimers();});
async function start(options:Parameters<typeof harness>[0]={}){const h=await harness(options);open.push(h);return h;}

describe('真实 RPC 集成',()=>{
  it('逐次 RPC 使用各自调用的存储作用域',async()=>{
    const h=await start();
    expect((await unwrap(h,'app.bootstrap')).accounts).toHaveLength(0);
    expect((await unwrap(h,'settings.get')).glossary).toEqual([]);
    expect((await unwrap(h,'translate.cache-stats')).entries).toBe(0);
  });

  it('添加三个邮箱后跑通收件箱→筛选→详情→双语→附件→删除',async()=>{
    const h=await start(),accounts=await addFixtures(h);
    const list=await unwrap(h,'mail.list',{limit:100});
    expect(list.items).toHaveLength(16);
    expect(list.items[0].date).toBeGreaterThanOrEqual(list.items[1].date);
    const qq=accounts.find((a:any)=>a.provider==='qq'),gmail=accounts.find((a:any)=>a.provider==='gmail'),netease=accounts.find((a:any)=>a.provider==='163');
    expect((await unwrap(h,'mail.list',{accountIds:[qq.id],limit:100})).items).toHaveLength(5);
    const mail=await unwrap(h,'mail.get',{accountId:gmail.id,messageId:'gmail-1'});
    expect(mail.text.split('\n\n')).toHaveLength(6);
    const bilingual=await unwrap(h,'mail.bilingual',{accountId:gmail.id,messageId:'gmail-1',target:'zh'});
    expect(bilingual.complete).toBe(true);expect(bilingual.segments).toHaveLength(1);expect(bilingual.segments[0].source).toBe(mail.text);
    const historyBefore=(await unwrap(h,'translate.history',{limit:50})).length;
    expect(await unwrap(h,'mail.bilingual',{accountId:gmail.id,messageId:'gmail-1',target:'zh'})).toEqual(bilingual);
    expect((await unwrap(h,'translate.history',{limit:50})).length).toBe(historyBefore);
    const file=await unwrap(h,'mail.attachment',{accountId:netease.id,messageId:'163-3',attachmentId:'0'});
    expect(file.size).toBe(12288);
    expect(createHash('sha256').update(Buffer.from(file.dataBase64,'base64')).digest('hex'))
      .toBe(createHash('sha256').update(Buffer.alloc(12288,65)).digest('hex'));
    await unwrap(h,'mail.mark-read',{accountId:gmail.id,messageId:'gmail-1',read:true});
    expect((await unwrap(h,'mail.get',{accountId:gmail.id,messageId:'gmail-1'})).unread).toBe(false);
    await unwrap(h,'mail.account.remove',{accountId:qq.id});
    expect((await unwrap(h,'mail.list',{limit:100})).items).toHaveLength(11);
    expect(JSON.stringify(h.logs)).not.toContain(mail.text);
    expect(h.events.some(e=>e.type==='translate.progress')).toBe(true);
  });

  it('自建邮箱保存 IMAP/SMTP 配置，并可通过当前账号回复',async()=>{
    const real=new FixtureConnector(),h=await start({real}),accounts=await addFixtures(h);
    const custom=await unwrap(h,'mail.account.add',{
      provider:'custom',address:'me@self.example',secret:'mail-password',alias:'自建',
      username:'me@self.example',imap:{host:'mail.self.example',port:993,secure:true},smtp:{host:'mail.self.example',port:465,secure:true},
    });
    expect(custom).toMatchObject({provider:'custom',username:'me@self.example',imap:{host:'mail.self.example'},smtp:{port:465}});
    vi.spyOn(real,'fetch').mockResolvedValueOnce({messageId:'custom-1',from:{address:'friend@example.com'},subject:'Hello',date:Date.now(),text:'Hi',unread:true,attachments:[]});
    expect(await unwrap(h,'mail.reply',{accountId:custom.id,messageId:'custom-1',body:'你好'})).toMatchObject({sent:true});
    expect(real.sent.at(-1)).toMatchObject({to:'friend@example.com',subject:'Re: Hello'});
    for(const [provider,messageId] of [['gmail','gmail-1'],['163','163-1'],['qq','qq-1']] as const){
      const account=accounts.find((item:any)=>item.provider===provider);
      expect(await unwrap(h,'mail.reply',{accountId:account.id,messageId,body:'收到，谢谢'})).toMatchObject({sent:true});
    }
    expect(real.sent.slice(-3).map(item=>item.to)).toEqual(['sender0@example.com','sender0@example.com','sender0@example.com']);
    expect(real.sent.slice(-3).map(item=>item.subject)).toEqual(['Re: Quarterly launch checklist','Re: 系统通知：欢迎使用','Re: 本月账单']);
    expect(real.sent.at(-1)?.text).toContain('收到，谢谢');
  });
  it('旧自建账号的 SMTP 587 + TLS 会在读取时自动修正',async()=>{
    const h=await start(),storage=h.storage.namespace('users','1','profiles','test');
    await storage.set('accounts',[{
      id:'legacy-custom',provider:'custom',address:'me@self.example',alias:'自建',colorToken:'a4',
      username:'me@self.example',state:{status:'offline',error:{code:'NETWORK_UNREACHABLE',message:'暂时连不上服务，请稍后重试',retryable:true}},createdAt:Date.now(),
      imap:{host:'mail.self.example',port:993,secure:true},
      smtp:{host:'mail.self.example',port:587,secure:true},
    }]);
    const boot=await unwrap(h,'app.bootstrap');
    expect(boot.accounts[0].smtp).toMatchObject({port:587,secure:false});
    expect(boot.accounts[0].state.status).toBe('connecting');
    const db=openMailDb(h.directory);
    expect(JSON.parse((db.prepare('SELECT smtp_json FROM accounts WHERE id=?').get('legacy-custom') as any).smtp_json).secure).toBe(false);
    db.close();
  });
  it('添加账号的首次连接校验不进入长重试',async()=>{
    const real=new FixtureConnector(),h=await start({real});
    const test=vi.spyOn(real,'test').mockRejectedValue(new AppError('TIMEOUT',true));
    const result=await h.call('mail.account.add',{provider:'163',address:'demo@126.com',secret:'code'});
    expect(result.ok).toBe(false);expect(result.error.code).toBe('TIMEOUT');
    expect(test).toHaveBeenCalledTimes(1);
  });

  it('服务端清洗、危险附件与超限错误',async()=>{
    const h=await start(),accounts=await addFixtures(h);
    const qq=accounts.find((a:any)=>a.provider==='qq'),gmail=accounts.find((a:any)=>a.provider==='gmail');
    for(const [id,messageId] of [[qq.id,'qq-3'],[gmail.id,'gmail-4']]){
      const mail=await unwrap(h,'mail.get',{accountId:id,messageId});
      expect(mail.html).not.toMatch(/<(script|form|style|base|meta|svg|iframe)\b|onerror|javascript:/i);
      expect(mail.remoteContentBlocked).toBe(true);
    }
    expect((await h.call('mail.attachment',{accountId:qq.id,messageId:'qq-5',attachmentId:'0'})).error.code).toBe('ATTACHMENT_TOO_LARGE');
    const blocked=await h.call('mail.attachment',{accountId:gmail.id,messageId:'gmail-5',attachmentId:'1'});
    expect(blocked.ok).toBe(false);
  });

  it('翻译重译 nonce、历史、设置与错误 Result',async()=>{
    const h=await start();
    const job=await unwrap(h,'translate.run',{text:'Hello world',from:'auto',to:'zh'});
    const next=await unwrap(h,'translate.retry',{jobId:job.id});
    expect(job.result.provider).toBe('hostModel');
    expect(next.id).not.toBe(job.id);expect(next.request.retryNonce).toBeTruthy();
    expect((await unwrap(h,'translate.history',{limit:2}))[1].id).toBe(job.id);
    expect((await h.call('translate.run',{text:'a'.repeat(5001),from:'en',to:'zh'})).error.code).toBe('INPUT_TOO_LONG');
    await unwrap(h,'settings.save',{provider:'baidu',appid:'fixture_app',secret:'fixture_key',selection:false});
    const settings=await unwrap(h,'settings.get');
    expect(settings.configured).toBe(true);expect(settings).not.toHaveProperty('secret');
    const notifications={enabled:false,dndEnabled:true,dndStart:'21:30',dndEnd:'07:15',mutedAccountIds:[]};
    await unwrap(h,'settings.save',{notifications});
    expect((await unwrap(h,'settings.get')).notifications).toEqual(notifications);
    expect(await unwrap(h,'app.diagnostics')).toHaveProperty('entries');
  });

  it('双语结果和已译标记写入身份分区，日志级别可降噪',async()=>{
    const h=await start(),accounts=await addFixtures(h),gmail=accounts.find((a:any)=>a.provider==='gmail');
    await unwrap(h,'mail.bilingual',{accountId:gmail.id,messageId:'gmail-1',target:'zh'});
    const db=openMailDb(h.directory);
    expect(db.prepare('SELECT COUNT(*) n FROM bilingual').get()).toEqual({n:1});
    expect(db.prepare('SELECT translated FROM translated_state WHERE account_id=? AND message_id=?').get(gmail.id,'gmail-1')).toEqual({translated:1});
    db.close();
    await unwrap(h,'settings.save',{logLevel:'off'});
    const before=(await unwrap(h,'app.diagnostics')).entries.length;
    await unwrap(h,'mail.list',{limit:10});
    expect((await unwrap(h,'app.diagnostics')).entries.length).toBe(before);
  });

  it('全部标为已读更新完整未读统计与逐封状态',async()=>{
    const h=await start();await addFixtures(h);
    const before=await unwrap(h,'mail.list',{limit:100});
    const unread=before.items.filter((item:any)=>item.unread).length;
    expect(unread).toBeGreaterThan(0);
    expect(Object.values(before.unreadByAccount||{}).reduce((sum:number,value:any)=>sum+value,0)).toBe(unread);
    expect((await unwrap(h,'mail.mark-all-read')).updated).toBe(unread);
    const after=await unwrap(h,'mail.list',{limit:100});
    expect(after.items.every((item:any)=>!item.unread)).toBe(true);
    expect(Object.values(after.unreadByAccount||{}).reduce((sum:number,value:any)=>sum+value,0)).toBe(0);
    const first=after.items[0];
    await unwrap(h,'mail.mark-read',{accountId:first.accountId,messageId:first.messageId,read:false});
    expect((await unwrap(h,'mail.mark-all-read',{accountIds:[first.accountId]})).updated).toBe(1);
  });

  it('单账号鉴权失败仅影响该账号，错误与日志不含正文凭据',async()=>{
    const base=new FixtureConnector();
    const failing:any={
      test:(acc:any,signal:AbortSignal)=>base.test(acc,signal),
      list:(acc:any,q:any,signal:AbortSignal)=>acc.account.provider==='qq'?Promise.reject(new AppError('AUTH_FAILED')):base.list(acc,q,signal),
      fetch:(acc:any,id:string,signal:AbortSignal)=>base.fetch(acc,id,signal),
      close(){},
    };
    const h=await start({real:failing}),accounts=await addFixtures(h),qq=accounts.find((a:any)=>a.provider==='qq');
    const page=await unwrap(h,'mail.list',{limit:100});
    expect(page.updated).toBe(2);expect(page.total).toBe(3);expect(page.items).toHaveLength(11);
    expect((await unwrap(h,'app.bootstrap')).accounts.find((a:any)=>a.id===qq.id).state.status).toBe('auth_failed');
    expect(h.events.filter(e=>e.type==='account.state'&&e.data.accountId===qq.id&&e.data.state.status==='connecting')).toHaveLength(2);
    expect(JSON.stringify(h.logs)).not.toContain('fixture-auth-code');
  });

  it('所有 RPC 非法输入返回 VALIDATION Result',async()=>{
    const h=await start();
    for(const name of rpcNames){
      const result=await h.call(name,42);
      expect(result.ok).toBe(false);expect(result.error.code).toBe('VALIDATION');
    }
  });

  it('用户/Profile 隔离及清理句柄归零',async()=>{
    const h=await start(),[account]=await addFixtures(h);
    const other=await h.call('app.bootstrap',undefined,{userId:2,profile:'other'});
    expect(other.data.accounts).toHaveLength(0);
    const denied=await h.call('mail.get',{accountId:account.id,messageId:'163-1'},{userId:2,profile:'other'});
    expect(denied.error.code).toBe('NOT_FOUND');
    await h.close();expect(h.life.handles.size).toBe(0);open.splice(open.indexOf(h),1);
  });

  it('IMAP 登录失败仍先保存账号与授权码，供重新授权/重连',async()=>{
    const failing:any={
      test:async()=>{throw Object.assign(new Error('login failed'),{authenticationFailed:true});},
      list:async()=>({items:[]}),fetch:async()=>{throw Error('unused');},close(){},
    };
    const h=await start({real:failing});
    const result=await h.call('mail.account.add',{provider:'163',address:'fixture@163.com',secret:'fixture-auth-code'});
    expect(result.ok).toBe(false);expect(result.error.code).toBe('AUTH_FAILED');expect(result.error.accountId).toBeTruthy();
    const boot=await unwrap(h,'app.bootstrap');
    expect(boot.accounts).toHaveLength(1);expect(boot.accounts[0].state.status).toBe('auth_failed');
    const vault=new Vault(join(h.directory,partition({identity:h.host.identity} as any)));
    expect(await vault.get(boot.accounts[0].id)).toBe('fixture-auth-code');
    await h.call('mail.account.add',{provider:'163',address:'fixture@163.com',alias:'新别名',secret:'  second-code  '});
    const again=await unwrap(h,'app.bootstrap');
    expect(again.accounts).toHaveLength(1);expect(again.accounts[0].alias).toBe('新别名');
    expect(await vault.get(again.accounts[0].id)).toBe('second-code');
  });

  it('提交授权码直接添加真实账号，不产生演示账号',async()=>{
    const h=await start();
    const account=await unwrap(h,'mail.account.add',{provider:'163',address:'fixture@163.com',secret:'fixture-auth-code'});
    const boot=await unwrap(h,'app.bootstrap');
    expect(boot.accounts).toHaveLength(1);expect(boot.accounts[0].id).toBe(account.id);
    expect(JSON.stringify(boot)).not.toContain('mock');
  });
});

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
  it('草稿可跨运行时重开，且按用户和 Profile 隔离',async()=>{
    const h=await start(),draft=await unwrap(h,'mail.draft.save',{accountId:'',to:'未完成',subject:'草稿',body:'尚未发送'});
    const {body,...summary}=draft;
    expect(await unwrap(h,'mail.draft.list')).toEqual([summary]);
    for(const other of [{userId:1,profile:'other'},{userId:2,profile:'test'}]){
      expect(await h.call('mail.draft.list',{},other)).toEqual({ok:true,data:[]});
      expect(await h.call('mail.draft.get',{id:draft.id},other)).toMatchObject({ok:false,error:{code:'NOT_FOUND'}});
      expect(await h.call('mail.send',{id:draft.id},other)).toMatchObject({ok:false,error:{code:'NOT_FOUND'}});
    }
    await h.close(false);
    const restarted=await harness({directory:h.directory,storage:h.storage});
    try{
      expect(await unwrap(restarted,'mail.draft.get',{id:draft.id})).toEqual({...summary,body});
      expect(await unwrap(restarted,'mail.draft.delete',{id:draft.id})).toEqual({deleted:true});
      expect(await unwrap(restarted,'mail.draft.list')).toEqual([]);
    }finally{await restarted.close(false);}
  });

  it('SMTP 校验失败或拒绝保留草稿，接受后删除且同一草稿不会重复发信',async()=>{
    const real=new FixtureConnector(),h=await start({real}),[,sender]=await addFixtures(h);
    const fields={accountId:sender.id,to:'recipient@example.invalid',subject:'新邮件',body:'正文\n第二行'},reply=vi.spyOn(real,'reply');
    const draft=await unwrap(h,'mail.draft.save',{...fields,to:'first@example.invalid,second@example.invalid'}),{id}=draft;
    expect(await h.call('mail.send',{id})).toMatchObject({ok:false,error:{code:'VALIDATION'}});
    expect(reply).not.toHaveBeenCalled();
    expect(await unwrap(h,'mail.draft.save',{id,...fields})).toMatchObject({id,...fields});
    reply.mockRejectedValueOnce(new AppError('SEND_FAILED'));
    expect(await h.call('mail.send',{id})).toMatchObject({ok:false,error:{code:'SEND_FAILED'}});
    expect(reply).toHaveBeenCalledTimes(1);
    expect(await unwrap(h,'mail.draft.get',{id})).toMatchObject(fields);
    const results=await Promise.all([h.call('mail.send',{id}),h.call('mail.send',{id})]);
    expect(results).toMatchObject([{ok:true,data:{sent:true}},{ok:false,error:{code:'NOT_FOUND'}}]);
    expect(reply).toHaveBeenCalledTimes(2);
    expect(reply.mock.calls[1][0].account.id).toBe(sender.id);
    expect(real.sent).toEqual([{to:fields.to,subject:fields.subject,text:fields.body}]);
    expect(await unwrap(h,'mail.draft.list')).toEqual([]);
  });

  it('逐次 RPC 使用各自调用的存储作用域',async()=>{
    const h=await start();
    expect((await unwrap(h,'app.bootstrap')).accounts).toHaveLength(0);
    expect((await unwrap(h,'settings.get')).glossary).toEqual([]);
    expect((await unwrap(h,'translate.cache-stats')).entries).toBe(0);
  });

  it('分片隔离、完整校验后保存 Markdown 和附件，重启后可同时发送两种 MIME 正文与原文件',async()=>{
    const real=new FixtureConnector(),h=await start({real}),[sender]=await addFixtures(h),replies=vi.spyOn(real,'reply');
    const content=Buffer.from('测试附件'),name='会议记录.txt';
    const {uploadId}=await unwrap(h,'mail.draft.upload-start',{bytes:content.length,kind:'attachment'});
    const part=(id:string,offset:number,bytes:Buffer)=>({wire:`${id}!${offset.toString(36)}!${bytes.toString('base64url')}`});
    const chunk=part(uploadId,0,content.subarray(0,4));
    expect(await h.call('mail.draft.upload-chunk',chunk,{userId:2,profile:'test'})).toMatchObject({ok:false,error:{code:'NOT_FOUND'}});
    expect(await h.call('mail.draft.upload-chunk',part(uploadId,1,content.subarray(0,4)))).toMatchObject({ok:false,error:{code:'VALIDATION'}});
    expect(await unwrap(h,'mail.draft.upload-chunk',chunk)).toEqual({received:4});
    const body='## 日程\n**周一**开会\n<img src=x>\n[危险链接](javascript:example)';
    const draft={accountId:sender.id,to:'recipient@example.invalid',subject:'会议',body,format:'markdown',attachments:[{id:uploadId,name}]};
    expect(await h.call('mail.draft.save',draft)).toMatchObject({ok:false,error:{code:'VALIDATION'}});
    await unwrap(h,'mail.draft.upload-chunk',part(uploadId,4,content.subarray(4)));
    const snapshot=Buffer.from(JSON.stringify(draft));
    const staged=await unwrap(h,'mail.draft.upload-start',{bytes:snapshot.length,kind:'snapshot'});
    await unwrap(h,'mail.draft.upload-chunk',part(staged.uploadId,0,snapshot));
    const saved=await unwrap(h,'mail.draft.commit',staged);
    expect(saved.attachments).toEqual([{id:uploadId,name,bytes:content.length}]);
    await h.close(false);
    const restarted=await harness({directory:h.directory,storage:h.storage,real});
    try{
      expect(await unwrap(restarted,'mail.draft.get',{id:saved.id})).toEqual(saved);
      replies.mockRejectedValueOnce(new AppError('SEND_FAILED'));
      expect(await restarted.call('mail.send',{id:saved.id})).toMatchObject({ok:false,error:{code:'SEND_FAILED'}});
      expect(await unwrap(restarted,'mail.draft.get',{id:saved.id})).toEqual(saved);
      expect(await unwrap(restarted,'mail.send',{id:saved.id})).toMatchObject({sent:true});
      expect(replies.mock.calls[1][1]).toMatchObject({text:body,html:expect.stringContaining('<strong>周一</strong>'),attachments:[{filename:name,content}]});
      expect(replies.mock.calls[1][1].html).toContain('&lt;img src=x&gt;');
      expect(replies.mock.calls[1][1].html).not.toContain('<a ');
      expect(await restarted.call('mail.draft.get',{id:saved.id})).toMatchObject({ok:false,error:{code:'NOT_FOUND'}});
    }finally{await restarted.close(false);}
  });

  it('远程图标代理拒绝非公网协议并返回空数据',async()=>{
    const h=await start();
    expect(await unwrap(h,'media.image',{url:'file:///etc/passwd'})).toEqual({data:''});
    expect(await unwrap(h,'media.image',{url:'http://127.0.0.1/a.png'})).toEqual({data:''});
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
    await unwrap(h,'settings.save',{mailBodyZoom:130});
    expect((await unwrap(h,'settings.get')).mailBodyZoom).toBe(130);
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
    expect(h.events.filter(e=>e.type==='account.state'&&e.data.accountId===qq.id&&e.data.state.status==='connecting')).toHaveLength(1);
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

  it('账号别名可单独修改，不改变连接状态与凭据',async()=>{
    const h=await start(),[account]=await addFixtures(h);
    const before=await unwrap(h,'app.bootstrap');
    const renamed=await unwrap(h,'mail.account.rename',{accountId:account.id,alias:'工作日'});
    expect(renamed.alias).toBe('工作日');
    const after=await unwrap(h,'app.bootstrap');
    const target=after.accounts.find((item:any)=>item.id===account.id);
    expect(target).toMatchObject({alias:'工作日',state:before.accounts.find((item:any)=>item.id===account.id).state});
    const vault=new Vault(join(h.directory,partition({identity:h.host.identity} as any)));
    expect(await vault.get(account.id)).toBe('fixture-auth-code');
    const empty=await h.call('mail.account.rename',{accountId:account.id,alias:'   '});
    expect(empty.ok).toBe(false);expect(empty.error.code).toBe('VALIDATION');
    const long=await h.call('mail.account.rename',{accountId:account.id,alias:'一二三四五六七'});
    expect(long.ok).toBe(false);expect(long.error.code).toBe('VALIDATION');
    await h.close();open.splice(open.indexOf(h),1);
  });
});

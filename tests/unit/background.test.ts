import {describe,it,expect,afterEach,vi} from 'vitest';
import {addFixtures,harness,unwrap} from '../helpers';
import {FixtureConnector} from '../fixtures/connector';
import {openMailDb} from '../mail-db';
import {AppError} from '../../src/shared/error-codes';
const open:Awaited<ReturnType<typeof harness>>[]=[];
afterEach(async()=>{for(const h of open.splice(0))await h.close();vi.restoreAllMocks();});
describe('后台同步与服务器已读回写',()=>{
  it('注册 30 秒后台任务并可刷新缓存',async()=>{
    const h=await harness();open.push(h);await addFixtures(h);
    expect(h.actions.has('mail.poll')).toBe(true);
    expect(h.schedules).toContainEqual(expect.objectContaining({id:'mail-poll',intervalMs:30000,action:'mail.poll'}));
    expect(await h.runAction('mail.poll')).toMatchObject({checked:3,updated:3});
  });
  it('后台轮询已连接账号不再反复广播连接状态',async()=>{
    const h=await harness();open.push(h);await addFixtures(h);
    h.events.length=0;
    expect(await h.runAction('mail.poll')).toMatchObject({checked:3,updated:3});
    expect(h.events.filter(event=>event.type==='account.state')).toHaveLength(0);
  });
  it('后台轮询连续失败后才标记离线，偶发失败不闪烁',async()=>{
    const real=new FixtureConnector();
    vi.spyOn(real,'list').mockRejectedValue(new AppError('PROVIDER_BAD_RESPONSE',false,'provider'));
    const h=await harness({real});open.push(h);const accounts=await addFixtures(h);
    h.events.length=0;
    await h.runAction('mail.poll');
    await h.runAction('mail.poll');
    expect((await unwrap(h,'app.bootstrap')).accounts.map((account:any)=>account.state.status)).toEqual(['connected','connected','connected']);
    expect(h.events.filter(event=>event.type==='account.state')).toHaveLength(0);
    await h.runAction('mail.poll');
    const offline=(await unwrap(h,'app.bootstrap')).accounts.filter((account:any)=>account.state.status==='offline');
    expect(offline.map((account:any)=>account.id).sort()).toEqual(accounts.map((account:any)=>account.id).sort());
    expect(h.events.filter(event=>event.type==='account.state'&&event.data.state.status==='offline')).toHaveLength(3);
  });
  it('后台同步阻塞时不占用启动与翻译队列',async()=>{
    const real=new FixtureConnector(),original=real.list.bind(real);
    let release=()=>{};
    const gate=new Promise<void>(resolve=>{release=resolve;});
    vi.spyOn(real,'list').mockImplementation(async(...args)=>{await gate;return original(...args as Parameters<typeof real.list>);});
    const h=await harness({real});open.push(h);await addFixtures(h);
    const poll=h.runAction('mail.poll');
    await new Promise(resolve=>setTimeout(resolve,0));
    const timed=<T>(promise:Promise<T>)=>new Promise<T>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('operation blocked by mail poll')),500);
      promise.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
    });
    try{
      expect(await timed(unwrap(h,'app.bootstrap'))).toMatchObject({accounts:expect.any(Array)});
      expect((await timed(unwrap(h,'translate.run',{text:'Hello world',from:'auto',to:'zh'}))).result.translated).toBe('你好，世界');
    } finally {
      release();await poll;
    }
  });
  it('上一轮同步未结束时跳过本轮，避免轮询堆积',async()=>{
    const real=new FixtureConnector(),original=real.list.bind(real);
    let release=()=>{};
    const gate=new Promise<void>(resolve=>{release=resolve;});
    vi.spyOn(real,'list').mockImplementation(async(...args)=>{await gate;return original(...args as Parameters<typeof real.list>);});
    const h=await harness({real});open.push(h);await addFixtures(h);
    const first=h.runAction('mail.poll');
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(await h.runAction('mail.poll')).toMatchObject({checked:0,updated:0,skipped:true});
    release();
    expect(await first).toMatchObject({checked:3,updated:3});
  });
  it('开启后写服务器，关闭后只写本机',async()=>{
    const real=new FixtureConnector(),h=await harness({real});open.push(h);const accounts=await addFixtures(h);
    const gmail=accounts.find((account:any)=>account.provider==='gmail');
    expect(await unwrap(h,'mail.mark-read',{accountId:gmail.id,messageId:'gmail-1',read:true})).toEqual({ok:true});
    await unwrap(h,'settings.save',{syncReadReceipts:true});
    expect(await unwrap(h,'mail.mark-read',{accountId:gmail.id,messageId:'gmail-1',read:true})).toEqual({ok:true,synced:true});
    let list=await unwrap(h,'mail.list',{accountIds:[gmail.id],limit:100});
    expect(list.items.find((item:any)=>item.messageId==='gmail-1').unread).toBe(false);
    real.setSeen({account:gmail,secret:''},'gmail-1',false);
    list=await unwrap(h,'mail.list',{accountIds:[gmail.id],limit:100,refresh:true});
    expect(list.items.find((item:any)=>item.messageId==='gmail-1').unread).toBe(true);
    const all=await unwrap(h,'mail.mark-all-read',{accountIds:[gmail.id]});
    expect(all.synced).toBe(true);expect(all.updated).toBeGreaterThan(0);
    await unwrap(h,'settings.save',{syncReadReceipts:false});
    expect(await unwrap(h,'mail.mark-read',{accountId:gmail.id,messageId:'gmail-1',read:true})).toEqual({ok:true});
  });
  it('服务器写入失败时保留本机标记并返回 synced=false',async()=>{
    const real=new FixtureConnector();vi.spyOn(real,'markRead').mockRejectedValue(new Error('offline'));
    const h=await harness({real});open.push(h);const accounts=await addFixtures(h),gmail=accounts.find((account:any)=>account.provider==='gmail');
    await unwrap(h,'settings.save',{syncReadReceipts:true});
    expect(await unwrap(h,'mail.mark-read',{accountId:gmail.id,messageId:'gmail-1',read:true})).toEqual({ok:true,synced:false});
    expect((await unwrap(h,'mail.get',{accountId:gmail.id,messageId:'gmail-1'})).unread).toBe(false);
    expect((await unwrap(h,'mail.list',{accountIds:[gmail.id],limit:100})).items.find((item:any)=>item.messageId==='gmail-1').unread).toBe(false);
  });
  it('服务器确认后清除待同步覆盖',async()=>{
    const real=new FixtureConnector(),spy=vi.spyOn(real,'markRead').mockRejectedValue(new Error('offline'));
    const h=await harness({real});open.push(h);const accounts=await addFixtures(h),gmail=accounts.find((account:any)=>account.provider==='gmail');
    await unwrap(h,'settings.save',{syncReadReceipts:true});
    expect(await unwrap(h,'mail.mark-read',{accountId:gmail.id,messageId:'gmail-1',read:true})).toEqual({ok:true,synced:false});
    const db=openMailDb(h.directory);
    expect(db.prepare('SELECT account_id,message_id,read FROM read_pending').all())
      .toEqual([{account_id:gmail.id,message_id:'gmail-1',read:1}]);
    spy.mockRestore();real.setSeen({account:gmail,secret:''},'gmail-1',true);
    await unwrap(h,'mail.list',{accountIds:[gmail.id],limit:100});
    expect(db.prepare('SELECT COUNT(*) n FROM read_pending').get()).toEqual({n:0});
    db.close();
  });
});

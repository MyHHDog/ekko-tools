import {it,expect} from 'vitest';
import {addFixtures,harness,unwrap} from '../helpers';
import {validateModel} from '../../sdk/harness/contracts.mjs';
import {contract} from '../../src/server/index';
import {memoryStorage} from '../harness-host';
import {scope} from '../../src/server/adapter/host';
import {openMailDb} from '../mail-db';

it('存储写入统一丢弃 undefined，满足宿主纯 JSON 约束',async()=>{
  let saved:any;
  const base:any={namespace:()=>base,get:async()=>undefined,set:async(_key:string,value:any)=>{saved=value;},delete:async()=>{},keys:async()=>[]};
  const store=scope({identity:{userId:1,profile:'p'},state:{plugin:base}} as any);
  await store.set('history',[{request:{text:'hi',retryNonce:undefined},result:{provider:'hostModel',detectedFrom:undefined}}]);
  expect(saved).toEqual([{request:{text:'hi'},result:{provider:'hostModel'}}]);
});

it('G04：双语逐段推送 translate.progress，载荷符合契约事件模型',async()=>{
  const h=await harness();
  try{
    await addFixtures(h);
    const boot=await unwrap(h,'app.bootstrap');
    const gmail=boot.accounts.find((a:any)=>a.provider==='gmail');
    const page=await unwrap(h,'mail.list',{limit:100});
    const mail=page.items.find((m:any)=>m.accountId===gmail.id&&m.messageId==='gmail-1');
    const body=await unwrap(h,'mail.bilingual',{accountId:gmail.id,messageId:mail.messageId,target:'zh'});
    const events=h.events.filter(e=>e.type==='translate.progress');
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.at(-1)!.data.done).toBe(body.segments.length);
    expect(body.complete).toBe(true);
    for(const e of events){
      expect(e.data.total).toBe(body.segments.length);
      // 事件载荷本身必须通过契约模型 translateProgressEvent
      expect(()=>validateModel(contract,'translateProgressEvent',e.data)).not.toThrow();
    }
    // 每段按序完成：done 严格递增
    expect(events.map((e,i)=>e.data.done)).toEqual(events.map((_,i)=>i+1));
  }finally{await h.close();}
});

it('G03：双语结果与已译标记持久化，重启运行时后命中缓存且不再产生进度事件',async()=>{
  const storage=memoryStorage();
  const first=await harness({storage});
  await addFixtures(first);
  const boot=await unwrap(first,'app.bootstrap');
  const gmail=boot.accounts.find((a:any)=>a.provider==='gmail');
  const page=await unwrap(first,'mail.list',{limit:100});
  const mail=page.items.find((m:any)=>m.accountId===gmail.id&&m.messageId==='gmail-1');
  const body=await unwrap(first,'mail.bilingual',{accountId:gmail.id,messageId:mail.messageId,target:'zh'});
  expect(first.events.some(e=>e.type==='translate.progress')).toBe(true);
  const listed=await unwrap(first,'mail.list',{limit:100});
  expect(listed.items.find((m:any)=>m.messageId===mail.messageId).translated).toBe(true);
  await first.close(false);
  // 同一存储重新创建运行时（模拟插件重启）
  const second=await harness({storage,directory:first.directory});
  try{
    const again=await unwrap(second,'mail.bilingual',{accountId:gmail.id,messageId:mail.messageId,target:'zh'});
    expect(again).toEqual(body);
    expect(second.events.some(e=>e.type==='translate.progress')).toBe(false);
    const relisted=await unwrap(second,'mail.list',{limit:100});
    expect(relisted.items.find((m:any)=>m.messageId===mail.messageId).translated).toBe(true);
  }finally{await second.close();}
});

it('旧版逐段双语缓存会被整封翻译结构自动替换',async()=>{
  const storage=memoryStorage(),h=await harness({storage});
  try{
    await addFixtures(h);
    const boot=await unwrap(h,'app.bootstrap'),gmail=boot.accounts.find((a:any)=>a.provider==='gmail');
    const mail=await unwrap(h,'mail.get',{accountId:gmail.id,messageId:'gmail-1'}),key=gmail.id+':gmail-1:zh';
    const oldSegments=mail.text.split(/\n\s*\n/).filter(Boolean).map((source:string,index:number)=>({index,source,translated:'旧译'}));
    const db=openMailDb(h.directory);
    db.prepare('INSERT OR REPLACE INTO bilingual(key,payload,at) VALUES(?,?,?)')
      .run(key,JSON.stringify({messageId:'gmail-1',segments:oldSegments,complete:true}),Date.now());
    db.close();
    const body=await unwrap(h,'mail.bilingual',{accountId:gmail.id,messageId:'gmail-1',target:'zh'});
    expect(body.segments).toHaveLength(1);expect(body.segments[0].source).toBe(mail.text);expect(body.segments[0].translated).not.toBe('旧译');
  }finally{await h.close();}
});

it('远程图片只接受本封邮件实际存在的域名',async()=>{
  const h=await harness();
  try{
    await addFixtures(h);
    const boot=await unwrap(h,'app.bootstrap'),qq=boot.accounts.find((a:any)=>a.provider==='qq');
    const domains=await unwrap(h,'mail.image-domains',{accountId:qq.id,messageId:'qq-2'});
    expect(domains.domains).toContain('tracker.example.invalid');
    const denied=await h.call('mail.images',{accountId:qq.id,messageId:'qq-2',confirmed:true,allowedDomains:['evil.invalid']});
    expect(denied.ok).toBe(false);expect(denied.error.code).toBe('VALIDATION');
    const allowed=await unwrap(h,'mail.images',{accountId:qq.id,messageId:'qq-2',confirmed:true,allowedDomains:[]});
    expect(allowed.remoteContentBlocked).toBe(true);
  }finally{await h.close();}
});

it('首次同步不会把已有邮件当作新邮件事件，诊断按用户隔离',async()=>{
  const h=await harness();
  try{
    await addFixtures(h);
    await unwrap(h,'mail.list',{limit:100});
    expect(h.events.filter(e=>e.type==='mail.arrived')).toHaveLength(0);
    await unwrap(h,'translate.run',{text:'diagnostics isolation',from:'en',to:'zh'});
    const own=await unwrap(h,'app.diagnostics');
    expect(own.entries.length).toBeGreaterThan(0);
    const other=await h.call('app.diagnostics',undefined,{userId:2,profile:'other'});
    expect(other.ok).toBe(true);expect(other.data.entries).toHaveLength(0);
  }finally{await h.close();}
});

it('修改百度 APPID 时未重新输入密钥会被拒绝，避免旧密钥错配',async()=>{
  const h=await harness();
  try{
    await unwrap(h,'settings.save',{provider:'baidu',appid:'fixture-app-one',secret:'fixture-key-one'});
    const result=await h.call('settings.save',{provider:'baidu',appid:'fixture-app-two',secret:''});
    expect(result.ok).toBe(false);expect(result.error.code).toBe('VALIDATION');
    const unchanged=await unwrap(h,'settings.get');
    expect(unchanged.appid).toBe('fixture-app-one');
  }finally{await h.close();}
});

it('空身份启动时不注入任何账号',async()=>{
  const h=await harness({config:{}});
  try{
    const boot=await unwrap(h,'app.bootstrap');
    expect(boot.accounts).toHaveLength(0);
  }finally{await h.close();}
});

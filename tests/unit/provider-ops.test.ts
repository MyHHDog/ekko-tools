import {describe,it,expect,vi} from 'vitest';
import {harness,unwrap} from '../helpers';
import {HostModelProvider} from '../../src/server/translate/host-model';
import {memoryStorage} from '../harness-host';

describe('Provider 连接测试',()=>{
  it('启动与状态查询不请求宿主模型目录',async()=>{
    const h=await harness();
    try {
      const list=vi.spyOn(h.host.host.models!,'list');
      await unwrap(h,'app.bootstrap');
      await unwrap(h,'settings.get');
      expect(list).not.toHaveBeenCalled();
      await unwrap(h,'translate.run',{text:'Hello world',from:'auto',to:'zh'});
      expect(list).toHaveBeenCalled();
    } finally {await h.close();}
  });
  it('宿主模型未手填 ID 时使用宿主默认模型',async()=>{
    let used='';
    const provider=new HostModelProvider(async input=>{used=input.model;return {output_text:'你好'};},async()=>({data:[{id:'fixture-default',isDefault:true},{id:'fixture-other'}]}),'');
    expect(provider.isConfigured()).toBe(true);
    const result=await provider.translate({text:'Hello',from:'en',to:'zh'},new AbortController().signal);
    expect(used).toBe('fixture-default');expect(result.translated).toBe('你好');
  });
  it('连接测试使用宿主模型且不写历史',async()=>{
    const h=await harness();
    try{
      const before=await unwrap(h,'translate.history',{limit:50});
      const result=await unwrap(h,'translate.test',{provider:'hostModel'});
      expect(result).toMatchObject({provider:'hostModel',configured:true,ok:true});
      expect(result.sample).toContain('你好');
      expect(await unwrap(h,'translate.history',{limit:50})).toHaveLength(before.length);
    }finally{await h.close();}
  });
  it('未配置 Provider 返回 configured=false 与可操作错误',async()=>{
    const h=await harness();
    try{
      const result=await unwrap(h,'translate.test',{provider:'deepl'});
      expect(result.provider).toBe('deepl');expect(result.configured).toBe(false);expect(result.ok).toBe(false);
      expect(result.error.category).toBe('configuration');
    }finally{await h.close();}
  });
});

describe('运行时数据迁移',()=>{
  it('清理旧版演示账号与模式标记',async()=>{
    const storage=memoryStorage();
    await storage.namespace('users','1','profiles','test').set('accounts',[
      {id:'legacy',provider:'163',address:'demo@163.com',alias:'演示',colorToken:'a1',state:{status:'connected'},createdAt:1,mock:true},
    ]);
    await storage.namespace('users','1','profiles','test').set('mode',{mode:'mock'});
    await storage.namespace('users','1','profiles','test').set('preferences',{provider:'mock',mode:'mock',initialized:true});
    const h=await harness({storage});
    try{
      expect((await unwrap(h,'app.bootstrap')).accounts).toHaveLength(0);
      const scoped=storage.namespace('users','1','profiles','test');
      expect(await scoped.get('mode')).toBeUndefined();
      expect(await scoped.get('accounts')).toEqual([]);
      expect(await scoped.get('preferences')).toEqual({provider:'hostModel'});
      const settings=await unwrap(h,'settings.get');
      expect(settings.provider).toBe('hostModel');expect(settings).not.toHaveProperty('mode');expect(settings).not.toHaveProperty('initialized');
    }finally{await h.close();}
  });
});

describe('Provider 选择',()=>{
  it('旧版无效偏好不会作为 Provider 使用',async()=>{
    const storage=memoryStorage();
    await storage.namespace('users','1','profiles','test').set('preferences',{provider:'mock',model:'fixture-model'});
    const h=await harness({storage});
    try{
      const job=await unwrap(h,'translate.run',{text:'Hello world',from:'en',to:'zh'});
      expect(job.result.provider).toBe('hostModel');
      const settings=await unwrap(h,'settings.get');
      expect(settings.provider).toBe('hostModel');
    }finally{await h.close();}
  });
});

describe('翻译缓存管理',()=>{
  it('统计、清理与再次写入',async()=>{
    const h=await harness();
    try{
      await unwrap(h,'translate.run',{text:'cache ops',from:'en',to:'zh'});
      const stats=await unwrap(h,'translate.cache-stats');
      expect(stats.entries).toBe(1);expect(stats.bytes).toBeGreaterThan(0);
      const cleared=await unwrap(h,'translate.cache-clear');
      expect(cleared).toMatchObject({entries:0,bytes:0,cleared:1});
      expect((await unwrap(h,'translate.cache-stats')).entries).toBe(0);
      const job=await unwrap(h,'translate.run',{text:'cache ops',from:'en',to:'zh'});
      expect(job.cached).toBeUndefined();
    }finally{await h.close();}
  });
});

describe('DeepL 设置',()=>{
  it('密钥只入 vault 且回显 configured',async()=>{
    const h=await harness();
    try{
      await unwrap(h,'settings.save',{provider:'deepl',deeplApiKey:'fixture-key:fx'});
      const settings=await unwrap(h,'settings.get');
      expect(settings.provider).toBe('deepl');expect(settings.deeplConfigured).toBe(true);
      expect(settings).not.toHaveProperty('deeplApiKey');
    }finally{await h.close();}
  });
});

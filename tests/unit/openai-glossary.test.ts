import {describe,it,expect,vi} from 'vitest';
import {OpenAIProvider,openaiEndpoint} from '../../src/server/translate/openai';
import {normalizeGlossary,protectGlossary,restoreGlossary} from '../../src/server/translate/glossary';
import {harness,unwrap} from '../helpers';

const req={text:'Hello API',from:'en',to:'zh'};

describe('OpenAI 兼容 Provider',()=>{
  it('规范化接口地址并拒绝不安全目标',()=>{
    expect(openaiEndpoint('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/chat/completions');
    expect(openaiEndpoint('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(()=>openaiEndpoint('http://example.com/v1')).toThrow();
    expect(()=>openaiEndpoint('https://user@example.com/v1')).toThrow();
  });
  it('发送术语提示、鉴权头并解析 choices 文本',async()=>{
    const transport=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:'你好，接口'}}]})));
    const provider=new OpenAIProvider('https://api.example.com/v1','fixture-key','fixture-model',[{source:'API',target:'接口'}],transport as any);
    const result=await provider.translate(req,new AbortController().signal);
    expect(result.translated).toBe('你好，接口');expect(result.provider).toBe('openai');
    const [url,options]=transport.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect((options.headers as any).authorization).toBe('Bearer fixture-key');
    const body=JSON.parse(String(options.body));expect(body.model).toBe('fixture-model');
    expect(body.messages[0].content).toContain('API => 接口');
    expect(body.messages[1].content).toBe('Hello API');
  });
});

describe('术语表',()=>{
  it('规范化、去重、最长匹配与占位恢复',()=>{
    const entries=normalizeGlossary([{source:' API ',target:' 接口 '},{source:'api',target:'重复'},{source:'API Gateway',target:'接口网关'}]);
    expect(entries).toEqual([{source:'API',target:'接口'},{source:'API Gateway',target:'接口网关'}]);
    const guarded=protectGlossary('API Gateway and api',entries);
    expect(guarded.text).toBe('⟦EK1⟧ and ⟦EK0⟧');
    expect(restoreGlossary(guarded.text,guarded.tokens)).toBe('接口网关 and 接口');
    expect(()=>normalizeGlossary(Array.from({length:101},(_,i)=>({source:`s${i}`,target:`t${i}`})))).toThrow();
  });
  it('宿主模型翻译按术语表恢复固定译法',async()=>{
    const h=await harness();
    try{
      await unwrap(h,'settings.save',{glossary:[{source:'Hello',target:'你好'}]});
      const job=await unwrap(h,'translate.run',{text:'Hello world',from:'en',to:'zh'});
      expect(job.result.translated).toContain('你好 world');
      expect(job.result.translated).not.toContain('⟦');
    }finally{await h.close();}
  });
});

describe('翻译缓存与设置',()=>{
  it('相同请求命中缓存且不重复写入历史',async()=>{
    const h=await harness();
    try{
      const first=await unwrap(h,'translate.run',{text:'cache this',from:'en',to:'zh'});
      const second=await unwrap(h,'translate.run',{text:'cache this',from:'en',to:'zh'});
      expect(second.cached).toBe(true);expect(second.id).toBe(first.id);
      expect(await unwrap(h,'translate.history',{limit:5})).toHaveLength(1);
      const retried=await unwrap(h,'translate.retry',{jobId:first.id});
      expect(retried.cached).toBeUndefined();expect(retried.request.retryNonce).toBeTruthy();
    }finally{await h.close();}
  });
  it('设置页可保存 OpenAI 兼容地址、模型与术语表且不回传密钥',async()=>{
    const h=await harness();
    try{
      await unwrap(h,'settings.save',{provider:'openai',openaiBaseUrl:'http://127.0.0.1:11434/v1',openaiModel:'qwen2.5',glossary:[{source:'Agent',target:'智能体'}]});
      const settings=await unwrap(h,'settings.get');
      expect(settings.provider).toBe('openai');expect(settings.openaiModel).toBe('qwen2.5');
      expect(settings.openaiConfigured).toBe(true);expect(settings.glossary).toEqual([{source:'Agent',target:'智能体'}]);
      expect(settings).not.toHaveProperty('openaiApiKey');
    }finally{await h.close();}
  });
});

import {describe,it,expect,vi} from 'vitest';
import {BaiduProvider,baiduError} from '../../src/server/translate/baidu';
import {DeepLProvider,deeplEndpoint} from '../../src/server/translate/deepl';
import {validateRequest,detect,needsTranslation} from '../../src/server/translate/provider';
import {HostModelProvider} from '../../src/server/translate/host-model';
import {countText} from '../../src/shared/count';
const req={text:'Hello world',from:'auto',to:'zh'};
describe('翻译 Provider',()=>{
  it('语言检测覆盖中英日',()=>{expect(detect('你好')).toBe('zh');expect(detect('こんにちは')).toBe('ja');expect(detect('hello')).toBe('en');});
  it('整封邮件中混有英文时即使主体是中文也会翻译',()=>{expect(needsTranslation('纯中文正文','zh')).toBe(false);expect(needsTranslation('本周你的订阅源有 1,416 条未读。Follow updates at https://example.com','zh')).toBe(true);expect(needsTranslation('Hello 你好','en')).toBe(true);expect(needsTranslation('Hello world','en')).toBe(false);});
  it('字符统计按 Unicode 码点而非 UTF16',()=>{expect(countText('你好 abc 🙂')).toEqual({chars:6,words:2});});
  it.each([['','VALIDATION'],['a'.repeat(5001),'INPUT_TOO_LONG']])('拒绝无效输入 %s', (text,code)=>{expect(()=>validateRequest({...req,text})).toThrow();try{validateRequest({...req,text});}catch(e){expect((e as any).code).toBe(code);}});
  it('拒绝错误语言或 Provider',()=>{expect(()=>validateRequest({...req,to:'xx'})).toThrow();expect(()=>validateRequest({...req,provider:'bad' as any})).toThrow();});
  it.each([['52003','AUTH_FAILED',false],['54001','AUTH_FAILED',false],['54003','RATE_LIMITED',true],['54004','PROVIDER_QUOTA',false],['54005','RATE_LIMITED',true],['52001','TIMEOUT',true],['58001','UNSUPPORTED_LANGUAGE',false],['52002','PROVIDER_BAD_RESPONSE',true],['unknown','PROVIDER_BAD_RESPONSE',false]])('百度错误 %s -> %s', (code,expected,retryable)=>{const error=baiduError(code);expect(error.code).toBe(expected);expect(error.retryable).toBe(retryable);});
  it('百度使用 HTTPS POST、签名、供应商语言码，密钥不出现在请求参数',async()=>{
    const transport=vi.fn(async()=>new Response(JSON.stringify({from:'en',trans_result:[{dst:'你好'}]})));
    const provider=new BaiduProvider('fixture_app','fixture_key',transport as any);
    const result=await provider.translate({...req,from:'ja'},new AbortController().signal);
    expect(result.provider).toBe('baidu');expect(result.translated).toBe('你好');
    const [url,options]=transport.mock.calls[0] as unknown as [string,RequestInit];expect(url.startsWith('https:')).toBe(true);
    const params=options.body as URLSearchParams;expect(params.get('from')).toBe('jp');expect(params.get('sign')).toMatch(/^[a-f0-9]{32}$/);expect(params.toString()).not.toContain('fixture_key');
  });
  it('百度缺配置、无效响应、HTTP限流和鉴权错误',async()=>{
    await expect(new BaiduProvider('','').translate(req,new AbortController().signal)).rejects.toMatchObject({code:'AUTH_FAILED'});
    for(const response of [new Response('not json'),new Response('{}'),new Response('{"trans_result":[]}'),new Response('{"error_code":"54001"}'),new Response('x',{status:429})]){
      await expect(new BaiduProvider('a','b',async()=>response).translate(req,new AbortController().signal)).rejects.toBeDefined();
    }
  });
  it('宿主模型遵循 Responses 输入和输出',async()=>{const respond=vi.fn(async()=>({output:[{content:[{type:'output_text',text:'模型译文'}]}]}));expect((await new HostModelProvider(respond,undefined,'fixture-model').translate(req,new AbortController().signal)).translated).toBe('模型译文');expect(respond.mock.calls[0]).toBeDefined();});
  it('宿主模型缺配置和空返回',async()=>{await expect(new HostModelProvider(undefined,undefined,'').translate(req,new AbortController().signal)).rejects.toMatchObject({code:'VALIDATION'});await expect(new HostModelProvider(async()=>({}),undefined,'model').translate(req,new AbortController().signal)).rejects.toMatchObject({code:'PROVIDER_BAD_RESPONSE'});});
  it('DeepL 免费/付费端点、语言映射、鉴权头与响应解析',async()=>{
    expect(deeplEndpoint('key:fx')).toBe('https://api-free.deepl.com/v2/translate');
    expect(deeplEndpoint('key')).toBe('https://api.deepl.com/v2/translate');
    const transport=vi.fn(async()=>new Response(JSON.stringify({translations:[{detected_source_language:'EN',text:'你好'}]})));
    const result=await new DeepLProvider('key:fx',transport as any).translate(req,new AbortController().signal);
    expect(result.provider).toBe('deepl');expect(result.translated).toBe('你好');expect(result.detectedFrom).toBe('en');
    const [url,options]=transport.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe('https://api-free.deepl.com/v2/translate');
    expect((options.headers as any).authorization).toBe('DeepL-Auth-Key key:fx');
    const body=options.body as URLSearchParams;expect(body.get('target_lang')).toBe('ZH-HANS');expect(body.get('source_lang')).toBeNull();
  });
  it('DeepL 源语言、配额与鉴权错误',async()=>{
    const transport=vi.fn(async()=>new Response(JSON.stringify({translations:[{detected_source_language:'DE',text:'Hallo'}]})));
    await new DeepLProvider('key',transport as any).translate({...req,from:'de'},new AbortController().signal);
    const [,options]=transport.mock.calls[0] as unknown as [string,RequestInit];
    expect((options.body as URLSearchParams).get('source_lang')).toBe('DE');
    await expect(new DeepLProvider('',).translate(req,new AbortController().signal)).rejects.toMatchObject({code:'VALIDATION'});
    await expect(new DeepLProvider('key',async()=>new Response('',{status:403}) as any).translate(req,new AbortController().signal)).rejects.toMatchObject({code:'AUTH_FAILED'});
    await expect(new DeepLProvider('key',async()=>new Response('',{status:456}) as any).translate(req,new AbortController().signal)).rejects.toMatchObject({code:'PROVIDER_QUOTA'});
  });
});

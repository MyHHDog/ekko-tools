import {describe,it,expect,vi,afterEach} from 'vitest';
import {retry,bounded} from '../../src/server/retry';
import {AppError,errorInfo} from '../../src/shared/error-codes';
import {presets,serverEndpoint,validateAccount} from '../../src/server/mail/presets';
import {parseMime,normalize} from '../../src/server/mail/parse';
import {lifecycle} from '../helpers';
afterEach(()=>vi.useRealTimers());
describe('重试、超时与生命周期',()=>{
  it('最多3次重试，累计不超过90秒，自动释放所有计时器',async()=>{
    vi.useFakeTimers();const life=lifecycle(),fn=vi.fn(async()=>{throw new AppError('NETWORK_UNREACHABLE',true);});
    const promise=retry(fn,new AbortController().signal,life);const check=expect(promise).rejects.toMatchObject({code:'NETWORK_UNREACHABLE'});
    await vi.runAllTimersAsync();await check;expect(fn).toHaveBeenCalledTimes(4);expect(life.handles.size).toBe(0);
  });
  it('鉴权不重试',async()=>{const fn=vi.fn(async()=>{throw new AppError('AUTH_FAILED');}),life=lifecycle();await expect(retry(fn,new AbortController().signal,life)).rejects.toMatchObject({code:'AUTH_FAILED'});expect(fn).toHaveBeenCalledTimes(1);expect(life.handles.size).toBe(0);});
  it('限流退避至少5秒，取消使请求失败',async()=>{
    vi.useFakeTimers();const life=lifecycle(),controller=new AbortController(),started=Date.now();let count=0;
    const work=retry(async()=>{if(++count===1)throw new AppError('RATE_LIMITED',true);return 'ok';},controller.signal,life);
    await vi.advanceTimersByTimeAsync(4999);expect(count).toBe(1);await vi.advanceTimersByTimeAsync(1);expect(await work).toBe('ok');expect(Date.now()-started).toBe(5000);
    controller.abort();await expect(retry(async()=>true,controller.signal,life)).rejects.toMatchObject({code:'TIMEOUT'});
  });
  it('总时限阻止慢请求重试，生命周期清理中止悬挂请求',async()=>{
    vi.useFakeTimers();const life=lifecycle(),fn=vi.fn(()=>new Promise<never>(()=>{}));
    const promise=retry(fn,new AbortController().signal,life,20000,21000),check=expect(promise).rejects.toMatchObject({code:'TIMEOUT'});
    await vi.runAllTimersAsync();await check;expect(fn).toHaveBeenCalledTimes(1);expect(life.handles.size).toBe(0);
    const pending=bounded(()=>new Promise(()=>{}),new AbortController().signal,life),check2=expect(pending).rejects.toMatchObject({code:'TIMEOUT'});await life.close();await check2;
  });
});
describe('IMAP 参数与 MIME',()=>{
  it('三个预设固定 TLS993/SMTP465，自建服务器需显式配置',()=>{
    expect(Object.values(presets).map(p=>p.host)).toEqual(['imap.163.com','imap.qq.com','imap.gmail.com']);
    expect(Object.values(presets).map(p=>p.smtp.host)).toEqual(['smtp.163.com','smtp.qq.com','smtp.gmail.com']);
    expect(Object.values(presets).every(p=>p.secure&&p.port===993&&p.smtp.secure&&p.smtp.port===465)).toBe(true);
    const custom={imap:{host:'mail.example.com',port:993,secure:true},smtp:{host:'mail.example.com',port:465,secure:true}};
    expect(()=>validateAccount('custom','me@example.com','password',custom)).not.toThrow();
    expect(serverEndpoint({provider:'custom',...custom},'smtp')).toEqual(custom.smtp);
    expect(()=>validateAccount('custom','me@example.com','password')).toThrow();
  });
  it('应用密码与授权码校验',()=>{expect(()=>validateAccount('gmail','a@gmail.com','ordinary')).toThrow();expect(()=>validateAccount('gmail','a@gmail.com','aaaa bbbb cccc dddd')).not.toThrow();expect(()=>validateAccount('qq','a@evil.invalid','x')).toThrow();expect(()=>validateAccount('163','demo@example.com','')).toThrow();expect(()=>validateAccount('163','demo@126.com','code')).not.toThrow();expect(()=>validateAccount('163','demo@vip.163.com','code')).not.toThrow();});
  it('解析 RFC2047 中文主题、文本与附件文件名',async()=>{
    const raw=await parseMime(Buffer.from('From: =?UTF-8?B?5byg5LiJ?= <sender@example.com>\r\nTo: demo@example.net\r\nSubject: =?UTF-8?B?5Lya6K6u?=\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n你好 Hello'), '1:1');
    expect(raw.subject).toBe('会议');expect(raw.from.name).toBe('张三');expect(raw.text).toContain('你好');
    const account={id:'1',provider:'163'} as any;
    expect(normalize({...raw,text:'',html:'<p>安全正文</p>',attachments:[{id:'0',filename:'../a.exe',mime:'text/plain',size:1,dataBase64:'YQ=='}]},account,100).attachments[0].blocked).toBe('dangerous_type');
  });
  it('原生异常转安全错误码，不泄露原始消息',()=>{expect(errorInfo(new Error('private')).message).not.toContain('private');expect(errorInfo({code:'ENOTFOUND'}).code).toBe('NETWORK_UNREACHABLE');expect(errorInfo({name:'AbortError'}).code).toBe('TIMEOUT');});
});

import {describe,it,expect,afterEach,vi} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Vault} from '../../src/server/vault/store';
import {seal,unseal} from '../../src/server/vault/crypto';
import {sanitizeHtml,plainText,filename,dangerous,BODY_LIMIT} from '../../src/server/mail/sanitize';
import {createPinnedLookup,remoteImages} from '../../src/server/mail/images';
import {redact,diagnostic} from '../../src/server/log';
import {tempdir,cleanup} from '../helpers';
const directories:string[]=[];afterEach(async()=>{vi.restoreAllMocks();for(const directory of directories.splice(0))await cleanup(directory);});
describe('凭据 vault',()=>{
  it('AES-GCM 落盘没有明文或 base64 凭据，支持重启读取与删除',async()=>{
    const directory=await tempdir();directories.push(directory);
    const secret='fixture-only-authorization',passphrase='fixture-only-passphrase',vault=new Vault(directory,passphrase);
    await vault.put('account',secret);
    const file=await readFile(join(directory,'vault.bin'));
    for(const text of [secret,passphrase,Buffer.from(secret).toString('base64')])expect(file.includes(Buffer.from(text))).toBe(false);
    expect(await new Vault(directory,passphrase).get('account')).toBe(secret);
    await vault.delete('account');await expect(vault.get('account')).rejects.toMatchObject({code:'NOT_FOUND'});
  });
  it('随机密钥只作为服务端本机文件，串行并发不丢记录',async()=>{
    const directory=await tempdir();directories.push(directory);const vault=new Vault(directory);
    await Promise.all([vault.put('a','fixture-a'),vault.put('b','fixture-b')]);
    expect(await vault.get('a')).toBe('fixture-a');expect(await vault.get('b')).toBe('fixture-b');
    expect((await readFile(join(directory,'vault.key'))).length).toBe(32);
    expect(await new Vault(directory).get('b')).toBe('fixture-b');
  });
  it('篡改密文、头部或错误口令均拒绝解锁',async()=>{
    const directory=await tempdir();directories.push(directory);const vault=new Vault(directory,'fixture-pass');
    await vault.put('a','fixture-value');const original=await readFile(join(directory,'vault.bin'));
    await expect(new Vault(directory,'wrong-pass').get('a')).rejects.toMatchObject({code:'VAULT_LOCKED'});
    const doc=JSON.parse(original.toString());const cipher=Buffer.from(doc.ciphertext,'base64');cipher[0]^=1;doc.ciphertext=cipher.toString('base64');
    await writeFile(join(directory,'vault.bin'),JSON.stringify(doc));await expect(vault.get('a')).rejects.toMatchObject({code:'VAULT_LOCKED'});
    const envelope=JSON.parse(original.toString());envelope.header=Buffer.from(JSON.stringify({version:2})).toString('base64');
    await expect(unseal(Buffer.from(JSON.stringify(envelope)),'fixture-pass')).rejects.toThrow('Invalid header');
  });
  it('不同密文随机化，公开加密接口可往返',async()=>{const a=await seal({a:'one'},'fixture');const b=await seal({a:'one'},'fixture');expect(a.equals(b)).toBe(false);expect(await unseal(a,'fixture')).toEqual({a:'one'});});
});
describe('HTML 与附件安全',()=>{
  const payloads=['<script>window.__xss=1</script>','<img src=x onerror=window.__xss=1>','<a href="JaVa&#x09;Script:window.__xss=1">x</a>','<a href="&#106;avascript:alert(1)">x</a>','<svg onload=x></svg>','<iframe srcdoc="<script>x</script>"></iframe>','<form><input name=p></form>','<style>@import url(http://evil.example.invalid)</style>','<meta http-equiv=refresh content=0><base href=x>','<div style="background:url(javascript:x)">safe</div>','<math><mtext><img src=x onerror=x></mtext></math>'];
  it.each(payloads)('中和载荷 %#',raw=>{const output=sanitizeHtml(raw).html;expect(output).not.toMatch(/<(script|svg|iframe|form|input|style|meta|base|math)\b|\son\w+=|javascript:|url\(/i);});
  it('图片默认拦截且标记，CID 已内联位图可保留',()=>{expect(sanitizeHtml('<img src="https://tracker.example.invalid/x">').remoteBlocked).toBe(true);const clean=sanitizeHtml('<img src="cid:x">',{'cid:x':'data:image/png;base64,YQ=='});expect(clean.html).toContain('data:image/png');expect(clean.remoteBlocked).toBe(false);});
  it('保留邮件原始内联排版，移除可执行 CSS',()=>{const clean=sanitizeHtml('<table width="600" bgcolor="#ffffff"><tr><td style="color:#333;font-size:14px;background:url(javascript:x);position:fixed">x</td></tr></table>').html;expect(clean).toContain('width="600"');expect(clean).toContain('color:#333');expect(clean).not.toContain('url(');expect(clean).not.toContain('position');});
  it('保留安全邮件样式表，移除外部加载与覆盖定位',()=>{const clean=sanitizeHtml('<style>.x{color:#123456}@import url(https://evil.invalid/a.css).y{background:url(https://evil.invalid/b.png);position:fixed;z-index:9}</style><p class="x">x</p>').html;expect(clean).toContain('<style>');expect(clean).toContain('.x{color:#123456}');expect(clean).toContain('class="x"');expect(clean).not.toMatch(/@import|url\(|position|z-index/i);});
  it('被拦截图片保留尺寸占位且不再插入解释文字',()=>{const clean=sanitizeHtml('<img src="https://img.example.com/a.png" width="640" height="120" style="width:100%">');expect(clean.remoteBlocked).toBe(true);expect(clean.html).toContain('width="640"');expect(clean.html).toContain('height="120"');expect(clean.html).not.toContain('图片已拦截');});
  it('远程图片清单覆盖整封邮件而非只取前四张',()=>{const html=Array.from({length:8},(_,i)=>`<img src="https://img${i}.example.com/a.png">`).join('')+'<img src="http://legacy.example.com/a.png">';expect(remoteImages(html)).toHaveLength(9);expect(remoteImages(html)).toContain('http://legacy.example.com/a.png');});
  it('远程图片 DNS 固定在 all:true 时返回完整地址列表',()=>{
    const results=[{address:'203.0.113.10',family:4},{address:'203.0.113.11',family:4}],lookup=createPinnedLookup(results);
    const all=vi.fn(),one=vi.fn();
    lookup('img.example.com',{all:true},all);
    lookup('img.example.com',{all:false},one);
    expect(all).toHaveBeenCalledWith(null,results);
    expect(one).toHaveBeenCalledWith(null,results[0].address,results[0].family);
  });
  it('无属性节点与显式alt也通过白名单处理',()=>{expect(sanitizeHtml('<img><a>没有地址</a>').remoteBlocked).toBe(true);expect(sanitizeHtml('<img src="data:image/png;base64,YQ==" alt="说明">').html).toContain('alt="说明"');});
  it('合法链接保留 rel/target，拒绝协议相对与file地址',()=>{const clean=sanitizeHtml('<a href="https://example.com">ok</a><a href="//evil.invalid">x</a><a href="file:///a">x</a>');expect(clean.html).toContain('noopener noreferrer nofollow');expect(clean.html).not.toContain('file:');expect(clean.html).not.toContain('//evil');});
  it('HTML 超限可控并提示，文本清洗保留分段',()=>{const clean=sanitizeHtml('<p>'+('a'.repeat(BODY_LIMIT+1))+'</p>');expect(clean.truncated).toBe(true);expect(Buffer.byteLength(clean.html)).toBeLessThanOrEqual(BODY_LIMIT);expect(plainText('<p>A&amp;B</p><p>&lt;你好&gt;</p>')).toBe('A&B\n\n<你好>');});
  it('附件名称无路径穿越，危险扩展与 MIME 一并拦截',()=>{expect(filename('../..\\evil.txt')).not.toMatch(/[/\\]/);expect(filename('')).toBe('attachment');expect(dangerous('a.pdf.exe','text/plain')).toBe(true);expect(dangerous('a.txt','text/html')).toBe(true);expect(dangerous('a.pdf','application/pdf')).toBe(false);});
});
describe('日志脱敏',()=>{
  it('递归移除敏感键、正文、附件、主题与完整地址',()=>{
    const input={password:'private',authCode:'private',token:'private',nested:[{secret:'private',body:'mail body',subject:'ABC',html:'<p>body</p>',attachment:'bytes',address:'alice@example.com',stack:'raw stack'}],n:42,v:null};
    expect(redact(input)).toEqual({password:'[REDACTED]',authCode:'[REDACTED]',token:'[REDACTED]',nested:[{secret:'[REDACTED]',body:'[OMITTED]',subject:3,html:'[OMITTED]',attachment:'[OMITTED]',address:'a***@example.com',stack:'[OMITTED]'}],n:42,v:null});
  });
  it('诊断仅含固定元信息，账号散列不泄露原值',()=>{expect(diagnostic('test','fixture','AUTH_FAILED')).toMatchObject({level:'error',errorCode:'AUTH_FAILED'});expect(diagnostic('ok').level).toBe('info');expect(diagnostic('test','fixture').accountIdHash).toHaveLength(8);expect(JSON.stringify(diagnostic('x','fixture'))).not.toContain('"fixture"');});
});

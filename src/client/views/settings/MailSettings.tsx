import {useEffect,useRef,useState} from 'react';
import type {ClientHost} from '../../adapter/host';
import type {Bootstrap} from '../../../shared/rpc-contract';
import {call,readable} from '../../rpc-client';
import {Source,connectionLabels} from '../../components/AccountChip';
import {Icon,State} from '../../components/States';
import {t} from '../../i18n';
import {endpointSecure} from '../../../shared/mail';
export function MailSettings({ctx,data,refresh}:{ctx:ClientHost;data:Bootstrap;refresh:()=>Promise<void>}){
  const [provider,setProvider]=useState('163'),[address,setAddress]=useState(''),[alias,setAlias]=useState(''),[auth,setAuth]=useState('');
  const [username,setUsername]=useState(''),[imapHost,setImapHost]=useState(''),[imapPort,setImapPort]=useState('993'),[imapSecure,setImapSecure]=useState(true);
  const [smtpHost,setSmtpHost]=useState(''),[smtpPort,setSmtpPort]=useState('465'),[smtpSecure,setSmtpSecure]=useState(true);
  const [reAuth,setReAuth]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<any>(),[notice,setNotice]=useState('');
  const [syncReadReceipts,setSyncReadReceipts]=useState(false);
  const form=useRef<HTMLDivElement>(null);
  useEffect(()=>{let active=true;call(ctx,'settings.get').then(value=>{if(active)setSyncReadReceipts(value.syncReadReceipts===true);}).catch(()=>{});return()=>{active=false;};},[ctx]);
  async function toggleReadReceipts(next:boolean){
    const previous=syncReadReceipts;setSyncReadReceipts(next);setError(undefined);
    try{await call(ctx,'settings.save',{syncReadReceipts:next});ctx.ui.notify(t(next?'已开启服务器已读回写':'已关闭服务器已读回写'),'success');}
    catch(e){setSyncReadReceipts(previous);setError(readable(e));}
  }
  async function save(){
    if(busy)return;
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim())){
      setError({code:'VALIDATION',message:t('请输入有效的邮箱地址'),retryable:false});return;
    }
    if(provider!=='custom'){
      const domain=address.trim().split('@')[1].toLowerCase();
      const domains=provider==='163'?['163.com','vip.163.com','126.com','vip.126.com','yeah.net']:provider==='qq'?['qq.com','foxmail.com']:['gmail.com','googlemail.com'];
      if(!domains.includes(domain)){
        setError({code:'VALIDATION',message:t('邮箱域名与所选服务商不匹配'),retryable:false});return;
      }
    }
    if(!auth.trim()){
      setError({code:'VALIDATION',message:t(provider==='custom'?'请输入邮箱密码':'请输入客户端授权码'),retryable:false});return;
    }
    if(provider==='gmail'&&auth.replace(/\s/g,'').length!==16){
      setError({code:'AUTH_REQUIRED_APP_PASSWORD',message:t('Gmail 应用专用密码应为 16 位字母数字'),retryable:false});return;
    }
    const imapNumber=Number(imapPort),smtpNumber=Number(smtpPort);
    if(provider==='custom'){
      if(!imapHost.trim()||!smtpHost.trim()){
        setError({code:'VALIDATION',message:t('请填写 IMAP 和 SMTP 服务器地址'),retryable:false});return;
      }
      if(!Number.isInteger(imapNumber)||imapNumber<1||imapNumber>65535||!Number.isInteger(smtpNumber)||smtpNumber<1||smtpNumber>65535){
        setError({code:'VALIDATION',message:t('服务器端口应为 1-65535'),retryable:false});return;
      }
    }
    setBusy(true);setError(undefined);setNotice('');
    try{
      const payload:any={provider,address:address.trim(),alias:alias.trim(),secret:auth};
      if(provider==='custom'){
        payload.username=username.trim()||undefined;
        payload.imap={host:imapHost.trim(),port:imapNumber,secure:endpointSecure('imap',imapNumber,imapSecure)};
        payload.smtp={host:smtpHost.trim(),port:smtpNumber,secure:endpointSecure('smtp',smtpNumber,smtpSecure)};
      }
      await call(ctx,'mail.account.add',payload);
      setAddress('');setAlias('');setAuth('');setUsername('');setImapHost('');setImapPort('993');setImapSecure(true);setSmtpHost('');setSmtpPort('465');setSmtpSecure(true);setReAuth('');
      await refresh();setNotice(t('账号已保存并连接成功'));ctx.ui.notify(t('账号已保存'),'success');
    }catch(e){
      const safe=readable(e);setError(safe);await refresh().catch(()=>{});
      if(safe.code!=='VALIDATION'&&safe.code!=='VAULT_LOCKED')setNotice(t(provider==='custom'?'密码已保存，连接未通过。检查服务器地址、端口和 TLS 设置后点击“立即重连”。':'授权码已保存，连接未通过。检查授权码或 IMAP 开关后点击“立即重连”。'));
    }finally{setBusy(false);}
  }
  async function run(work:()=>Promise<unknown>){
    setBusy(true);setError(undefined);setNotice('');
    try{await work();await refresh();}catch(e){setError(readable(e));await refresh().catch(()=>{});}finally{setBusy(false);}
  }
  function edit(account:any){
    setReAuth(account.id);setProvider(account.provider);setAddress(account.address);setAlias(account.alias);setAuth('');
    const imapPortValue=Number(account.imap?.port||993),smtpPortValue=Number(account.smtp?.port||465);
    setUsername(account.username||'');setImapHost(account.imap?.host||'');setImapPort(String(imapPortValue));setImapSecure(endpointSecure('imap',imapPortValue,account.imap?.secure!==false));
    setSmtpHost(account.smtp?.host||'');setSmtpPort(String(smtpPortValue));setSmtpSecure(endpointSecure('smtp',smtpPortValue,account.smtp?.secure!==false));
    setError(undefined);setNotice('');
    requestAnimationFrame(()=>form.current?.scrollIntoView({behavior:'smooth',block:'center'}));
  }
  return <section className="settings-section settings-mail" aria-label={t('邮箱账号')}>
    <div className="section-heading"><div><h2>{reAuth?t('重新授权'):t('添加邮箱')}</h2><p className="small">{t('密码只保存在本机加密凭据库，不会回填。')}</p></div></div>
    <div ref={form} role="form" aria-label={t('添加邮箱')} className="card settings-form" onKeyDown={e=>{
      if(e.key==='Enter'&&(e.target as HTMLElement).tagName==='INPUT'){e.preventDefault();void save();}
    }}>
      <div className="form-grid">
        <label>{t('邮箱服务商')}<select value={provider} disabled={!!reAuth} onChange={e=>setProvider(e.target.value)}>
          <option value="163">■ 163 / 126</option><option value="qq">● QQ / Foxmail</option><option value="gmail">▲ Gmail</option><option value="custom">◆ {t('自建邮箱（IMAP / SMTP）')}</option></select></label>
        <label>{t('邮箱地址')}<input type="email" required autoComplete="username" value={address} readOnly={!!reAuth} onChange={e=>setAddress(e.target.value)} placeholder={t('填写邮箱地址')}/></label>
        <label>{t('账号别名（最多 6 字）')}<input value={alias} maxLength={6} onChange={e=>setAlias(e.target.value)} placeholder={t('可选')}/></label>
        <label>{provider==='gmail'?t('16 位应用专用密码'):provider==='custom'?t('邮箱密码'):t('客户端授权码')}<input type="password" value={auth} onChange={e=>setAuth(e.target.value)} required autoComplete="new-password" placeholder={provider==='gmail'?'xxxx xxxx xxxx xxxx':provider==='custom'?t('填写邮箱密码'):t('填写客户端授权码')}/></label>
        {provider==='custom'&&<>
          <label>{t('登录用户名（默认邮箱地址）')}<input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" placeholder={t('可选')}/></label>
          <label>IMAP {t('服务器')}<input value={imapHost} onChange={e=>setImapHost(e.target.value)} placeholder="imap.example.com" autoComplete="off"/></label>
          <label>IMAP {t('端口')}<input type="number" min="1" max="65535" value={imapPort} onChange={e=>{const value=e.target.value;setImapPort(value);setImapSecure(endpointSecure('imap',Number(value),imapSecure));}}/></label>
          <label className="check-line"><input type="checkbox" checked={imapSecure} onChange={e=>setImapSecure(e.target.checked)}/>{t('IMAP 使用 TLS')}</label>
          <label>SMTP {t('服务器')}<input value={smtpHost} onChange={e=>{const value=e.target.value;setSmtpHost(value);if(!imapHost.trim())setImapHost(value);}} placeholder="smtp.example.com" autoComplete="off"/></label>
          <label>SMTP {t('端口')}<input type="number" min="1" max="65535" value={smtpPort} onChange={e=>{const value=e.target.value;setSmtpPort(value);setSmtpSecure(endpointSecure('smtp',Number(value),smtpSecure));}}/></label>
          <label className="check-line"><input type="checkbox" checked={smtpSecure} onChange={e=>setSmtpSecure(e.target.checked)}/>{t('SMTP 使用 TLS')}</label>
        </>}
      </div>
      <p className="small">{provider==='gmail'?t('开启两步验证并生成应用专用密码；不支持普通密码或 OAuth。'):provider==='custom'?t('使用 IMAP 收信、SMTP 回复；密码只保存在本机加密凭据库。'):t('请先在邮箱设置中开启 IMAP，并生成客户端授权码。')}</p>
      {provider==='custom'&&<p className="small">{t('常用配置：IMAP 993 + TLS 或 143 + STARTTLS；SMTP 465 + TLS 或 587 + STARTTLS。')}</p>}
      <div className="row wrap"><button type="button" className="primary" disabled={busy} onClick={()=>void save()}>{busy?t('正在校验…'):t('校验并保存')}</button>
        {reAuth&&<button type="button" disabled={busy} onClick={()=>{setReAuth('');setAddress('');setAlias('');setAuth('');setUsername('');setImapHost('');setImapPort('993');setImapSecure(true);setSmtpHost('');setSmtpPort('465');setSmtpSecure(true);setError(undefined);setNotice('');}}>{t('取消')}</button>}</div>
    </div>
    <div className="card settings-form">
      <label className="notify-row"><span><strong>{t('同步已读到邮箱服务器')}</strong><small>{t('开启后把已读/未读写入 IMAP，其他客户端同步生效；默认只在本机记录。')}</small></span>
        <input type="checkbox" aria-label={t('同步已读到邮箱服务器')} checked={syncReadReceipts} onChange={e=>void toggleReadReceipts(e.target.checked)}/><span className="notify-switch" aria-hidden="true"/></label>
    </div>
    {notice&&<p className={error?'state bad':'state'} role="status"><Icon name={error?'alert':'check'}/><span>{notice}</span></p>}
    {error&&<State kind={error.code==='AUTH_FAILED'||error.code==='AUTH_REQUIRED_APP_PASSWORD'?'invalid':'syncError'} detail={`${error.code} · ${error.message}`} action={<button className="compact" onClick={()=>setError(undefined)}>{t('重新填写')}</button>}/>}
    <div className="section-heading"><h2>{t('已添加账号')}<span className="count">{data.accounts.length}</span></h2></div>
    {!data.accounts.length&&<State kind="noAccounts"/>}
    {data.accounts.map(account=><article key={account.id} className="card settings-account">
      <div className="row"><Source account={account}/><span className="address" title={account.address}>{account.address}</span></div>
      {account.provider==='custom'&&account.imap&&account.smtp&&<p className="small">IMAP {account.imap.host}:{account.imap.port} · SMTP {account.smtp.host}:{account.smtp.port}</p>}
      <p className="row small"><Icon name={account.state.status==='auth_failed'?'lock':account.state.status==='offline'?'alert':'mail'} sm/>{t(connectionLabels[account.state.status])}</p>
      {account.state.status!=='connected'&&'error' in account.state&&account.state.error&&<p className="small">{account.state.error.message}</p>}
      <div className="row wrap"><button className="compact" disabled={busy} onClick={()=>void run(()=>call(ctx,'mail.account.test',{accountId:account.id}))}>{t('立即重连')}</button>
        <button className="compact" disabled={busy} onClick={()=>edit(account)}>{t('重新授权')}</button>
        <button className="compact" disabled={busy} onClick={()=>void run(async()=>{if(await ctx.ui.confirm(t('删除此账号及本机凭据、邮件缓存和已读标记？')))await call(ctx,'mail.account.remove',{accountId:account.id});})}>{t('删除账号')}</button></div>
    </article>)}
  </section>;
}

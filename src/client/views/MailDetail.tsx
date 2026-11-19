import {useState,useEffect,useRef} from 'react';
import type {Account,MailMessage,MailSummary,BilingualBody,BilingualSegment} from '../../shared/types';
import type {ClientHost} from '../adapter/host';
import {call,readable,cancelPending,uiTask} from '../rpc-client';
import {State,Icon} from '../components/States';
import {Source} from '../components/AccountChip';
import {MailBodyFrame} from '../components/MailBodyFrame';
import {t,tFormat} from '../i18n';
import {Language} from './Translate';
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]||char));
const translatedText=(body?:BilingualBody)=>(body?.segments.map(segment=>segment.translated||'').filter(Boolean).join('\n\n')||'').trim();
function translatedDocument(text:string){
  return text.split(/\n{2,}/).filter(Boolean).map(block=>`<p>${escapeHtml(block).replace(/\n/g,'<br>')}</p>`).join('');
}
export function MailDetail({ctx,account,messageId,target,onTarget,onBack,onTranslated,onReadChange,neighbors,onOpen,pane=false}:{ctx:ClientHost;account:Account;messageId:string;target:string;onTarget?:(s:string)=>void;onBack:()=>void;onTranslated:()=>void;onReadChange?:(read:boolean)=>void;neighbors:MailSummary[];onOpen:(mail:MailSummary)=>void;pane?:boolean}){
  const [mail,setMail]=useState<MailMessage>(),[body,setBody]=useState<BilingualBody>(),[showingTranslation,setShowingTranslation]=useState(false),[to,setTo]=useState(target);
  const [read,setRead]=useState<boolean>();
  const [busy,setBusy]=useState(false),[error,setError]=useState<any>(),[attachmentError,setAttachmentError]=useState<any>(),[downloading,setDownloading]=useState('');
  const [translationError,setTranslationError]=useState<any>();
  const [replyOpen,setReplyOpen]=useState(false),[replyBody,setReplyBody]=useState(''),[sending,setSending]=useState(false),[replyError,setReplyError]=useState<any>();
  const active=useRef(true),cache=useRef(new Map<string,BilingualBody>());
  const lastDownload=useRef('');
  const downloadVersion=useRef(0),[downloadProgress,setDownloadProgress]=useState<number>(),[progress,setProgress]=useState({done:0,total:0});
  const invoke=<T=any,>(name:string,input:object)=>call<T>(ctx,name,{...input,__owner:'detail'});
  async function load(){setError(undefined);try{const data=await call<MailMessage>(ctx,'mail.get',{accountId:account.id,messageId});
    if(!active.current)return;setMail(data);setRead(!data.unread);
    if(data.unread){setRead(true);onReadChange?.(true);void call(ctx,'mail.mark-read',{accountId:account.id,messageId,read:true}).catch(()=>{if(!active.current)return;setRead(false);onReadChange?.(false);});}
    if(data.remoteContentBlocked)void loadRemoteImages();
  }catch(e){if(active.current)setError(readable(e));}}
  async function updateRead(next:boolean){
    const previous=read;setRead(next);onReadChange?.(next);
    try{const result=await call<{ok:boolean;synced?:boolean}>(ctx,'mail.mark-read',{accountId:account.id,messageId,read:next});
      if(result.synced===false)ctx.ui.notify(t('已在本机标记；服务器同步失败'),'error');
      else ctx.ui.notify(next?t('已标为已读'):t('已标为未读'),'success');}
    catch(e){setRead(previous);onReadChange?.(!!previous);throw e;}
  }
  async function sendReply(){
    if(sending)return;
    if(!replyBody.trim()){setReplyError({code:'VALIDATION',message:t('请输入回复内容'),retryable:false});return;}
    setSending(true);setReplyError(undefined);
    try{
      await call(ctx,'mail.reply',{accountId:account.id,messageId,body:replyBody,__owner:'detail'});
      if(!active.current)return;
      setReplyOpen(false);setReplyBody('');ctx.ui.notify(t('回复已发送'),'success');
    }catch(e){if(active.current)setReplyError(readable(e));}
    finally{if(active.current)setSending(false);}
  }
  async function loadRemoteImages(){
    try{const {domains}=await invoke<{domains:string[]}>('mail.image-domains',{accountId:account.id,messageId});
      if(!active.current||!domains.length)return;
      const loaded=await invoke<MailMessage>('mail.images',{accountId:account.id,messageId,confirmed:true,allowedDomains:domains});
      if(active.current)setMail(loaded);
    }catch{/* 图片加载失败时保留占位，避免打断正文阅读。 */}
  }
  useEffect(()=>{active.current=true;setReplyOpen(false);setReplyBody('');setReplyError(undefined);void load();return()=>{active.current=false;downloadVersion.current++;cancelPending(ctx,'detail');cancelPending(ctx,'attachment');};},[messageId]);
  useEffect(()=>ctx.messages.on('translate.progress',event=>{
    const value=event.data||event;if(value.jobId!==`${account.id}:${messageId}:${to}`||!value.segment||!active.current)return;
    setProgress({done:value.done,total:value.total});
    setBody(old=>{const segments: BilingualSegment[]=old?.segments.slice()||Array.from({length:value.total},(_,index)=>({index,source:''}));segments[value.segment.index]=value.segment;return {messageId,segments,complete:value.done===value.total&&segments.every(s=>!!s.translated)};});
  }),[account.id,messageId,to]);
  async function translate(extra:object={}){
    const previous=cache.current.get(to);
    if(previous&&!Object.keys(extra).length){setTranslationError(undefined);setBody(previous);setShowingTranslation(previous.segments.some(s=>!!s.translated));return;}
    setBusy(true);setTranslationError(undefined);
    try{let data=await invoke<BilingualBody>('mail.bilingual',{accountId:account.id,messageId,target:to,...extra});
      for(let round=1;round<data.segments.length&&!data.complete&&active.current;round++){
        const done=data.segments.filter(s=>!!s.translated).length;
        const next=await invoke<BilingualBody>('mail.bilingual',{accountId:account.id,messageId,target:to,continue:true});
        if(next.segments.filter(s=>!!s.translated).length<=done){data=next;break;}
        data=next;
      }
      if(active.current){
        const translated=data.segments.some(s=>!!s.translated);
        setBody(data);cache.current.set(to,data);setShowingTranslation(translated);
        if(translated)onTranslated();else setTranslationError(data.segments.find(s=>s.error)?.error||readable(new Error(t('翻译失败，请检查网络后重试'))));
      }
    }catch(e){if(active.current)setTranslationError(readable(e));}
    finally{if(active.current)setBusy(false);}
  }
  async function download(id:string){
    lastDownload.current=id;
    const version=++downloadVersion.current;setDownloadProgress(0);setDownloading(id);setAttachmentError(undefined);
    try{const file=await call(ctx,'mail.attachment',{accountId:account.id,messageId,attachmentId:id,__owner:'attachment'});
      if(!active.current||version!==downloadVersion.current)return;setDownloadProgress(100);
      const bytes=Uint8Array.from(atob(file.dataBase64),(c:string)=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
      const a=document.createElement('a');a.href=url;a.download=file.filename;document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);
    }catch(e){if(active.current&&version===downloadVersion.current)setAttachmentError(readable(e));}finally{if(active.current&&version===downloadVersion.current)setDownloading('');}
  }
  const position=neighbors.findIndex(m=>m.messageId===messageId&&m.accountId===account.id);
  const translated=translatedText(body);
  return <section className={'detail'+(pane?' detail-pane':'')} aria-label="邮件详情" onKeyDown={e=>{
    if(e.key==='Escape'&&replyOpen){e.preventDefault();setReplyOpen(false);return;}
    if((e.key==='Escape'||e.key==='Backspace')&&!(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement)){e.preventDefault();onBack();}
  }}>
    {pane?<div className="row pane-tools"><button className="compact" aria-label={t('上一封')} title={t('上一封')} disabled={position<=0} onClick={()=>onOpen(neighbors[position-1])}><Icon name="arrow-up" sm/></button><button className="compact" aria-label={t('下一封')} title={t('下一封')} disabled={position<0||position>=neighbors.length-1} onClick={()=>onOpen(neighbors[position+1])}><Icon name="arrow-down" sm/></button><span className="spacer"/><button className="compact" aria-label={t('关闭阅读')} title={t('关闭阅读')} onClick={onBack}><Icon name="close" sm/></button></div>:
      <div className="row"><button aria-label={t('返回收件箱')} title={t('返回收件箱')} onClick={onBack}><Icon name="arrow-left" sm/>{t('返回收件箱')}</button><button className="compact" aria-label={t('上一封')} title={t('上一封')} disabled={position<=0} onClick={()=>onOpen(neighbors[position-1])}><Icon name="arrow-up" sm/></button><button className="compact" aria-label={t('下一封')} title={t('下一封')} disabled={position<0||position>=neighbors.length-1} onClick={()=>onOpen(neighbors[position+1])}><Icon name="arrow-down" sm/></button></div>}
    {!mail&&!error&&<State kind="syncing" detail={t('正在打开邮件…')}/>}
    {error&&<State kind="syncError" detail={`${error.code} · ${error.message}`} action={<button onClick={load}>{t('重试')}</button>}/>}
    {mail&&<><div className="meta"><span className={'avatar '+({['163']:'s163',qq:'sqq',gmail:'sgm',custom:'scustom'} as Record<string,string>)[account.provider]} aria-hidden="true">{(mail.from.name||mail.from.address||'?').trim()[0]?.toUpperCase()}</span>
      <div style={{minWidth:0,flex:1}}><div className="truncate" style={{fontWeight:700}}>{mail.from.name||mail.from.address}</div><p className="address truncate">{mail.from.address}</p></div><Source account={account}/></div>
      <h2 className="mail-title">{mail.subject}</h2>
      <p className="address">{t('发件人：')}{mail.from.name||''} &lt;{mail.from.address}&gt;</p><p className="address">{t('收件人：')}{mail.to.map(a=>a.address).join('，')}</p><p className="small">{new Date(mail.date).toLocaleString('zh-CN')}</p>
      <div className="row wrap"><button className="primary" disabled={busy} onClick={()=>showingTranslation?setShowingTranslation(false):void translate()}>{busy?t('翻译中…'):showingTranslation?t('查看原文'):t('翻译')}</button>{body&&<button disabled={busy} onClick={()=>translate({retry:true})}>{t('重新翻译')}</button>}
        {busy&&progress.total>0&&<span className="small" role="status" aria-label={t('翻译进度')}>{tFormat('{done}/{total}批',{done:progress.done,total:progress.total})}</span>}{busy&&<button onClick={()=>{cancelPending(ctx,'detail');setBusy(false);}}>{t('取消翻译')}</button>}
        <button disabled={busy||sending} onClick={()=>{setReplyOpen(value=>!value);setReplyError(undefined);}}>{replyOpen?t('取消回复'):t('回复')}</button>
        {read!==undefined&&<button onClick={()=>uiTask(ctx,()=>updateRead(!read),setError)}>{read?t('标为未读'):t('标为已读')}</button>}</div>
      {replyOpen&&<div className="card reply-form">
        <div className="row"><strong>{t('回复')}</strong><span className="small truncate">{mail.from.name?`${mail.from.name} <${mail.from.address}>`:mail.from.address}</span></div>
        <textarea value={replyBody} maxLength={20000} rows={6} autoFocus aria-label={t('回复内容')} placeholder={t('输入回复内容')} onChange={e=>setReplyBody(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setReplyOpen(false);}}}/>
        {replyError&&<State kind="syncError" detail={`${replyError.code} · ${replyError.message}`} action={<button className="compact" onClick={()=>setReplyError(undefined)}>{t('重试')}</button>}/>}
        <div className="row wrap"><button className="primary" disabled={sending||busy} onClick={()=>void sendReply()}>{sending?t('发送中…'):t('发送')}</button><button disabled={sending} onClick={()=>{setReplyOpen(false);setReplyBody('');setReplyError(undefined);}}>{t('取消')}</button></div>
      </div>}
      <label>{t('翻译目标')}<Language label={t('邮件翻译目标')} value={to} onChange={v=>{setTo(v);onTarget?.(v);setBody(cache.current.get(v));setShowingTranslation(false);setProgress({done:0,total:0});setTranslationError(undefined);}}/></label>
      {translationError&&<State kind="translateError" detail={`${translationError.code} · ${translationError.message}`} action={<button disabled={busy} onClick={()=>translate({retry:true})}>{t('重试')}</button>}/>}
      {showingTranslation&&translated?mail.html?<MailBodyFrame html={translatedDocument(translated)}/>:<div className="reader card" tabIndex={0} aria-label={t('译文正文')}>{translated}</div>
        :mail.html?<MailBodyFrame html={mail.html}/>:<div className="reader card" tabIndex={0} aria-label={t('可划词的邮件正文')}>{mail.text||t('这封邮件没有正文，可能只包含附件')}</div>}
      {body&&!body.complete&&!busy&&<div className="state"><Icon name="alert"/><div><strong>{t('翻译未完成')}</strong><button disabled={busy} onClick={()=>translate({continue:true})}>{t('继续翻译')}</button></div></div>}
      <h3>{tFormat('附件（{count}）',{count:mail.attachments.length})}</h3>
      {!mail.attachments.length&&<p className="small">{t('没有附件')}</p>}
      {mail.attachments.map(a=><article key={a.id} className="attachment">
        <Icon name="mail"/><div className="attachment-name"><strong className="truncate" title={a.filename}>{a.filename}</strong><p className="small">{(a.size/1024).toFixed(1)}KB · {a.blocked==='dangerous_type'?t('不安全类型'):a.blocked==='too_large'?t('超过附件上限'):a.mime}</p></div>
        <button disabled={!!a.blocked||!!downloading} aria-label={`${t('下载')} ${a.filename}`} onClick={()=>download(a.id)}>{downloading===a.id?t('下载中…'):t('下载')}</button>
      </article>)}
      {downloadProgress!==undefined&&<div role="status"><progress value={downloadProgress} max={100} aria-label={t('附件下载进度')}/>{downloadProgress}%{downloading&&<button onClick={()=>{downloadVersion.current++;cancelPending(ctx,'attachment');setDownloading('');setDownloadProgress(undefined);ctx.ui.notify(t('已取消下载'));}}>{t('取消下载')}</button>}</div>}
      {attachmentError&&<State kind="attachmentError" detail={`${attachmentError.code} · ${attachmentError.message}`} action={<button onClick={()=>download(lastDownload.current)}>重试</button>}/>}
    </>}
  </section>;
}

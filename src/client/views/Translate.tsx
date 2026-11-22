import {useState,useRef,useEffect} from 'react';
import type {ClientHost} from '../adapter/host';
import {call,readable,copyText,cancelPending} from '../rpc-client';
import {languages} from '../../shared/rpc-contract';
import {countText} from '../../shared/count';
import type {TranslationJob} from '../../shared/types';
import {State,Icon} from '../components/States';
import {Select} from '../components/Select';
import {t,tFormat} from '../i18n';
import {pickTranslationTarget} from '../../host/selection-overlay';
import {uuid} from '../uuid';
const languageLabels:Record<string,string>={auto:'自动检测',zh:'简体中文',en:'English',ja:'日本語',ko:'한국어',fr:'Français',de:'Deutsch',es:'Español',ru:'Русский'};
const providerLabels:Record<string,string>={baidu:'百度翻译',deepl:'DeepL 翻译',hostModel:'宿主模型',openai:'OpenAI 兼容'};
export function Language({value,onChange,auto=false,autoTarget=false,label,disabled=false}:{value:string;onChange:(s:string)=>void;auto?:boolean;autoTarget?:boolean;label:string;disabled?:boolean}){
  const options=[
    ...(autoTarget?[{value:'auto',label:t('自动（中↔英）')}]:[]),
    ...languages.filter(l=>auto||l!=='auto').map(l=>({value:l,label:languageLabels[l]})),
  ];
  return <Select label={label} value={value} disabled={disabled} options={options} onChange={onChange}/>;
}
export function Translate({ctx,fragment='',target='zh',onTarget,onSettings,selection=true,onSelection=()=>{},providers}:{ctx:ClientHost;fragment?:string;target?:string;onTarget:(s:string)=>void;onSettings:()=>void;selection?:boolean;onSelection?:(v:boolean)=>void;providers?:{id:string;configured:boolean}[]}){
  const [text,setText]=useState(''),[from,setFrom]=useState('auto'),[to,setTo]=useState(target&&target!=='zh'?target:'auto');
  const [provider,setProvider]=useState('');
  const [job,setJob]=useState<TranslationJob>(),[busy,setBusy]=useState(false),[error,setError]=useState<any>(),[inputRevision,setInputRevision]=useState(0);
  const output=useRef<HTMLDivElement>(null),active=useRef(true);
  const runId=useRef(0),autoTimer=useRef(0),composing=useRef(false);
  async function paste(){try{const clip=await navigator.clipboard.readText();if(active.current)setText(current=>current?`${current}\n${clip}`:clip);}catch{ctx.ui.notify(t('无法读取剪贴板'),'error');}}
  useEffect(()=>{active.current=true;return()=>{active.current=false;cancelPending(ctx,'translate');};},[]);
  useEffect(()=>{if(target&&target!=='zh'&&target!==to)setTo(target);},[target]);
  useEffect(()=>{if(fragment)setText(fragment);},[fragment]);
  useEffect(()=>{
    window.clearTimeout(autoTimer.current);
    runId.current++;cancelPending(ctx,'translate');
    setBusy(false);setError(undefined);
    if(!text.trim()||Array.from(text).length>5000){
      if(!text.trim())setJob(undefined);
      return;
    }
    if(composing.current)return;
    autoTimer.current=window.setTimeout(()=>{if(!composing.current)void execute(text);},900);
    return()=>window.clearTimeout(autoTimer.current);
  },[text,from,to,provider,inputRevision]);
  const counts=countText(text),translated=job?.result?.translated||'';
  async function execute(input=text,retry=false){
    if(!input.trim()||Array.from(input).length>5000)return;
    window.clearTimeout(autoTimer.current);
    const id=++runId.current;
    cancelPending(ctx,'translate');
    setBusy(true);setError(undefined);
    try{
      const resolvedTo=to==='auto'?pickTranslationTarget(input,'zh'):to;
      const same=!!job&&job.request.text===input&&job.request.from===from&&job.request.to===resolvedTo;
      const value=retry&&same?await call<TranslationJob>(ctx,'translate.retry',{jobId:job!.id,provider:provider||undefined,__owner:'translate'}):await call<TranslationJob>(ctx,'translate.run',{text:input,from,to:resolvedTo,provider:provider||undefined,retryNonce:retry?uuid():undefined,__owner:'translate'});
      if(active.current&&id===runId.current)setJob(value);
    }catch(e){if(active.current&&id===runId.current)setError(readable(e));}
    finally{if(active.current&&id===runId.current)setBusy(false);}
  }
  function swap(){
    const resolvedTo=to==='auto'?job?.request?.to||pickTranslationTarget(text,'zh'):to;
    const next=from==='auto'?job?.result?.detectedFrom||(resolvedTo==='zh'?'en':'zh'):from;
    setFrom(resolvedTo);setTo(next==='zh'?'auto':next);onTarget(next);
    if(translated){setText(translated);setJob(undefined);}
  }
  const targetLabel=job?.request?.to?languageLabels[job.request.to]||job.request.to:to==='auto'?t('自动（中↔英）'):languageLabels[to]||to;
  return <section className="translate-view" role="tabpanel" aria-label="翻译" onKeyDown={e=>{
    if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();void execute();}
    if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='s'){e.preventDefault();swap();}
    if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='c'&&output.current){e.preventDefault();void copyText(translated,output.current,ctx);}
  }}>
    <div className="translate-toolbar">
      <div className="langbar"><Language label={t('源语言')} value={from} onChange={setFrom} auto/><button className="swap" aria-label={t('交换源语言和目标语言')} title={t('交换源语言和目标语言')} onClick={swap}><Icon name="swap" sm/></button><Language label={t('目标语言')} value={to} onChange={v=>{setTo(v);onTarget(v==='auto'?'zh':v);}} autoTarget/></div>
      {providers&&<label className="translate-options"><span className="translate-option-label"><Icon name="translate" sm/><span>{t('翻译服务')}</span></span><Select label={t('翻译服务')} value={provider} onChange={setProvider} options={[
        {value:'',label:t('跟随设置')},
        ...providers.map(p=>({value:p.id,label:`${t(providerLabels[p.id]||p.id)}${!p.configured?` (${t('未配置')})`:''}`,disabled:!p.configured})),
      ]}/></label>}
    </div>
    {providers&&!providers.some(p=>p.configured)&&<div className="state warn"><Icon name="lock"/><div><strong>{t('尚未配置翻译服务')}</strong><p>{t('请选择宿主模型或配置一个翻译服务。')}</p><button className="compact" onClick={onSettings}>{t('去配置')}</button></div></div>}
    {from==='auto'&&job?.result?.detectedFrom&&<p className="small" role="status">{t('检测语言：')}{languageLabels[job.result.detectedFrom]||job.result.detectedFrom}</p>}
    <div className="translate-columns">
      <div className="translate-column">
        <div className="card">
          <div className="row"><span className="label">{t('原文')}</span><span className="count"><b>{counts.chars}</b>{tFormat(' / 5000 字',{})}</span></div>
          <textarea id="source-text" aria-label={t('原文')} value={text} placeholder={t('输入或粘贴要翻译的文字')} onChange={e=>setText(e.target.value)} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;setInputRevision(value=>value+1);}} onKeyDown={e=>{
            const composingNow=composing.current||e.nativeEvent.isComposing||e.keyCode===229;
            if(e.key==='Enter'&&!e.shiftKey&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&!composingNow){e.preventDefault();void execute();}
          }} style={{marginTop:4}}/>
          <div className="tools"><button className="compact" onClick={()=>{setText('');setJob(undefined);}}>{t('清空')}</button><button className="compact" onClick={()=>void paste()}>{t('粘贴')}</button><span className="spacer"/>
            <button className="compact switch-look" role="switch" aria-checked={selection} aria-label={t('划词翻译')} onClick={()=>{onSelection(!selection);void call(ctx,'settings.save',{selection:!selection}).catch(()=>{});}}><i/>{t('划词翻译')}</button>
          </div>
        </div>
      </div>
      <div className="translate-column">
        <div className="card output" aria-live="polite">
          <div className="row"><span className="label">{t('译文')} · {targetLabel}</span><span className="spacer"/></div>
          <div ref={output} className={'reader'+(translated?'':' reader-placeholder')} tabIndex={0} aria-label={t('译文内容')}>{translated||<><Icon name="translate"/><span>{t('译文会显示在这里')}</span></>}</div>
          <div className="tools"><button className="compact" disabled={!translated} onClick={()=>output.current&&copyText(translated,output.current,ctx)}>{t('复制')}</button><button className="compact" disabled={!job||busy} onClick={()=>execute(text,true)}>{t('重新翻译')}</button><span className="spacer"/>
            <span className="engine">{job?.cached&&<span className="tag">{t('缓存')}</span>}{job?.result&&t(providerLabels[job.result.provider]||job.result.provider)}</span>
          </div>
        </div>
      </div>
    </div>
    {counts.chars>5000&&<div role="alert" className="state bad"><Icon name="alert"/><div><strong>{t('超出 5000 字，请删减后翻译')}</strong></div></div>}
    {busy&&<State kind="translating"/>}
    {error&&<State kind={error.code==='AUTH_FAILED'||error.category==='configuration'?'missingKey':'translateError'} detail={`${error.code} · ${error.message}`} action={<button onClick={()=>error.code==='AUTH_FAILED'||error.category==='configuration'?onSettings():execute()}>{error.code==='AUTH_FAILED'||error.category==='configuration'?t('去设置'):t('重试')}</button>}/>}
    <span className="sr-only" role="status">{busy?t('正在翻译'):job?t('翻译完成'):''}</span>
  </section>;
}

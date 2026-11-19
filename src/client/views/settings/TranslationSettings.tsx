import {useEffect,useState} from 'react';
import type {ClientHost} from '../../adapter/host';
import type {Bootstrap} from '../../../shared/rpc-contract';
import {call,readable,uiTask} from '../../rpc-client';
import {Icon} from '../../components/States';
import {t,tFormat} from '../../i18n';
function parseGlossary(text:string){
  return text.split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#')).map(line=>{
    const parts=line.split(/\s*=>?\s*/);return parts.length>=2?{source:parts[0],target:parts.slice(1).join(' => ')}:undefined;
  }).filter(Boolean) as {source:string;target:string}[];
}
const openaiPresets=[
  {id:'openai',label:'OpenAI',baseUrl:'https://api.openai.com/v1',model:'gpt-4o-mini'},
  {id:'deepseek',label:'DeepSeek',baseUrl:'https://api.deepseek.com/v1',model:'deepseek-chat'},
  {id:'qwen',label:'通义千问',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen-plus'},
  {id:'kimi',label:'Kimi',baseUrl:'https://api.moonshot.cn/v1',model:'moonshot-v1-8k'},
  {id:'ark',label:'火山方舟',baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:''},
  {id:'siliconflow',label:'硅基流动',baseUrl:'https://api.siliconflow.cn/v1',model:'deepseek-ai/DeepSeek-V3'},
  {id:'ollama',label:'本地 Ollama',baseUrl:'http://127.0.0.1:11434/v1',model:'llama3.1'}
] as const;
export function TranslationSettings({ctx,data,refresh,onSelection}:{ctx:ClientHost;data:Bootstrap;refresh:()=>Promise<void>;onSelection:(v:boolean)=>void}){
  const [provider,setProvider]=useState('hostModel'),[appid,setAppid]=useState(''),[secret,setSecret]=useState(''),[configured,setConfigured]=useState(false),[model,setModel]=useState('');
  const [openaiBaseUrl,setOpenaiBaseUrl]=useState(''),[openaiApiKey,setOpenaiApiKey]=useState(''),[openaiModel,setOpenaiModel]=useState(''),[openaiConfigured,setOpenaiConfigured]=useState(false),[glossaryText,setGlossaryText]=useState('');
  const [presetId,setPresetId]=useState('');
  const [deeplApiKey,setDeeplApiKey]=useState(''),[deeplConfigured,setDeeplConfigured]=useState(false),[testResult,setTestResult]=useState<any>();
  const [selection,setSelection]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState<any>(),[logLevel,setLogLevel]=useState('info');
  useEffect(()=>{let active=true;call(ctx,'settings.get').then(v=>{if(!active)return;const supported=['baidu','deepl','hostModel','openai'];
    setProvider(supported.includes(v.provider)?v.provider:'hostModel');setAppid(v.appid||'');setConfigured(v.configured);setModel(v.model||'');
    setOpenaiBaseUrl(v.openaiBaseUrl||'');setOpenaiModel(v.openaiModel||'');setOpenaiConfigured(v.openaiConfigured);setDeeplConfigured(!!v.deeplConfigured);
    setGlossaryText((v.glossary||[]).map((g:any)=>`${g.source} = ${g.target}`).join('\n'));setSelection(v.selection!==false);setLogLevel(v.logLevel||'info');
  }).catch(e=>{if(active)setError(readable(e));});return()=>{active=false;};},[]);
  async function persist(){
    await call(ctx,'settings.save',{provider,appid,secret,model,openaiBaseUrl,openaiApiKey,openaiModel,deeplApiKey,glossary:parseGlossary(glossaryText),selection,logLevel});
    setConfigured(configured||!!secret);setOpenaiConfigured(openaiConfigured||!!openaiApiKey);setDeeplConfigured(deeplConfigured||!!deeplApiKey);onSelection(selection);
  }
  async function task(fn:()=>Promise<unknown>){
    setBusy(true);setError(undefined);
    try{await fn();await refresh();}catch(e){setError(readable(e));}finally{setBusy(false);}
  }
  async function saveSettings(){await task(async()=>{await persist();setSecret('');setOpenaiApiKey('');setDeeplApiKey('');ctx.ui.notify(t('设置已保存'),'success');});}
  async function testConnection(){setBusy(true);setError(undefined);setTestResult(undefined);try{await persist();setTestResult(await call(ctx,'translate.test',{provider}));await refresh();setSecret('');setOpenaiApiKey('');setDeeplApiKey('');}catch(e){setError(readable(e));}finally{setBusy(false);}}
  return <section className="settings-section" aria-label={t('翻译设置')}>
    <div className="section-heading"><h2>{t('翻译设置')}</h2></div>
    <div role="form" aria-label={t('翻译设置')} className="card settings-form" onKeyDown={e=>{
      if(e.key==='Enter'&&(e.target as HTMLElement).tagName==='INPUT'){e.preventDefault();void saveSettings();}
    }}>
      <div className="form-grid">
        <label className="span-2">{t('翻译供应商')}<select value={provider} onChange={e=>{setProvider(e.target.value);setTestResult(undefined);}}><option value="hostModel">{t('宿主模型')}</option><option value="baidu">{t('百度翻译')}</option><option value="deepl">{t('DeepL 翻译')}</option><option value="openai">{t('OpenAI 兼容服务')}</option></select></label>
        {provider==='baidu'&&<><label>APPID<input value={appid} onChange={e=>setAppid(e.target.value)} autoComplete="off"/></label>
          <label>{t('百度密钥')}<input type="password" value={secret} placeholder={configured?t('已保存；留空保持原密钥'):t('填写应用密钥')} onChange={e=>setSecret(e.target.value)} autoComplete="new-password"/></label></>}
        {provider==='hostModel'&&<><label>{t('模型 ID')}<input value={model} placeholder={t('留空自动选择宿主默认模型')} onChange={e=>setModel(e.target.value)}/></label>
          {ctx.ui.selectModel&&<div className="field-action"><button type="button" onClick={()=>uiTask(ctx,async()=>{const selected=await ctx.ui.selectModel!();if(selected)setModel(selected.model);},setError)}>{t('选择宿主模型')}</button></div>}</>}
        {provider==='openai'&&<><label className="span-2">{t('接口地址')}<input value={openaiBaseUrl} onChange={e=>{setPresetId('');setOpenaiBaseUrl(e.target.value);}} placeholder="https://api.openai.com/v1" autoComplete="off"/></label>
          <label className="span-2">{t('快速填入服务')}<select value={presetId} onChange={e=>{setPresetId(e.target.value);const preset=openaiPresets.find(item=>item.id===e.target.value);if(preset){setOpenaiBaseUrl(preset.baseUrl);setOpenaiModel(preset.model);}}}><option value="">{t('选择常用服务')}</option>{openaiPresets.map(item=><option key={item.id} value={item.id}>{item.label}{item.model?` · ${item.model}`:''}</option>)}</select></label>
          <label>{t('API Key')}<input type="password" value={openaiApiKey} placeholder={openaiConfigured?t('已保存；留空保持原密钥'):t('填写 API Key（本地服务可留空）')} onChange={e=>setOpenaiApiKey(e.target.value)} autoComplete="new-password"/></label>
          <label>{t('模型 ID')}<input value={openaiModel} onChange={e=>{setPresetId('');setOpenaiModel(e.target.value);}} placeholder="gpt-4o-mini / deepseek-chat"/></label></>}
        {provider==='deepl'&&<label className="span-2">{t('DeepL API Key')}<input type="password" value={deeplApiKey} placeholder={deeplConfigured?t('已保存；留空保持原密钥'):t('填写 DeepL API Key')} onChange={e=>setDeeplApiKey(e.target.value)} autoComplete="new-password"/></label>}
        <label className="span-2">{t('术语表（每行：原文 = 译文）')}<textarea rows={4} value={glossaryText} onChange={e=>setGlossaryText(e.target.value)} placeholder={t('示例：API = 接口\nAgent = 智能体')}/></label>
      </div>
      <label className="row"><input className="checkbox" type="checkbox" checked={selection} onChange={e=>setSelection(e.target.checked)}/>{t('划词翻译（面板与 Studio 对话页）')}</label>
      <p className="hint">{t('在 Studio 对话页选中文字，译文会直接出现在划词浮条中。')}</p>
      <label>{t('诊断日志级别')}<select value={logLevel} onChange={e=>setLogLevel(e.target.value)}><option value="info">{t('正常（成功与失败）')}</option><option value="warn">{t('仅警告与错误')}</option><option value="error">{t('仅错误')}</option><option value="off">{t('关闭')}</option></select></label>
      <div className="row wrap"><button type="button" className="primary" disabled={busy} onClick={()=>void saveSettings()}>{t('保存设置')}</button><button type="button" disabled={busy} onClick={()=>void testConnection()}>{busy?t('请稍候…'):t('测试连接')}</button></div>
      {testResult&&<p className={testResult.ok?'state':'state bad'} role="status"><Icon name={testResult.ok?'check':'alert'}/><span>{testResult.ok?tFormat('连接成功 · {ms}ms · 示例：{sample}',{ms:testResult.latencyMs,sample:testResult.sample||''}):testResult.configured?`${testResult.error?.code} · ${testResult.error?.message}`:t('尚未配置该服务')}</span></p>}
      {error&&<p className="state bad" role="alert"><Icon name="alert"/><span>{error.code} · {error.message}</span></p>}
    </div>
  </section>;
}

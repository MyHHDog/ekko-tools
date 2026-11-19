import {useEffect,useState} from 'react';
import type {ClientHost} from '../../adapter/host';
import type {Bootstrap} from '../../../shared/rpc-contract';
import {call,readable,uiTask} from '../../rpc-client';
import {Icon} from '../../components/States';
import {t,tFormat} from '../../i18n';
function formatBytes(bytes:number){return bytes<1024?`${bytes} B`:`${(bytes/1024).toFixed(1)} KB`;}
export function SystemSettings({ctx,data}:{ctx:ClientHost;data:Bootstrap}){
  const [cache,setCache]=useState<any>(),[busy,setBusy]=useState(false),[error,setError]=useState<any>();
  useEffect(()=>{let active=true;call(ctx,'translate.cache-stats').then(v=>{if(active)setCache(v);}).catch(()=>{});return()=>{active=false;};},[]);
  async function action(kind:'stats'|'clear'){
    setBusy(true);setError(undefined);
    try{setCache(await call(ctx,kind==='clear'?'translate.cache-clear':'translate.cache-stats'));if(kind==='clear')ctx.ui.notify(t('缓存已清理'),'success');}
    catch(e){setError(readable(e));}finally{setBusy(false);}
  }
  return <section className="settings-section" aria-label={t('数据与诊断')}>
    <div className="section-heading"><h2>{t('翻译缓存')}</h2></div>
    <div className="card settings-form">
      <p className="small">{tFormat('{entries} 条 · {size}',{entries:cache?.entries||0,size:formatBytes(cache?.bytes||0)})}</p>
      <div className="row wrap"><button disabled={busy||!cache?.entries} onClick={()=>void action('clear')}>{t('清除缓存')}</button>
        <button disabled={busy} onClick={()=>void action('stats')}>{t('刷新统计')}</button></div>
      <p className="small">{t('缓存仅保存在当前用户与 Profile 的服务端分区，7 天后过期，最多 100 条/512KB。')}</p>
    </div>
    <div className="section-heading"><h2>{t('诊断')}</h2></div>
    <div className="card settings-form">
      <div className="row wrap"><button onClick={()=>uiTask(ctx,async()=>{const content=await call(ctx,'app.diagnostics');const blob=new Blob([JSON.stringify(content,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='ekko-tools-diagnostics.json';a.click();URL.revokeObjectURL(url);},setError)}>{t('导出诊断')}</button></div>
      {data.vaultWarning&&<p className="state"><Icon name="lock"/>{t('建议在宿主插件配置中设置 vaultPassphrase。未设置时使用本机随机密钥文件。')}</p>}
      {error&&<p className="state bad" role="alert"><Icon name="alert"/><span>{error.code} · {error.message}</span></p>}
    </div>
  </section>;
}

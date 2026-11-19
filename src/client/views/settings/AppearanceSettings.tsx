import {useEffect,useRef,useState} from 'react';
import type {ClientHost} from '../../adapter/host';
import {readable} from '../../rpc-client';
import {Icon} from '../../components/States';
import {t} from '../../i18n';
import {
  appearanceDefaults,appearanceFonts,applyAppearance,loadAppearance,
  removeAppearanceBackground,resetAppearance,saveAppearance,uploadAppearanceBackground
} from '../../appearance';
import type {AppearanceFont,AppearanceSettings} from '../../appearance';
const fontLabels:Record<AppearanceFont,string>={
  comic:'Comic',system:'系统',serif:'宋体',mono:'等宽'
};
function RangeRow({label,value,min,max,step=1,unit='px',disabled,onChange}:{
  label:string;value:number;min:number;max:number;step?:number;unit?:string;disabled?:boolean;
  onChange:(value:number)=>void;
}){
  return <label className="appearance-range">
    <span>{t(label)}<output>{value}{unit}</output></span>
    <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
      onChange={event=>onChange(Number(event.target.value))}/>
  </label>;
}
export function AppearanceSettings({ctx}:{ctx:ClientHost}){
  const [draft,setDraft]=useState<AppearanceSettings>(appearanceDefaults);
  const [background,setBackground]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<any>();
  const [saved,setSaved]=useState(false);
  const fileRef=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    let active=true;
    loadAppearance(ctx).then(result=>{
      if(!active)return;
      setDraft(result.settings);setBackground(result.backgroundUrl);
    }).catch(e=>{if(active)setError(readable(e));});
    return()=>{active=false;};
  },[]);
  function change(next:Partial<AppearanceSettings>){
    const value={...draft,...next};
    setDraft(value);setSaved(false);applyAppearance(value,background);
  }
  async function save(){
    setBusy(true);setError(undefined);setSaved(false);
    try{
      const settings=await saveAppearance(ctx,draft);
      setDraft(settings);setSaved(true);ctx.ui.notify(t('外观设置已保存'),'success');
    }catch(e){setError(readable(e));}finally{setBusy(false);}
  }
  async function pick(file:File|undefined){
    if(!file)return;
    setBusy(true);setError(undefined);setSaved(false);
    try{
      const result=await uploadAppearanceBackground(ctx,file);
      setBackground(result.url);setDraft(value=>({...value,backgroundName:result.name}));
      ctx.ui.notify(t('背景已更新'),'success');
    }catch(e){setError(readable(e));}finally{setBusy(false);}
  }
  async function clearBackground(){
    setBusy(true);setError(undefined);
    try{
      await removeAppearanceBackground(ctx);setBackground('');
      setDraft(value=>({...value,backgroundName:''}));ctx.ui.notify(t('背景已移除'),'success');
    }catch(e){setError(readable(e));}finally{setBusy(false);}
  }
  async function reset(){
    setBusy(true);setError(undefined);setSaved(false);
    try{
      const settings=await resetAppearance(ctx);setDraft(settings);setBackground('');
      ctx.ui.notify(t('已恢复默认外观'),'success');
    }catch(e){setError(readable(e));}finally{setBusy(false);}
  }
  const custom=!draft.followStudio;
  return <section className="settings-section appearance-section" aria-label={t('外观')}>
    <div className="section-heading">
      <div><h2>{t('外观')}</h2><p className="small">{t('背景、字体与界面密度会即时预览，保存后长期生效。')}</p></div>
    </div>
    <div className="card settings-form appearance-background-card">
      <div className="appearance-card-head">
        <div><strong>{t('背景图片')}</strong><small>{t('支持 JPG、PNG、WebP，原图保存，最大 20MB。')}</small></div>
        <span className="appearance-file">{draft.backgroundName||t('使用内置主题图')}</span>
      </div>
      <div className="appearance-backdrop" style={{backgroundImage:background?`url("${background}")`:'var(--ek-theme-bg-image)'}}>
        <span className="appearance-preview-label">{t('预览')}</span>
      </div>
      <div className="row wrap">
        <button type="button" onClick={()=>fileRef.current?.click()} disabled={busy}>
          <Icon name="upload" sm/>{t('上传背景')}
        </button>
        {background&&<button type="button" onClick={()=>void clearBackground()} disabled={busy}>
          <Icon name="trash" sm/>{t('移除背景')}
        </button>}
        <input ref={fileRef} className="appearance-file-input" type="file" accept="image/png,image/jpeg,image/webp"
          onChange={event=>{void pick(event.target.files?.[0]);event.currentTarget.value='';}}/>
      </div>
    </div>
    <div className="card settings-form appearance-controls">
      <label className="appearance-toggle">
        <span><strong>{t('跟随 Ekko Studio')}</strong><small>{t('字体、字号和控件几何跟随宿主主题。')}</small></span>
        <input type="checkbox" checked={draft.followStudio} onChange={event=>change({followStudio:event.target.checked})}/>
        <i aria-hidden="true"/>
      </label>
      <fieldset className={custom?'appearance-fieldset':'appearance-fieldset is-disabled'} disabled={!custom}>
        <legend>{t('字体与布局')}</legend>
        <div className="appearance-fonts" role="group" aria-label={t('字体')}>
          {appearanceFonts.map(font=><button key={font} type="button" aria-pressed={draft.font===font}
            className={`appearance-font font-${font}`} onClick={()=>change({font})}>{t(fontLabels[font])}</button>)}
        </div>
        <div className="appearance-grid">
          <RangeRow label="字号" value={draft.fontSize} min={12} max={20} onChange={fontSize=>change({fontSize})}/>
          <RangeRow label="圆角" value={draft.radius} min={0} max={32} onChange={radius=>change({radius})}/>
          <RangeRow label="控件高度" value={draft.controlHeight} min={30} max={56} onChange={controlHeight=>change({controlHeight})}/>
          <RangeRow label="边框粗细" value={draft.borderWidth} min={1} max={4} step={0.5} onChange={borderWidth=>change({borderWidth})}/>
          <RangeRow label="间距比例" value={draft.spacing} min={0.8} max={1.6} step={0.05} unit="×" onChange={spacing=>change({spacing})}/>
          <RangeRow label="字间距" value={draft.letterSpacing} min={-1.5} max={1.5} step={0.1} onChange={letterSpacing=>change({letterSpacing})}/>
        </div>
      </fieldset>
      <div className="appearance-color-row">
        <label className="appearance-color">
          <span><strong>{t('强调色')}</strong><small>{settingsAccentText(draft.accent)}</small></span>
          <input type="color" value={draft.accent} onChange={event=>change({accent:event.target.value})}/>
        </label>
        <RangeRow label="背景压暗" value={draft.overlay} min={0} max={0.85} step={0.05} unit="" onChange={overlay=>change({overlay})}/>
        <RangeRow label="背景模糊" value={draft.blur} min={0} max={24} onChange={blur=>change({blur})}/>
      </div>
      {error&&<p className="state bad" role="alert"><Icon name="alert"/><span>{error.code} · {error.message}</span></p>}
      {saved&&<p className="state" role="status"><Icon name="check"/><span>{t('外观设置已保存')}</span></p>}
      <div className="row wrap appearance-actions">
        <button type="button" className="primary" disabled={busy} onClick={()=>void save()}>
          {busy?t('正在保存…'):t('保存外观')}
        </button>
        <button type="button" disabled={busy} onClick={()=>void reset()}>{t('恢复默认')}</button>
      </div>
    </div>
  </section>;
}
function settingsAccentText(accent:string){
  return accent.toUpperCase();
}

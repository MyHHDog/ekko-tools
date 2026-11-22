import {useEffect,useRef,useState} from 'react';
import type {ClientHost} from '../../adapter/host';
import {readable} from '../../rpc-client';
import {Icon} from '../../components/States';
import {Select} from '../../components/Select';
import {t} from '../../i18n';
import {uuid} from '../../uuid';
import {
  appearanceDefaults,appearanceFonts,appearancePalettes,appearanceRegionDefaults,appearanceRegions,
  applyAppearance,currentAppearance,currentBackgrounds,loadAppearance,removeAppearanceBackground,
  resetAppearance,saveAppearance,uploadAppearanceBackground
} from '../../appearance';
import type {
  AppearanceBackgroundPosition,AppearanceBackgroundSize,AppearanceFont,AppearanceRegion,
  AppearanceSettings,AppearanceSurface,BackgroundSlot,BackgroundUrls
} from '../../appearance';
type Scope='global'|AppearanceRegion;
type NumberKey='fontSize'|'lineHeight'|'radius'|'controlHeight'|'borderWidth'|'spacing'|
  'letterSpacing'|'shadow'|'contentWidth'|'gradientAngle'|'overlay'|'blur';
type ColorKey='pageColor'|'surfaceColor'|'textColor'|'secondaryTextColor'|'mutedTextColor'|
  'borderColor'|'linkColor'|'accent';
const fontLabels:Record<AppearanceFont,string>={
  comic:'Comic',system:'系统',serif:'宋体',mono:'等宽'
};
const regionLabels:Record<AppearanceRegion,string>={
  chrome:'框架',sidebar:'侧栏',content:'内容区',card:'卡片',input:'输入框',overlay:'浮层'
};
const globalRanges:{key:NumberKey;label:string;min:number;max:number;step:number;unit:string}[]=[
  {key:'fontSize',label:'字号',min:12,max:20,step:1,unit:'px'},
  {key:'lineHeight',label:'行高',min:1,max:2.4,step:.05,unit:''},
  {key:'radius',label:'圆角',min:0,max:32,step:1,unit:'px'},
  {key:'controlHeight',label:'控件高度',min:30,max:56,step:1,unit:'px'},
  {key:'borderWidth',label:'边框粗细',min:1,max:4,step:.5,unit:'px'},
  {key:'spacing',label:'间距比例',min:.8,max:1.6,step:.05,unit:'×'},
  {key:'letterSpacing',label:'字间距',min:-1.5,max:1.5,step:.1,unit:'px'},
  {key:'shadow',label:'阴影强度',min:0,max:2,step:.05,unit:''},
  {key:'contentWidth',label:'正文宽度',min:480,max:1600,step:20,unit:'px'},
  {key:'gradientAngle',label:'渐变角度',min:0,max:360,step:1,unit:'°'},
  {key:'overlay',label:'背景压暗',min:0,max:.85,step:.05,unit:''},
  {key:'blur',label:'背景模糊',min:0,max:24,step:1,unit:'px'}
];
const globalColors:{key:ColorKey;label:string}[]=[
  {key:'pageColor',label:'页面颜色'},{key:'surfaceColor',label:'表面颜色'},
  {key:'textColor',label:'正文颜色'},{key:'secondaryTextColor',label:'次要文字颜色'},
  {key:'mutedTextColor',label:'弱化文字颜色'},{key:'borderColor',label:'边框颜色'},
  {key:'linkColor',label:'链接颜色'},{key:'accent',label:'强调色'}
];
const backgroundSizeOptions:{value:AppearanceBackgroundSize;label:string}[]=[
  {value:'cover',label:'铺满'},{value:'contain',label:'完整显示'},{value:'auto',label:'原始尺寸'}
];
const backgroundPositionOptions:{value:AppearanceBackgroundPosition;label:string}[]=[
  {value:'center',label:'居中'},{value:'top',label:'顶部'},{value:'bottom',label:'底部'},
  {value:'left',label:'左侧'},{value:'right',label:'右侧'}
];
function formatValue(value:number,unit:string){
  const text=Number.isInteger(value)?String(value):String(Number(value.toFixed(2)));
  return `${text}${unit}`;
}
function RangeSetting({id,label,value,min,max,step,unit,inherited,onChange,onReset}:{
  id:string;label:string;value:number;min:number;max:number;step:number;unit:string;
  inherited?:boolean;onChange:(value:number)=>void;onReset?:()=>void;
}){
  return <div className="appearance-setting">
    <div className="appearance-setting-head">
      <label htmlFor={id}>{t(label)}</label>
      {inherited&&<em>{t('继承')}</em>}
    </div>
    <div className="appearance-setting-control">
      <input id={id} type="range" min={min} max={max} step={step} value={value}
        onChange={event=>onChange(Number(event.target.value))}/>
      <output htmlFor={id}>{formatValue(value,unit)}</output>
      {onReset&&<button type="button" className="appearance-reset" onClick={onReset}>{t('重置')}</button>}
    </div>
  </div>;
}
function ColorSetting({id,label,value,inherited,onChange,onReset}:{
  id:string;label:string;value:string;inherited?:boolean;
  onChange:(value:string)=>void;onReset?:()=>void;
}){
  return <div className="appearance-setting">
    <div className="appearance-setting-head">
      <label htmlFor={id}>{t(label)}</label>
      {inherited&&<em>{t('继承')}</em>}
    </div>
    <div className="appearance-setting-control">
      <input id={id} type="color" value={value} onChange={event=>onChange(event.target.value)}/>
      <span className="appearance-hex">{value.toUpperCase()}</span>
      {onReset&&<button type="button" className="appearance-reset" onClick={onReset}>{t('重置')}</button>}
    </div>
  </div>;
}
function SelectSetting({id,label,value,options,onChange}:{
  id:string;label:string;value:string;options:{value:string;label:string}[];
  onChange:(value:string)=>void;
}){
  return <div className="appearance-setting">
    <div className="appearance-setting-head"><label htmlFor={id}>{t(label)}</label></div>
    <Select id={id} label={t(label)} value={value} onChange={onChange}
      options={options.map(option=>({value:option.value,label:t(option.label)}))}/>
  </div>;
}
function BackgroundCard({slot,fileName,url,fallbackUrl,busy,uploading,onPick,onClear}:{
  slot:BackgroundSlot;fileName:string;url:string;fallbackUrl?:string;busy:boolean;uploading:boolean;
  onPick:(file:File|undefined)=>void;onClear:()=>void;
}){
  const fileRef=useRef<HTMLInputElement>(null);
  const mobile=slot==='mobile';
  const preview=url||fallbackUrl||'';
  return <div className="card settings-form appearance-background-card">
    <div className="appearance-card-head">
      <div><strong>{t(mobile?'移动端背景':'Web 端背景')}</strong>
        <small>{t(mobile?'未上传时沿用 Web 端背景。':'用于桌面浏览器和宽屏窗口。')}</small></div>
      <span className="appearance-file">{fileName||t(mobile&&fallbackUrl?'未设置 · 回退 Web 背景':'跟随 Studio 中性背景')}</span>
    </div>
    <div className={'appearance-backdrop'+(mobile?' appearance-backdrop-mobile':'')}
      data-custom-preview={preview?true:undefined}
      style={{backgroundImage:preview?`url("${preview}")`:undefined}}>
      <span className="appearance-preview-label">{t('预览')}</span>
    </div>
    <div className="row wrap">
      <button type="button" onClick={()=>fileRef.current?.click()} disabled={busy}>
        <Icon name="upload" sm/>{t(uploading?'正在上传…':'上传背景')}
      </button>
      {url&&<button type="button" onClick={onClear} disabled={busy}>
        <Icon name="trash" sm/>{t('移除背景')}
      </button>}
      <input ref={fileRef} className="appearance-file-input" type="file" accept="image/png,image/jpeg,image/webp"
        onChange={event=>{onPick(event.target.files?.[0]);event.currentTarget.value='';}}/>
    </div>
  </div>;
}
export function AppearanceSettings({ctx}:{ctx:ClientHost}){
  const [draft,setDraft]=useState<AppearanceSettings>(()=>currentAppearance());
  const [backgrounds,setBackgrounds]=useState<BackgroundUrls>(()=>currentBackgrounds());
  const [operation,setOperation]=useState<'save'|'reset'|'clear'|BackgroundSlot>();
  const busy=operation!==undefined;
  const [error,setError]=useState<ReturnType<typeof readable>&{diagnosticId?:string}>();
  const [saved,setSaved]=useState(false);
  const [scope,setScope]=useState<Scope>('global');
  useEffect(()=>{
    let active=true;
    loadAppearance(ctx).then(result=>{
      if(!active)return;
      setDraft(result.settings);setBackgrounds(result.backgrounds);
    }).catch(e=>{if(active)setError(readable(e));});
    return()=>{active=false;};
  },[]);
  function change(next:Partial<AppearanceSettings>){
    const customizing=Object.keys(next).some(key=>key!=='followStudio');
    const value={...draft,...next};
    if(customizing)value.followStudio=false;
    setDraft(value);setSaved(false);applyAppearance(value,backgrounds);
  }
  function setScheme(colorScheme:'light'|'dark'){
    const oldPalette=appearancePalettes[draft.colorScheme],nextPalette=appearancePalettes[colorScheme];
    const next:Partial<AppearanceSettings>={colorScheme};
    for(const [key,value] of Object.entries(oldPalette)){
      if(draft[key as keyof typeof oldPalette]===value)(next as Record<string,unknown>)[key]=nextPalette[key as keyof typeof oldPalette];
    }
    change(next);
  }
  function updateRegion(region:AppearanceRegion,patch:AppearanceSurface){
    const nextRegion={...(draft.regions[region]||{}),...patch};
    for(const key of Object.keys(nextRegion) as (keyof AppearanceSurface)[]){
      if(nextRegion[key]===undefined)delete nextRegion[key];
    }
    const regions={...draft.regions};
    if(Object.keys(nextRegion).length)regions[region]=nextRegion;else delete regions[region];
    change({regions});
  }
  function clearRegion(region:AppearanceRegion){
    const regions={...draft.regions};delete regions[region];change({regions});
  }
  async function save(){
    const diagnosticId=`as-${uuid().replace(/-/g,'').slice(0,12)}`;
    setOperation('save');setError(undefined);setSaved(false);
    try{
      const settings=await saveAppearance(ctx,draft,diagnosticId);
      setDraft(settings);setSaved(true);ctx.ui.notify(t('外观设置已保存'),'success');
    }catch(e){setError({...readable(e),diagnosticId});}finally{setOperation(undefined);}
  }
  async function pick(file:File|undefined,slot:BackgroundSlot){
    if(!file)return;
    setOperation(slot);setError(undefined);setSaved(false);
    try{
      const result=await uploadAppearanceBackground(ctx,file,slot,
        url=>setBackgrounds(value=>({...value,[slot]:url})));
      setBackgrounds(value=>({...value,[slot]:result.url}));
      const nameKey=slot==='mobile'?'backgroundMobileName':'backgroundName';
      setDraft(value=>({...value,[nameKey]:result.name}));
      ctx.ui.notify(t('背景已更新'),'success');
    }catch(e){
      const failure=readable(e);
      setBackgrounds(currentBackgrounds());setDraft(currentAppearance());setError(failure);
      ctx.ui.notify(failure.message,'error');
    }finally{setOperation(undefined);}
  }
  async function clearBackground(slot:BackgroundSlot){
    setOperation('clear');setError(undefined);
    try{
      await removeAppearanceBackground(ctx,slot);
      setBackgrounds(value=>({...value,[slot]:''}));
      const nameKey=slot==='mobile'?'backgroundMobileName':'backgroundName';
      setDraft(value=>({...value,[nameKey]:''}));ctx.ui.notify(t('背景已移除'),'success');
    }catch(e){setError(readable(e));}finally{setOperation(undefined);}
  }
  async function reset(){
    setOperation('reset');setError(undefined);setSaved(false);
    try{
      const settings=await resetAppearance(ctx);setDraft(settings);setBackgrounds({desktop:'',mobile:''});
      ctx.ui.notify(t('已恢复默认外观'),'success');
    }catch(e){setError(readable(e));}finally{setOperation(undefined);}
  }
  function renderGlobal(){
    const palette=appearancePalettes[draft.colorScheme];
    return <>
      <div className="appearance-subhead"><strong>{t('主题与字体')}</strong><small>{t('切换明暗模式时会同步替换仍在使用默认值的颜色。')}</small></div>
      <div className="appearance-segment" role="group" aria-label={t('明暗模式')}>
        {(['light','dark'] as const).map(mode=><button key={mode} type="button"
          aria-pressed={draft.colorScheme===mode} onClick={()=>setScheme(mode)}>{t(mode==='light'?'浅色':'深色')}</button>)}
      </div>
      <div className="appearance-fonts" role="group" aria-label={t('字体')}>
        {appearanceFonts.map(font=><button key={font} type="button" aria-pressed={draft.font===font}
          className={`appearance-font font-${font}`} onClick={()=>change({font})}>{t(fontLabels[font])}</button>)}
      </div>
      <div className="appearance-subhead"><strong>{t('颜色')}</strong><small>{t('页面、表面、正文与控件颜色。')}</small></div>
      <div className="appearance-settings-grid">
        {globalColors.map(item=><ColorSetting key={item.key} id={`ek-color-${item.key}`} label={item.label}
          value={draft[item.key]} onChange={value=>change({[item.key]:value} as Partial<AppearanceSettings>)}
          onReset={draft[item.key]!==palette[item.key]?()=>change({[item.key]:palette[item.key]} as Partial<AppearanceSettings>):undefined}/>)}
      </div>
      <div className="appearance-subhead"><strong>{t('尺寸与排版')}</strong><small>{t('调整立即预览；重置回到 Studio 默认值。')}</small></div>
      <div className="appearance-settings-grid">
        {globalRanges.map(item=><RangeSetting key={item.key} id={`ek-range-${item.key}`} label={item.label}
          value={draft[item.key]} min={item.min} max={item.max} step={item.step} unit={item.unit}
          onChange={value=>change({[item.key]:value} as Partial<AppearanceSettings>)}
          onReset={draft[item.key]!==appearanceDefaults[item.key]
            ?()=>change({[item.key]:appearanceDefaults[item.key]} as Partial<AppearanceSettings>):undefined}/>)}
        <RangeSetting id="ek-range-opacity" label="全局不透明度" value={draft.opacity??0.72} min={0} max={1} step={0.01} unit=""
          inherited={draft.opacity===undefined} onChange={opacity=>change({opacity})}
          onReset={draft.opacity!==undefined?()=>change({opacity:undefined}):undefined}/>
      </div>
      <div className="appearance-subhead"><strong>{t('背景')}</strong><small>{t('背景图或渐变会透过各区域玻璃层显示。')}</small></div>
      <div className="appearance-settings-grid">
        <SelectSetting id="ek-background-size" label="背景显示方式" value={draft.backgroundSize}
          options={backgroundSizeOptions} onChange={value=>change({backgroundSize:value as AppearanceBackgroundSize})}/>
        <SelectSetting id="ek-background-position" label="背景位置" value={draft.backgroundPosition}
          options={backgroundPositionOptions} onChange={value=>change({backgroundPosition:value as AppearanceBackgroundPosition})}/>
        <ColorSetting id="ek-gradient-color" label="渐变终点颜色" value={draft.gradientColor??draft.pageColor}
          inherited={!draft.gradientColor} onChange={gradientColor=>change({gradientColor})}
          onReset={draft.gradientColor?()=>change({gradientColor:undefined}):undefined}/>
      </div>
    </>;
  }
  function renderRegion(){
    if(!region)return null;
    const values=draft.regions[region]||{};
    const defaults=appearanceRegionDefaults[region];
    const defaultColor=region==='chrome'?draft.pageColor:draft.surfaceColor;
    const defaultRadius=region==='input'?Math.max(0,draft.radius-2)
      :['chrome','card','overlay'].includes(region)?draft.radius:0;
    const overrides=Object.keys(values).length;
    const patch=(value:AppearanceSurface)=>updateRegion(region,value);
    return <>
      <div className="appearance-region-head">
        <div><strong>{t(regionLabels[region])}</strong><small>{t('未设置的项继承全局外观。')}</small></div>
        <button type="button" disabled={!overrides} onClick={()=>clearRegion(region)}>{t('清除此区域覆盖')}</button>
      </div>
      <div className="appearance-subhead"><strong>{t('颜色')}</strong><small>{t('只覆盖当前区域的背景和边框。')}</small></div>
      <div className="appearance-settings-grid">
        <ColorSetting id={`ek-${region}-background`} label="背景颜色" value={values.backgroundColor??defaultColor}
          inherited={values.backgroundColor===undefined} onChange={backgroundColor=>patch({backgroundColor})}
          onReset={values.backgroundColor!==undefined?()=>patch({backgroundColor:undefined}):undefined}/>
        <ColorSetting id={`ek-${region}-border`} label="边框颜色" value={values.borderColor??draft.borderColor}
          inherited={values.borderColor===undefined} onChange={borderColor=>patch({borderColor})}
          onReset={values.borderColor!==undefined?()=>patch({borderColor:undefined}):undefined}/>
      </div>
      <div className="appearance-subhead"><strong>{t('玻璃与几何')}</strong><small>{t('单独调整该区域的不透明度、模糊和圆角。')}</small></div>
      <div className="appearance-settings-grid">
        <RangeSetting id={`ek-${region}-opacity`} label="背景不透明度" value={values.opacity??draft.opacity??defaults.opacity}
          min={0} max={1} step={0.01} unit="" inherited={values.opacity===undefined}
          onChange={opacity=>patch({opacity})} onReset={values.opacity!==undefined?()=>patch({opacity:undefined}):undefined}/>
        <RangeSetting id={`ek-${region}-blur`} label="背景模糊" value={values.blur??draft.blur}
          min={0} max={30} step={1} unit="px" inherited={values.blur===undefined}
          onChange={blur=>patch({blur})} onReset={values.blur!==undefined?()=>patch({blur:undefined}):undefined}/>
        <RangeSetting id={`ek-${region}-radius`} label="圆角" value={values.radius??defaultRadius}
          min={0} max={32} step={1} unit="px" inherited={values.radius===undefined}
          onChange={radius=>patch({radius})} onReset={values.radius!==undefined?()=>patch({radius:undefined}):undefined}/>
        <RangeSetting id={`ek-${region}-shadow`} label="阴影强度" value={values.shadow??draft.shadow}
          min={0} max={2} step={0.05} unit="" inherited={values.shadow===undefined}
          onChange={shadow=>patch({shadow})} onReset={values.shadow!==undefined?()=>patch({shadow:undefined}):undefined}/>
      </div>
    </>;
  }
  const custom=!draft.followStudio;
  const region=scope==='global'?null:scope;
  return <section className="settings-section appearance-section" aria-label={t('外观')}>
    <div className="section-heading">
      <div><h2>{t('外观')}</h2><p className="small"></p></div>
    </div>
    <div className="appearance-background-grid">
      <BackgroundCard slot="desktop" fileName={draft.backgroundName} url={backgrounds.desktop} busy={busy} uploading={operation==='desktop'}
        onPick={file=>void pick(file,'desktop')} onClear={()=>void clearBackground('desktop')}/>
      <BackgroundCard slot="mobile" fileName={draft.backgroundMobileName} url={backgrounds.mobile} busy={busy} uploading={operation==='mobile'}
        fallbackUrl={backgrounds.desktop}
        onPick={file=>void pick(file,'mobile')} onClear={()=>void clearBackground('mobile')}/>
    </div>
    <p className="small appearance-background-hint">{t('支持 JPG、PNG、WebP，原图保存，最大 20MB')}</p>
    <div className="card settings-form appearance-controls">
      <label className="appearance-toggle">
        <span><strong>{t('跟随 Ekko Studio')}</strong><small></small></span>
        <input type="checkbox" checked={draft.followStudio} onChange={event=>change({followStudio:event.target.checked})}/>
        <i aria-hidden="true"/>
      </label>
      {custom&&<div className="appearance-customize">
        <div className="appearance-scope-bar">
          <div><strong>{t('调整范围')}</strong><small>{t('按区域覆盖颜色、玻璃与几何；未设置项继承全局。')}</small></div>
          <Select label={t('调整范围')} value={scope} onChange={value=>setScope(value as Scope)} options={[
            {value:'global',label:t('全局')},
            ...appearanceRegions.map(value=>({value,label:t(regionLabels[value])})),
          ]}/>
        </div>
        {scope==='global'?renderGlobal():renderRegion()}
      </div>}
      {!custom&&<p className="appearance-follow-hint">{t('当前跟随 Studio 主题；关闭上方跟随即可自定义精细外观。')}</p>}
      <div className="appearance-footer">
        {error&&<p className="state bad" role="alert"><Icon name="alert"/><span>{error.code} · {error.message}
          {error.diagnosticId&&<><br/><small>{t('诊断编号')}：{error.diagnosticId}</small></>}</span></p>}
        {saved&&<p className="state" role="status"><Icon name="check"/><span>{t('外观设置已保存')}</span></p>}
        <div className="row wrap appearance-actions">
          <button type="button" className="primary" disabled={busy} onClick={()=>void save()}>
            {t(operation==='save'?'正在保存…':'保存外观')}
          </button>
          <button type="button" disabled={busy} onClick={()=>void reset()}>{t(operation==='reset'?'正在恢复…':'恢复默认')}</button>
        </div>
      </div>
    </div>
  </section>;
}

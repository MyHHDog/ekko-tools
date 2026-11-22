/* Studio 主题桥接：宿主把主题变量写在 iframe 根元素的行内样式上，
 * 这里把几何与颜色都映射到插件 token，玻璃层本身保持中性。 */
const mappings:readonly (readonly [string,...string[]])[]=[
  ['--ek-font-ui','--font-family'],
  ['--ek-font-read','--font-family'],
  ['--ek-fs-base','--font-size-base'],
  ['--ek-radius-global','--radius-component'],
  ['--ek-radius-card','--theme-card-radius'],
  ['--ek-radius-input','--theme-input-radius'],
  ['--ek-control-h','--control-height'],
  ['--ek-border-w','--border-width'],
  ['--ek-ls','--letter-spacing'],
  ['--ek-spacing-scale','--spacing-scale'],
  ['--ek-text','--text-primary'],
  ['--ek-text-2','--text-secondary'],
  ['--ek-text-muted','--text-muted'],
  ['--ek-border','--border-color'],
  ['--ek-border-light','--border-light'],
  ['--ek-accent','--accent-primary'],
  ['--ek-focus','--accent-primary'],
  ['--ek-success','--success'],
  ['--ek-error','--error'],
  ['--ek-warning','--warning']
];

function read(name:string){
  const root=document.documentElement;
  return root.style.getPropertyValue(name).trim()||getComputedStyle(root).getPropertyValue(name).trim();
}

function setStyle(name:string,value:string){
  const root=document.documentElement;
  if(value){
    if(root.style.getPropertyValue(name)!==value)root.style.setProperty(name,value);
  }else if(root.style.getPropertyValue(name)){
    root.style.removeProperty(name);
  }
}

function setData(name:string,value:string){
  const root=document.documentElement;
  if(value){
    if(root.dataset[name]!==value)root.dataset[name]=value;
  }else if(root.dataset[name]!==undefined){
    delete root.dataset[name];
  }
}

function colorAlpha(value:string){
  const text=value.trim();
  if(!text)return null;
  const hex=text.match(/^#([\da-f]{6})([\da-f]{2})?$/i);
  if(hex)return hex[2]?parseInt(hex[2],16)/255:1;
  const rgba=text.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i);
  if(!rgba)return null;
  if(rgba[4]===undefined)return 1;
  const alpha=Number(rgba[4]);
  return Number.isFinite(alpha)?(rgba[5]?alpha/100:alpha):null;
}

/* 宿主只保证下发 card/input/overlay 区域变量。用户调整全局外观时这三个区域
 * 会得到相同的透明度与模糊值，据此把 chrome/sidebar/content 也对齐。 */
function bridgeSurfaces(){
  const background=(region:string)=>read(`--theme-${region}-bg`);
  const filter=(region:string)=>read(`--theme-${region}-filter`);
  const chrome=background('chrome'),sidebar=background('sidebar'),content=background('content');
  const card=background('card'),input=background('input'),overlay=background('overlay');
  const known=[card,input,overlay].map(colorAlpha).filter((value):value is number=>value!==null);
  const opacity=known.length>=2&&known.every(value=>Math.abs(value-known[0])<0.001)?known[0]:null;
  const filters=[filter('card'),filter('input'),filter('overlay')];
  const blur=filters.every(value=>!!value&&value===filters[0])?filters[0]:'';
  // pluginThemeSnapshot 在仅启用壁纸时会补 0.72 的卡片玻璃，这不是用户自定义透明度。
  const wallpaperDefault=opacity!==null&&Math.abs(opacity-0.72)<0.005&&!blur;
  const custom=!!(chrome||sidebar||content)||(opacity!==null&&!wallpaperDefault)||!!blur;
  if(chrome||sidebar||content){
    setStyle('--ek-glass-chrome-bg',chrome);
    setStyle('--ek-glass-sidebar-bg',sidebar);
    setStyle('--ek-glass-content-bg',content);
    setStyle('--ek-glass-chrome-filter',filter('chrome'));
    setStyle('--ek-glass-sidebar-filter',filter('sidebar'));
    setStyle('--ek-glass-content-filter',filter('content'));
  }else if(custom){
    const surface=card||input||overlay;
    setStyle('--ek-glass-chrome-bg',surface);
    setStyle('--ek-glass-sidebar-bg',surface);
    setStyle('--ek-glass-content-bg',surface);
    setStyle('--ek-glass-chrome-filter',blur);
    setStyle('--ek-glass-sidebar-filter',blur);
    setStyle('--ek-glass-content-filter',blur);
  }else{
    setStyle('--ek-glass-chrome-bg','');
    setStyle('--ek-glass-sidebar-bg','');
    setStyle('--ek-glass-content-bg','');
    setStyle('--ek-glass-chrome-filter','');
    setStyle('--ek-glass-sidebar-filter','');
    setStyle('--ek-glass-content-filter','');
  }
  setData('ekStudioSurface',custom?'custom':'');
}

export function applyStudioTheme(){
  if(typeof document==='undefined')return {} as Record<string,string>;
  const root=document.documentElement,applied:Record<string,string>={};
  for(const [token,...sources] of mappings){
    const value=sources.map(read).find(Boolean)||'';
    if(!value){
      if(root.style.getPropertyValue(token))root.style.removeProperty(token);
      continue;
    }
    applied[token]=value;
    if(root.style.getPropertyValue(token)!==value)root.style.setProperty(token,value);
  }
  const declared=read('--studio-color-scheme'),hostBg=read('--bg-primary')||read('--bg-secondary');
  const scheme=declared==='light'||declared==='dark'
    ?declared
    :hostBg?colorLuminance(hostBg)?'light':'dark':'light';
  setStyle('color-scheme',scheme);
  setData('ekStudioTheme',scheme);
  bridgeSurfaces();
  if(applied['--ek-accent']){
    const light=colorLuminance(applied['--ek-accent']);
    setStyle('--ek-on-accent',light?'#1a1a1a':'#ffffff');
    setStyle('--ek-accent-hover',
      `color-mix(in srgb, ${applied['--ek-accent']} 87%, ${light?'white':'black'})`);
  }else{
    setStyle('--ek-on-accent','');
    setStyle('--ek-accent-hover','');
  }
  return applied;
}

function colorLuminance(value:string){
  const hex=value.match(/^#([\da-f]{6})$/i)?.[1];
  const rgb=value.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  const channels=hex?[0,2,4].map(index=>parseInt(hex.slice(index,index+2),16))
    :rgb?[rgb[1],rgb[2],rgb[3]].map(Number):[];
  if(channels.length!==3)return false;
  const linear=channels.map(channel=>{
    const normalized=channel/255;
    return normalized<=0.04045?normalized/12.92:((normalized+0.055)/1.055)**2.4;
  });
  return linear[0]*0.2126+linear[1]*0.7152+linear[2]*0.0722>0.179;
}

export function watchStudioTheme(canApply:()=>boolean=()=>true){
  if(typeof document==='undefined'||typeof MutationObserver==='undefined')return()=>{};
  const observer=new MutationObserver(()=>{
    if(!canApply())return;
    try{applyStudioTheme();}finally{observer.takeRecords();}
  });
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['style','class']});
  return()=>observer.disconnect();
}

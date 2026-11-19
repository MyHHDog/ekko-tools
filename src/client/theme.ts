/* Studio 主题桥接：宿主把主题变量写在 iframe 根元素的行内样式上，
 * 这里把可变几何量映射到插件 token；颜色材质继续使用插件自身的深蓝玻璃。 */
const mappings:readonly (readonly [string,string])[]=[
  ['--ek-font-ui','--font-family'],
  ['--ek-font-read','--font-family'],
  ['--ek-fs-base','--font-size-base'],
  ['--ek-radius-global','--radius-component'],
  ['--ek-radius-card','--theme-card-radius'],
  ['--ek-radius-input','--theme-input-radius'],
  ['--ek-control-h','--control-height'],
  ['--ek-border-w','--border-width'],
  ['--ek-ls','--letter-spacing'],
  ['--ek-spacing-scale','--spacing-scale']
];

function read(name:string){
  const root=document.documentElement;
  return root.style.getPropertyValue(name).trim()||getComputedStyle(root).getPropertyValue(name).trim();
}

export function applyStudioTheme(){
  if(typeof document==='undefined')return {} as Record<string,string>;
  const root=document.documentElement,applied:Record<string,string>={};
  for(const [token,source] of mappings){
    const value=read(source);
    if(!value){
      if(root.style.getPropertyValue(token))root.style.removeProperty(token);
      continue;
    }
    applied[token]=value;
    if(root.style.getPropertyValue(token)!==value)root.style.setProperty(token,value);
  }
  return applied;
}

export function watchStudioTheme(canApply:()=>boolean=()=>true){
  if(typeof document==='undefined'||typeof MutationObserver==='undefined')return()=>{};
  const observer=new MutationObserver(()=>{if(canApply())applyStudioTheme();});
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['style','class']});
  return()=>observer.disconnect();
}

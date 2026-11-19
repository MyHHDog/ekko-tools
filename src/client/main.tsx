import {createRoot} from 'react-dom/client';
import {App} from './App';
import type {ClientHost} from './adapter/host';
import tokens from './styles/design-tokens.css';
import styles from './styles/app.css';
import compat from './styles/compat.css';
import redesign from './styles/redesign.css';
import mailClient from './styles/mail-client.css';
import themeStudio from './styles/theme-studio.css';
import reading from './styles/reading.css';
import fonts from './styles/fonts.css';
import panelBackground from '../../assets/panel-bg.jpg';
import {watchStudioTheme} from './theme';
import {applyAppearance,currentAppearance,currentBackground,loadAppearance} from './appearance';
import {readAppearanceCache,readBootstrapCache,writeAppearanceCache} from './bootstrap-cache';
export {resolveSlot} from './adapter/host';
const bootBackground='#16294a';
function paintBootSurface(element?:HTMLElement){
  const root=document.documentElement;
  root.style.backgroundColor=bootBackground;
  root.style.colorScheme='dark';
  if(document.body)document.body.style.backgroundColor=bootBackground;
  if(element)element.style.backgroundColor=bootBackground;
}
paintBootSurface();
export function mount(element:HTMLElement,ctx:ClientHost){
  paintBootSurface(element);
  document.documentElement.style.setProperty('--ek-theme-bg-image',`url("${panelBackground}")`);
  const sheet=document.createElement('style');sheet.textContent=fonts+'\n'+tokens+'\n'+styles+'\n'+compat+'\n'+redesign+'\n'+mailClient+'\n'+themeStudio+'\n'+reading;document.head.append(sheet);
  const cachedBoot=readBootstrapCache(ctx),cachedAppearance=readAppearanceCache(ctx);
  applyAppearance(cachedAppearance??currentAppearance(),cachedAppearance?undefined:currentBackground()||undefined);
  let disposed=false,appearanceTimer=0;
  const unwatch=watchStudioTheme(()=>currentAppearance().followStudio);
  const root=createRoot(element);root.render(<App ctx={ctx} initialData={cachedBoot} refreshOnMount={!!cachedBoot}/>);
  if(ctx.slot!=='workspace-sidebar')appearanceTimer=window.setTimeout(()=>{
    if(disposed)return;
    void loadAppearance(ctx).then(value=>writeAppearanceCache(ctx,value.settings)).catch(()=>{});
  },0);
  const dispose=()=>{if(disposed)return;disposed=true;window.clearTimeout(appearanceTimer);unwatch();root.unmount();sheet.remove();};
  const release=ctx.lifecycle.add(dispose);
  ctx.signal.addEventListener('abort',release,{once:true});
  return()=>{ctx.signal.removeEventListener('abort',release);release();};
}

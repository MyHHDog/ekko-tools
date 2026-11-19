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
import {applyStudioTheme,watchStudioTheme} from './theme';
import {currentAppearance,loadAppearance} from './appearance';
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
  applyStudioTheme();
  let disposed=false,appearanceTimer=0,appearanceIdle=0;
  const loadLater=()=>{if(!disposed)void loadAppearance(ctx).catch(()=>{});};
  const idle=(window as any).requestIdleCallback;
  if(typeof idle==='function')appearanceIdle=idle(loadLater,{timeout:800});
  else appearanceTimer=window.setTimeout(loadLater,120);
  const unwatch=watchStudioTheme(()=>currentAppearance().followStudio);
  const root=createRoot(element);root.render(<App ctx={ctx}/>);
  const dispose=()=>{if(disposed)return;disposed=true;window.clearTimeout(appearanceTimer);if(appearanceIdle)(window as any).cancelIdleCallback?.(appearanceIdle);unwatch();root.unmount();sheet.remove();};
  const release=ctx.lifecycle.add(dispose);
  ctx.signal.addEventListener('abort',release,{once:true});
  return()=>{ctx.signal.removeEventListener('abort',release);release();};
}

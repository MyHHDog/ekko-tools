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
import mobile from './styles/mobile.css';
import studioSurfaces from './styles/studio-surfaces.css';
import studioGeometry from './styles/studio-geometry.css';
import fonts from './styles/fonts.css';
import {watchStudioTheme} from './theme';
import {applyAppearance,currentAppearance,currentBackgrounds,loadAppearance,refreshAppearance} from './appearance';
import {readAppearanceCache,readBackgroundCache,readBootstrapCache} from './bootstrap-cache';
export {resolveSlot} from './adapter/host';
const bootBackground='var(--bg-primary, #fafafa)';
function paintBootSurface(element?:HTMLElement){
  const root=document.documentElement;
  root.style.backgroundColor=bootBackground;
  const scheme=getComputedStyle(root).getPropertyValue('--studio-color-scheme').trim();
  root.style.colorScheme=scheme==='dark'||scheme==='light'?scheme:'light';
  if(document.body)document.body.style.backgroundColor=bootBackground;
  if(element)element.style.backgroundColor=bootBackground;
}
paintBootSurface();
export function mount(element:HTMLElement,ctx:ClientHost){
  paintBootSurface(element);
  const syncViewportHeight=()=>{
    const height=window.innerHeight||document.documentElement.clientHeight;
    if(height>0)document.documentElement.style.setProperty('--ek-viewport-height',`${Math.ceil(height)}px`);
  };
  syncViewportHeight();
  window.addEventListener('resize',syncViewportHeight,{passive:true});
  window.visualViewport?.addEventListener('resize',syncViewportHeight,{passive:true});
  const sheet=document.createElement('style');
  sheet.textContent=[fonts,tokens,styles,compat,redesign,mailClient,themeStudio,reading,mobile,
    studioSurfaces,studioGeometry,
  ].join('\n');
  document.head.append(sheet);
  const cachedBoot=readBootstrapCache(ctx),cachedAppearance=readAppearanceCache(ctx);
  const cachedBackgrounds=readBackgroundCache(ctx),moduleBackgrounds=currentBackgrounds();
  const hasModuleBackground=!!(moduleBackgrounds.desktop||moduleBackgrounds.mobile);
  applyAppearance(cachedAppearance??currentAppearance(),cachedBackgrounds??(hasModuleBackground?moduleBackgrounds:undefined),!!(cachedBackgrounds||hasModuleBackground));
  let disposed=false,appearanceTimer=0;
  const unwatch=watchStudioTheme(()=>currentAppearance().followStudio);
  let appearanceUpdatedAt=0;
  const unwatchAppearance=ctx.messages.on('appearance.updated',event=>{
    if(event?.identity&&ctx.identity&&(event.identity.userId!==ctx.identity.userId||event.identity.profile!==ctx.identity.profile))return;
    const payload=event?.data||event||{},updatedAt=Number(payload.updatedAt)||0;
    if(updatedAt&&updatedAt<=appearanceUpdatedAt)return;
    appearanceUpdatedAt=updatedAt||Date.now();
    if(!disposed)void refreshAppearance(ctx).catch(()=>{});
  });
  const root=createRoot(element);root.render(<App ctx={ctx} initialData={cachedBoot} refreshOnMount={!!cachedBoot}/>);
  if(ctx.slot!=='workspace-sidebar')appearanceTimer=window.setTimeout(()=>{
    if(disposed)return;
    void loadAppearance(ctx).catch(()=>{});
  },0);
  const dispose=()=>{
    if(disposed)return;disposed=true;
    window.clearTimeout(appearanceTimer);
    window.removeEventListener('resize',syncViewportHeight);
    window.visualViewport?.removeEventListener('resize',syncViewportHeight);
    document.documentElement.style.removeProperty('--ek-viewport-height');
    unwatchAppearance();unwatch();root.unmount();sheet.remove();
  };
  const release=ctx.lifecycle.add(dispose);
  ctx.signal.addEventListener('abort',release,{once:true});
  return()=>{ctx.signal.removeEventListener('abort',release);release();};
}

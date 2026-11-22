// @vitest-environment jsdom
import {afterEach,it,expect,vi} from 'vitest';
import {applyStudioTheme,watchStudioTheme} from '../../src/client/theme';
const root=document.documentElement;
const host=['--font-family','--font-size-base','--radius-component','--theme-card-radius','--theme-input-radius','--control-height','--border-width','--letter-spacing',
  '--bg-secondary','--theme-card-bg','--theme-input-bg','--text-primary','--text-secondary','--text-muted','--border-color','--border-light','--accent-primary','--studio-color-scheme'];
const local=['--ek-font-ui','--ek-font-read','--ek-fs-base','--ek-radius-global','--ek-radius-card','--ek-radius-input','--ek-control-h','--ek-border-w','--ek-ls',
  '--ek-bg-solid','--ek-bg-panel','--ek-bg-surface','--ek-bg-input','--ek-text','--ek-text-2','--ek-text-muted','--ek-border','--ek-border-light','--ek-accent','--ek-focus','--ek-on-accent',
  '--ek-glass-chrome-bg','--ek-glass-sidebar-bg','--ek-glass-content-bg',
  '--ek-glass-chrome-filter','--ek-glass-sidebar-filter','--ek-glass-content-filter'];
afterEach(()=>{
  for(const name of [...host,...local])root.style.removeProperty(name);
  root.style.removeProperty('color-scheme');
  delete root.dataset.ekStudioTheme;
  delete root.dataset.ekStudioSurface;
});
it('把 Studio 主题的字体与几何变量映射到插件 token',()=>{
  root.style.setProperty('--font-family','"Comic Neue", "ZCOOL KuaiLe", cursive');
  root.style.setProperty('--font-size-base','16px');
  root.style.setProperty('--radius-component','23px');
  root.style.setProperty('--theme-card-radius','21px');
  root.style.setProperty('--theme-input-radius','20px');
  root.style.setProperty('--control-height','44px');
  root.style.setProperty('--border-width','2.5px');
  root.style.setProperty('--letter-spacing','-0.6px');
  const applied=applyStudioTheme();
  expect(applied['--ek-font-ui']).toContain('Comic Neue');
  expect(applied['--ek-fs-base']).toBe('16px');
  expect(root.style.getPropertyValue('--ek-font-read')).toContain('ZCOOL KuaiLe');
  expect(root.style.getPropertyValue('--ek-control-h')).toBe('44px');
  expect(root.style.getPropertyValue('--ek-radius-card')).toBe('21px');
});
it('宿主未提供的变量保持插件默认值',()=>{
  root.style.setProperty('--font-size-base','16px');
  applyStudioTheme();
  expect(root.style.getPropertyValue('--ek-control-h')).toBe('');
});
it('同步宿主颜色与明暗模式，背景层级交由 CSS 处理',()=>{
  root.style.setProperty('--theme-card-bg','rgb(255 255 255 / 84%)');
  root.style.setProperty('--theme-input-bg','rgb(245 247 249 / 88%)');
  root.style.setProperty('--text-primary','#23272b');
  root.style.setProperty('--border-color','rgb(31 39 47 / 17%)');
  root.style.setProperty('--accent-primary','#2f353b');
  root.style.setProperty('--studio-color-scheme','light');
  applyStudioTheme();
  expect(root.style.getPropertyValue('--ek-bg-surface')).toBe('');
  expect(root.style.getPropertyValue('--ek-bg-panel')).toBe('');
  expect(root.style.getPropertyValue('--ek-text')).toBe('#23272b');
  expect(root.style.getPropertyValue('--ek-accent')).toBe('#2f353b');
  expect(root.style.getPropertyValue('--ek-on-accent')).toBe('#ffffff');
  expect(root.style.colorScheme).toBe('light');
});
it('仅壁纸默认卡片玻璃时保留 Studio 的区域玻璃默认值',()=>{
  for(const region of ['card','input','overlay']){
    root.style.setProperty(`--theme-${region}-bg`,'rgba(255, 255, 255, 0.72)');
  }
  root.style.setProperty('--studio-color-scheme','light');
  applyStudioTheme();
  expect(root.style.getPropertyValue('--ek-glass-content-bg')).toBe('');
  expect(root.dataset.ekStudioSurface).toBeUndefined();
  expect(root.dataset.ekStudioTheme).toBe('light');
});
it('把宿主全局透明度与模糊同步到 chrome/sidebar/content',()=>{
  for(const region of ['card','input','overlay']){
    root.style.setProperty(`--theme-${region}-bg`,'rgba(255, 255, 255, 0.03)');
    root.style.setProperty(`--theme-${region}-filter`,'none');
  }
  root.style.setProperty('--studio-color-scheme','dark');
  applyStudioTheme();
  expect(root.style.getPropertyValue('--ek-glass-content-bg')).toBe('rgba(255, 255, 255, 0.03)');
  expect(root.style.getPropertyValue('--ek-glass-sidebar-bg')).toBe('rgba(255, 255, 255, 0.03)');
  expect(root.style.getPropertyValue('--ek-glass-chrome-filter')).toBe('none');
  expect(root.dataset.ekStudioSurface).toBe('custom');
  expect(root.dataset.ekStudioTheme).toBe('dark');
});

it('WebView 样式写入即使始终触发变更，也不因主题自身写入反复同步',async()=>{
  const setProperty=root.style.setProperty.bind(root.style);
  const spy=vi.spyOn(root.style,'setProperty').mockImplementation((name,value,priority)=>{
    setProperty(name,value,priority);
    if(name==='--ek-on-accent')root.setAttribute('style',root.getAttribute('style')??'');
  });
  let passes=0;
  const canApply=vi.fn(()=>++passes<=8);
  const stop=watchStudioTheme(canApply);
  try{
    root.style.setProperty('--accent-primary','#111111');
    await new Promise<void>(resolve=>setTimeout(resolve,0));
    expect(root.style.getPropertyValue('--ek-accent')).toBe('#111111');
    expect(canApply).toHaveBeenCalledTimes(1);
    root.style.setProperty('--accent-primary','#eeeeee');
    await new Promise<void>(resolve=>setTimeout(resolve,0));
    expect(root.style.getPropertyValue('--ek-on-accent')).toBe('#1a1a1a');
    expect(canApply).toHaveBeenCalledTimes(2);
  }finally{stop();spy.mockRestore();}
});

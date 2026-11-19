// @vitest-environment jsdom
import {afterEach,it,expect} from 'vitest';
import {applyStudioTheme} from '../../src/client/theme';
const root=document.documentElement;
const host=['--font-family','--font-size-base','--radius-component','--theme-card-radius','--theme-input-radius','--control-height','--border-width','--letter-spacing'];
const local=['--ek-font-ui','--ek-font-read','--ek-fs-base','--ek-radius-global','--ek-radius-card','--ek-radius-input','--ek-control-h','--ek-border-w','--ek-ls'];
afterEach(()=>{for(const name of [...host,...local])root.style.removeProperty(name);});
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

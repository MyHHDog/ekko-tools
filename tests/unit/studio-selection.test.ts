// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {pickTranslationTarget,studioSelectionRuntime} from '../../src/host/selection-overlay';

function selectText(text: string) {
  const block = document.createElement('p');
  block.textContent = text;
  document.body.appendChild(block);
  const range = document.createRange();
  range.selectNodeContents(block);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
}

function shadow() {
  return document.getElementById('ekko-tools-selection-root')?.shadowRoot || null;
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.localStorage.clear();
  window.localStorage.setItem('hermes_api_key', 'fixture-token');
  window.localStorage.setItem('hermes_active_profile_name', 'default');
});

afterEach(() => {
  (window as any).__EK_TOOLS_SELECTION__?.destroy();
  delete (window as any).__EK_TOOLS_SELECTION__;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('在宿主对话页选中文字后自动翻译，并把译文放进划词浮条', async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ result: { ok: true, data: { result: { translated: '你好，世界' } } } })
  }));
  vi.stubGlobal('fetch', fetchMock);
  studioSelectionRuntime({ enabled: true, target: 'zh', pluginId: 'ekko-tools' }, pickTranslationTarget);
  selectText('Hello world');
  await vi.waitFor(() => expect(shadow()?.querySelector('.result')?.textContent).toBe('你好，世界'));
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/api/studio/plugins/ekko-tools/invoke?profile=default'),
    expect.objectContaining({ method: 'POST' })
  );
  const body = JSON.parse(String((fetchMock.mock.calls[0] as any[])[1].body));
  expect(body).toMatchObject({ kind: 'rpc', name: 'translate.run', input: { text: 'Hello world', from: 'auto', to: 'zh' } });
});

it('目标语言变化后请求新语言，关闭开关立即隐藏浮条', async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ result: { ok: true, data: { result: { translated: 'Hello' } } } })
  }));
  vi.stubGlobal('fetch', fetchMock);
  studioSelectionRuntime({ enabled: true, target: 'zh', pluginId: 'ekko-tools' }, pickTranslationTarget);
  selectText('First paragraph');
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  (window as any).__EK_TOOLS_SELECTION__.update({ enabled: true, target: 'en', pluginId: 'ekko-tools' });
  selectText('第二段原文');
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const body = JSON.parse(String((fetchMock.mock.calls[1] as any[])[1].body));
  expect(body.input.to).toBe('en');
  (window as any).__EK_TOOLS_SELECTION__.update({ enabled: false, target: 'en', pluginId: 'ekko-tools' });
  expect((shadow()?.querySelector('.bar') as HTMLElement).hidden).toBe(true);
});

it('toString 注入的源码不依赖模块作用域，可独立执行', async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ result: { ok: true, data: { result: { translated: '注入成功' } } } })
  }));
  const source = `(${studioSelectionRuntime.toString()})(${JSON.stringify({ enabled: true, target: 'zh', pluginId: 'ekko-tools' })},${pickTranslationTarget.toString()})`;
  const runner = new Function('window', 'document', 'fetch', `return ${source}`);
  runner(window, document, fetchMock);
  expect((window as any).__EK_TOOLS_SELECTION__).toBeTruthy();
  selectText('Hello world');
  await new Promise(resolve => setTimeout(resolve, 120));
  expect(shadow()?.querySelector('.result')?.textContent).toBe('注入成功');
  (window as any).__EK_TOOLS_SELECTION__.destroy();
});

it('中英自动互译：中文选区译成英文，英文选区译成中文', async () => {
  const fetchMock = vi.fn(async (_url: string, init: any) => {
    const input = JSON.parse(String(init.body)).input;
    return {
      ok: true,
      status: 200,
      json: async () => ({ result: { ok: true, data: { result: { translated: input.to === 'en' ? 'Hello world' : '你好，世界' } } } })
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  studioSelectionRuntime({ enabled: true, target: 'zh', pluginId: 'ekko-tools' }, pickTranslationTarget);
  selectText('你好，世界');
  await vi.waitFor(() => expect(shadow()?.querySelector('.result')?.textContent).toBe('Hello world'));
  expect(JSON.parse(String((fetchMock.mock.calls[0] as any[])[1].body)).input.to).toBe('en');
  selectText('Hello world');
  await vi.waitFor(() => expect(shadow()?.querySelector('.result')?.textContent).toBe('你好，世界'));
  expect(JSON.parse(String((fetchMock.mock.calls[1] as any[])[1].body)).input.to).toBe('zh');
  expect(pickTranslationTarget('中文', 'zh')).toBe('en');
  expect(pickTranslationTarget('English', 'zh')).toBe('zh');
  expect(pickTranslationTarget('中文', 'ja')).toBe('ja');
});

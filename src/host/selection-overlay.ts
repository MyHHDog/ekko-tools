export interface StudioSelectionConfig {
  enabled: boolean;
  target: string;
  pluginId: string;
  apiBase?: string;
}

/**
 * 中英互译：中文选区的目标为英文，英文选区的目标为中文。
 * 其他目标语言保持用户设置，不强行改写。
 */
export function pickTranslationTarget(text: string, fallback: string) {
  const base = fallback === 'auto' ? 'zh' : fallback;
  if (base !== 'zh' && base !== 'en') return base;
  const prose = text.replace(/https?:\/\/\S+|www\.\S+|\S+@\S+/giu, ' ').replace(/```[\s\S]*?```/g, ' ');
  const kana = (prose.match(/[\u3040-\u30ff]/g) || []).length;
  if (kana) return base === 'en' ? 'en' : 'zh';
  const han = (prose.match(/[\u3400-\u9fff]/g) || []).length;
  const latin = (prose.match(/[A-Za-z]/g) || []).length;
  if (!han && !latin) return base;
  if (!latin) return 'en';
  if (!han) return 'zh';
  return han / (han + latin) >= 0.25 ? 'en' : 'zh';
}

/**
 * 运行在 Studio 宿主页面，而不是插件 iframe：插件 frame 只在插件页存在，
 * 这里由插件页注入到宿主文档，才能在对话页监听划词并显示浮条。
 * 该函数会被 toString() 注入，必须保持自包含，不引用模块作用域。
 */
export function studioSelectionRuntime(initial: StudioSelectionConfig, pick?: (text: string, fallback: string) => string) {
  const w = window as any;
  const doc = document;
  if (w.__EK_TOOLS_SELECTION__) {
    w.__EK_TOOLS_SELECTION__.update(initial);
    return;
  }
  const state = {
    enabled: initial.enabled !== false,
    target: initial.target || 'zh',
    pluginId: initial.pluginId || 'ekko-tools',
    apiBase: initial.apiBase || ''
  };
  const chooseTarget = typeof pick === 'function' ? pick : (value: string, fallback: string) => fallback;
  let host: HTMLDivElement | null = null;
  let bar: HTMLDivElement | null = null;
  let statusEl: HTMLSpanElement | null = null;
  let resultBox: HTMLDivElement | null = null;
  let copyBtn: HTMLButtonElement | null = null;
  let retryBtn: HTMLButtonElement | null = null;
  let currentText = '';
  let currentTarget = state.target;
  let currentRect: DOMRect | null = null;
  let controller: AbortController | null = null;
  let timer = 0;
  const cache = new Map<string, string>();
  const MAX_CHARS = 1500;

  const css = `
    :host{all:initial}
    .bar{position:fixed;left:0;top:0;z-index:2147483000;box-sizing:border-box;
      width:min(420px,calc(100vw - 24px));padding:7px 8px 8px;pointer-events:auto;
      color:var(--text-primary,#eef4ff);font-family:var(--font-family,"Segoe UI","Microsoft YaHei UI",sans-serif);
      font-size:13px;line-height:1.45;background:color-mix(in srgb,var(--bg-secondary,#142b4d) 88%,#071528);
      border:1px solid var(--border-color,rgba(170,196,236,.34));border-radius:14px;
      box-shadow:0 18px 46px rgba(3,12,27,.42);visibility:hidden}
    .head{display:flex;align-items:center;gap:6px;min-height:28px}
    .dot{width:8px;height:8px;border-radius:50%;background:var(--accent-color,#6f8fd0);
      box-shadow:0 0 0 4px color-mix(in srgb,var(--accent-color,#6f8fd0) 22%,transparent);flex:none}
    .name{font-weight:600;letter-spacing:.2px;color:var(--text-primary,#eef4ff);white-space:nowrap}
    .status{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      color:var(--text-secondary,#b9c7dd);font-size:12px}
    .grow{flex:1}
    button{all:unset;box-sizing:border-box;cursor:pointer;height:26px;padding:0 9px;border-radius:8px;
      font:inherit;font-size:12px;color:var(--text-secondary,#b9c7dd);white-space:nowrap}
    button:hover{background:color-mix(in srgb,var(--text-primary,#eef4ff) 10%,transparent);color:var(--text-primary,#eef4ff)}
    .close{padding:0 6px;font-size:15px;line-height:1}
    .result{margin-top:6px;padding:7px 8px;max-height:230px;overflow:auto;white-space:pre-wrap;
      user-select:text;border-radius:9px;background:color-mix(in srgb,var(--bg-primary,#0d1f38) 55%,transparent);
      border:1px solid color-mix(in srgb,var(--border-color,rgba(170,196,236,.34)) 60%,transparent);
      color:var(--text-primary,#eef4ff);font-size:13px;line-height:1.6}
    .result.error{color:var(--error-color,#e6b0a8)}
    .result[hidden],button[hidden]{display:none}
  `;
  const markup = `<div class="bar" hidden part="bar">
    <div class="head"><span class="dot"></span><span class="name">Ekko 翻译</span>
      <span class="status">翻译中…</span><span class="grow"></span>
      <button class="copy" type="button" hidden>复制</button>
      <button class="retry" type="button" hidden>重译</button>
      <button class="close" type="button" aria-label="关闭划词翻译" title="关闭">×</button>
    </div>
    <div class="result" hidden></div>
  </div>`;

  function ensureHost() {
    if (host && doc.contains(host)) return;
    host = doc.createElement('div');
    host.id = 'ekko-tools-selection-root';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${css}</style>${markup}`;
    bar = shadow.querySelector('.bar') as HTMLDivElement;
    statusEl = shadow.querySelector('.status') as HTMLSpanElement;
    resultBox = shadow.querySelector('.result') as HTMLDivElement;
    copyBtn = shadow.querySelector('.copy') as HTMLButtonElement;
    retryBtn = shadow.querySelector('.retry') as HTMLButtonElement;
    const closeBtn = shadow.querySelector('.close') as HTMLButtonElement;
    bar.addEventListener('mousedown', event => event.preventDefault());
    closeBtn.addEventListener('click', hide);
    retryBtn.addEventListener('click', () => {
      if (!currentText) return;
      cache.delete(currentTarget + '\u0000' + currentText);
      void runTranslate(currentText, currentTarget);
    });
    copyBtn.addEventListener('click', () => {
      const value = resultBox?.textContent || '';
      if (!value) return;
      void copyValue(value);
    });
    (doc.body || doc.documentElement).appendChild(host);
  }

  function hide() {
    if (controller) controller.abort();
    controller = null;
    currentText = '';
    currentTarget = state.target;
    currentRect = null;
    window.clearTimeout(timer);
    if (bar) bar.hidden = true;
    if (resultBox) {
      resultBox.hidden = true;
      resultBox.textContent = '';
      resultBox.classList.remove('error');
    }
  }

  function position(rect: DOMRect | null) {
    if (!bar) return;
    bar.hidden = false;
    bar.style.visibility = 'hidden';
    const box = bar.getBoundingClientRect();
    const margin = 10;
    let left = rect ? rect.left : (w.innerWidth - box.width) / 2;
    let top = rect ? rect.bottom + 10 : 72;
    left = Math.max(margin, Math.min(w.innerWidth - box.width - margin, left));
    if (rect && top + box.height > w.innerHeight - margin) top = rect.top - box.height - 10;
    top = Math.max(margin, Math.min(w.innerHeight - box.height - margin, top));
    bar.style.left = `${Math.round(left)}px`;
    bar.style.top = `${Math.round(top)}px`;
    bar.style.visibility = 'visible';
  }

  function readSelection(): { text: string; rect: DOMRect | null } | null {
    const active = doc.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
      const start = active.selectionStart ?? 0;
      const end = active.selectionEnd ?? 0;
      if (end > start) return { text: active.value.slice(start, end), rect: active.getBoundingClientRect() };
    }
    const selection = w.getSelection ? w.getSelection() : doc.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const text = selection.toString();
    if (!text.trim()) return null;
    const node = selection.anchorNode as Node | null;
    if (node && host && (host === node || host.contains(node))) return null;
    const element = node && node.nodeType === 1 ? node as Element : node?.parentElement;
    if (element?.closest('input,textarea,select,[contenteditable="true"]')) return null;
    const range = selection.getRangeAt(0);
    const rect = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
    return { text, rect };
  }

  function targetLabel(target: string) {
    return target === 'zh' ? '中文' : target === 'en' ? 'English' : target;
  }

  function show(text: string, rect: DOMRect | null) {
    ensureHost();
    const value = text.trim();
    if (!value || Array.from(value).length > MAX_CHARS) {
      hide();
      return;
    }
    if (value === currentText && bar && !bar.hidden && resultBox && !resultBox.hidden) {
      currentRect = rect;
      position(rect);
      return;
    }
    currentText = value;
    currentTarget = chooseTarget(value, state.target);
    currentRect = rect;
    if (copyBtn) copyBtn.hidden = true;
    if (retryBtn) retryBtn.hidden = true;
    if (resultBox) {
      resultBox.hidden = true;
      resultBox.textContent = '';
      resultBox.classList.remove('error');
    }
    if (statusEl) statusEl.textContent = `翻译中… · ${targetLabel(currentTarget)}`;
    position(rect);
    void runTranslate(value, currentTarget);
  }

  function render(value: string, cached: boolean, target: string) {
    if (!resultBox || !statusEl) return;
    resultBox.classList.remove('error');
    resultBox.textContent = value;
    resultBox.hidden = false;
    statusEl.textContent = `${cached ? '缓存译文' : '译文'} · ${targetLabel(target)}`;
    if (copyBtn) copyBtn.hidden = false;
    if (retryBtn) retryBtn.hidden = false;
    position(currentRect);
  }

  function renderError(error: any) {
    if (!resultBox || !statusEl) return;
    resultBox.classList.add('error');
    resultBox.textContent = error instanceof Error ? error.message : String(error || '翻译失败');
    resultBox.hidden = false;
    statusEl.textContent = '翻译失败';
    if (copyBtn) copyBtn.hidden = true;
    if (retryBtn) retryBtn.hidden = false;
    position(currentRect);
  }

  async function runTranslate(text: string, target: string) {
    const key = target + '\u0000' + text;
    const cached = cache.get(key);
    if (cached) {
      render(cached, true, target);
      return;
    }
    if (controller) controller.abort();
    const current = new AbortController();
    controller = current;
    if (statusEl) statusEl.textContent = `翻译中… · ${targetLabel(target)}`;
    if (resultBox) resultBox.hidden = true;
    try {
      const value = await requestTranslation(text, target, current.signal);
      if (current.signal.aborted || text !== currentText) return;
      cache.set(key, value);
      if (cache.size > 40) cache.delete(cache.keys().next().value!);
      render(value, false, target);
    } catch (error) {
      if (current.signal.aborted) return;
      renderError(error);
    } finally {
      if (controller === current) controller = null;
    }
  }

  async function requestTranslation(text: string, target: string, signal: AbortSignal) {
    let token = '';
    let profile = 'default';
    try {
      token = w.localStorage?.getItem('hermes_api_key') || '';
      profile = w.localStorage?.getItem('hermes_active_profile_name') || 'default';
    } catch { /* 隐私模式或跨域环境退回匿名请求。 */ }
    const base = state.apiBase || w.location.origin;
    const url = `${base}/api/studio/plugins/${encodeURIComponent(state.pluginId)}/invoke?profile=${encodeURIComponent(profile)}`;
    const response = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Hermes-Profile': profile,
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ kind: 'rpc', name: 'translate.run', input: { text, from: 'auto', to: target } })
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) throw new Error('Studio 登录已失效，请重新登录');
      if (response.status === 404) throw new Error('Ekko Tools 未启用');
      throw new Error(body?.error || `翻译请求失败（${response.status}）`);
    }
    const envelope = body?.result;
    if (!envelope?.ok) throw new Error(envelope?.error?.message || '翻译失败');
    const translated = envelope?.data?.result?.translated;
    if (!translated) throw new Error('翻译结果为空');
    return String(translated);
  }

  async function copyValue(value: string) {
    try {
      await w.navigator.clipboard.writeText(value);
      if (statusEl) statusEl.textContent = '已复制';
      return;
    } catch { /* 宿主未授权剪贴板时走选区复制。 */ }
    const area = doc.createElement('textarea');
    area.value = value;
    area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    (doc.body || doc.documentElement).appendChild(area);
    area.select();
    try {
      if (doc.execCommand('copy') && statusEl) statusEl.textContent = '已复制';
    } catch { /* 保留文本供手动复制。 */ }
    area.remove();
  }

  function schedulePick(event: Event) {
    if (!state.enabled) return;
    if (host && event.composedPath?.().includes(host)) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const picked = readSelection();
      if (!picked) {
        hide();
        return;
      }
      show(picked.text, picked.rect);
    }, 30);
  }

  function onMouseUp(event: MouseEvent) {
    schedulePick(event);
  }

  function onKeyUp(event: KeyboardEvent) {
    if (!state.enabled) return;
    if (event.key !== 'Shift' && !event.shiftKey) return;
    schedulePick(event);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') hide();
  }

  function update(next: StudioSelectionConfig) {
    const targetChanged = state.target !== (next.target || 'zh');
    state.enabled = next.enabled !== false;
    state.target = next.target || 'zh';
    state.pluginId = next.pluginId || state.pluginId;
    state.apiBase = next.apiBase || state.apiBase;
    if (!state.enabled || targetChanged) hide();
  }

  function destroy() {
    hide();
    doc.removeEventListener('mouseup', onMouseUp, true);
    doc.removeEventListener('keyup', onKeyUp, true);
    doc.removeEventListener('keydown', onKeyDown, true);
    w.removeEventListener('scroll', hide, true);
    w.removeEventListener('resize', hide);
    host?.remove();
    host = null;
    delete w.__EK_TOOLS_SELECTION__;
  }

  w.__EK_TOOLS_SELECTION__ = { update, destroy };
  doc.addEventListener('mouseup', onMouseUp, true);
  doc.addEventListener('keyup', onKeyUp, true);
  doc.addEventListener('keydown', onKeyDown, true);
  w.addEventListener('scroll', hide, { capture: true, passive: true });
  w.addEventListener('resize', hide);
}

import { pickTranslationTarget, studioSelectionRuntime } from '../host/selection-overlay';
import type { StudioSelectionConfig } from '../host/selection-overlay';

let attempted = false;

function parentDocument(): { win: any; doc: Document } | null {
  try {
    const win = window.parent;
    if (!win || win === window) return null;
    return { win, doc: win.document };
  } catch {
    return null;
  }
}

/**
 * Ekko Studio 的插件桥不提供对话页浮层接口；插件 frame 又是同源且未 sandbox，
 * 因此由插件页把自包含运行时注入宿主文档，文档级导航后仍可继续工作。
 */
export function installStudioSelection(config: StudioSelectionConfig) {
  const parent = parentDocument();
  if (!parent) return;
  const { win, doc } = parent;
  if (win.__EK_TOOLS_SELECTION__) {
    win.__EK_TOOLS_SELECTION__.update(config);
    return;
  }
  if (attempted) return;
  attempted = true;
  const helper = pickTranslationTarget.toString().replace(/</g, '\\u003c');
  const source = `(${studioSelectionRuntime.toString()})(${JSON.stringify(config).replace(/</g, '\\u003c')},${helper})`;
  const inline = doc.createElement('script');
  inline.dataset.ekkoTools = 'selection-overlay';
  inline.textContent = source;
  doc.head.appendChild(inline);
  inline.remove();
  if (win.__EK_TOOLS_SELECTION__) return;
  const blob = new Blob([source], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const script = doc.createElement('script');
  script.dataset.ekkoTools = 'selection-overlay';
  script.src = url;
  script.onload = () => URL.revokeObjectURL(url);
  script.onerror = () => {
    URL.revokeObjectURL(url);
    console.warn('[ekko-tools] studio selection overlay blocked');
  };
  doc.head.appendChild(script);
}

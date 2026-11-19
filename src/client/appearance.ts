import type {ClientHost} from './adapter/host';
import {call} from './rpc-client';
import {applyStudioTheme} from './theme';
export const appearanceFonts = ['comic', 'system', 'serif', 'mono'] as const;
export type AppearanceFont = typeof appearanceFonts[number];
export interface AppearanceSettings {
  followStudio: boolean;
  font: AppearanceFont;
  fontSize: number;
  radius: number;
  controlHeight: number;
  borderWidth: number;
  spacing: number;
  letterSpacing: number;
  accent: string;
  overlay: number;
  blur: number;
  backgroundName: string;
}
export const appearanceDefaults: AppearanceSettings = {
  followStudio: true,
  font: 'comic',
  fontSize: 14,
  radius: 23,
  controlHeight: 41,
  borderWidth: 2.5,
  spacing: 1.1,
  letterSpacing: -0.6,
  accent: '#4266a7',
  overlay: 0,
  blur: 0,
  backgroundName: ''
};
const fontStacks: Record<AppearanceFont, string> = {
  comic: '"Comic Neue","ZCOOL KuaiLe","Zen Maru Gothic","Gaegu",cursive,sans-serif',
  system: '"Microsoft YaHei UI","Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif',
  serif: '"Noto Serif SC","Songti SC","SimSun",serif',
  mono: '"JetBrains Mono","Fira Code",Consolas,monospace'
};
let current: AppearanceSettings = {...appearanceDefaults};
let currentBackgroundUrl = '';
let revision = 0;
export function currentAppearance() { return current; }
export function currentBackground() { return currentBackgroundUrl; }
function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.min(max, Math.max(min, number)) * 100) / 100 : fallback;
}
export function normalizeAppearance(value: unknown): AppearanceSettings {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const font = appearanceFonts.includes(source.font as AppearanceFont) ? source.font as AppearanceFont : appearanceDefaults.font;
  const accent = typeof source.accent === 'string' && /^#[0-9a-f]{6}$/i.test(source.accent) ? source.accent.toLowerCase() : appearanceDefaults.accent;
  return {
    followStudio: source.followStudio !== false,
    font,
    fontSize: clamp(source.fontSize, 12, 20, appearanceDefaults.fontSize),
    radius: clamp(source.radius, 0, 32, appearanceDefaults.radius),
    controlHeight: clamp(source.controlHeight, 30, 56, appearanceDefaults.controlHeight),
    borderWidth: clamp(source.borderWidth, 1, 4, appearanceDefaults.borderWidth),
    spacing: clamp(source.spacing, 0.8, 1.6, appearanceDefaults.spacing),
    letterSpacing: clamp(source.letterSpacing, -1.5, 1.5, appearanceDefaults.letterSpacing),
    accent,
    overlay: clamp(source.overlay, 0, 0.85, appearanceDefaults.overlay),
    blur: clamp(source.blur, 0, 24, appearanceDefaults.blur),
    backgroundName: typeof source.backgroundName === 'string' ? source.backgroundName.slice(0, 120) : ''
  };
}
export function applyAppearance(value: unknown, background?: string) {
  revision += 1;
  const settings = normalizeAppearance(value);
  current = settings;
  const root = document.documentElement;
  if (settings.followStudio) {
    for (const token of ['--ek-radius-chrome', '--ek-radius-sm', '--ek-control-h-sm']) root.style.removeProperty(token);
    applyStudioTheme();
  } else {
    const font = fontStacks[settings.font];
    root.style.setProperty('--ek-font-ui', font);
    root.style.setProperty('--ek-font-read', font);
    root.style.setProperty('--ek-fs-base', `${settings.fontSize}px`);
    root.style.setProperty('--ek-radius-global', `${settings.radius}px`);
    root.style.setProperty('--ek-radius-card', `${Math.max(0, settings.radius - 2)}px`);
    root.style.setProperty('--ek-radius-input', `${Math.max(0, settings.radius - 3)}px`);
    root.style.setProperty('--ek-radius-chrome', `${Math.max(0, settings.radius - 8)}px`);
    root.style.setProperty('--ek-radius-sm', `${Math.max(0, settings.radius - 7)}px`);
    root.style.setProperty('--ek-control-h', `${settings.controlHeight}px`);
    root.style.setProperty('--ek-control-h-sm', `${Math.max(28, settings.controlHeight - 5)}px`);
    root.style.setProperty('--ek-border-w', `${settings.borderWidth}px`);
    root.style.setProperty('--ek-spacing-scale', String(settings.spacing));
    root.style.setProperty('--ek-ls', `${settings.letterSpacing}px`);
  }
  root.style.setProperty('--ek-accent', settings.accent);
  root.style.setProperty('--ek-accent-hover', `color-mix(in srgb, ${settings.accent} 82%, white)`);
  root.style.setProperty('--ek-accent-soft', `color-mix(in srgb, ${settings.accent} 28%, transparent)`);
  root.style.setProperty('--ek-bg-overlay-color', `rgba(5, 16, 33, ${settings.overlay})`);
  root.style.setProperty('--ek-bg-blur', `${settings.blur}px`);
  if (background) root.style.setProperty('--ek-user-bg-image', `url("${background}")`);
  else root.style.removeProperty('--ek-user-bg-image');
  return settings;
}
interface AppearanceResult {
  settings: unknown;
  hasBackground: boolean;
  backgroundMime?: string;
}

const uploadChunk = 675_000;
const maxBackground = 20 * 1024 * 1024;

function releaseBackground(url = '') {
  if (currentBackgroundUrl.startsWith('blob:') && currentBackgroundUrl !== url) {
    URL.revokeObjectURL(currentBackgroundUrl);
  }
  currentBackgroundUrl = url;
}

export async function loadAppearance(ctx: ClientHost) {
  const started = revision;
  const result = await call<AppearanceResult>(ctx, 'appearance.get');
  const url = result.hasBackground
    ? await readBackground(ctx, result.backgroundMime || 'image/jpeg')
    : '';
  if (started !== revision) {
    if (url && url !== currentBackgroundUrl) URL.revokeObjectURL(url);
    return {settings: current, backgroundUrl: currentBackgroundUrl};
  }
  releaseBackground(url);
  return {settings: applyAppearance(result.settings, url || undefined), backgroundUrl: url};
}

async function readBackground(ctx: ClientHost, mime: string) {
  const parts: ArrayBuffer[] = [];
  let offset = 0;
  for (;;) {
    const chunk = await call<{data: string; nextOffset: number; eof: boolean}>(
      ctx, 'appearance.background-read', {offset, length: 525_000}
    );
    parts.push(base64Bytes(chunk.data).buffer as ArrayBuffer);
    if (chunk.eof) break;
    offset = chunk.nextOffset;
  }
  return URL.createObjectURL(new Blob(parts, {type: mime}));
}

export async function saveAppearance(ctx: ClientHost, value: AppearanceSettings) {
  const settings = normalizeAppearance(value);
  applyAppearance(settings, currentBackgroundUrl || undefined);
  await call(ctx, 'appearance.save', settings);
  return settings;
}

export async function resetAppearance(ctx: ClientHost) {
  await call(ctx, 'appearance.reset');
  releaseBackground();
  return applyAppearance(appearanceDefaults);
}

export async function uploadAppearanceBackground(ctx: ClientHost, file: File) {
  const mime = await imageMime(file);
  if (!mime) throw new Error('请选择 JPG、PNG 或 WebP 图片');
  if (file.size > maxBackground) throw new Error('背景图片不能超过 20MB');
  const name = (file.name.trim() || 'background').slice(0, 120);
  const previousSettings = {...current}, previousUrl = currentBackgroundUrl;
  const preview = URL.createObjectURL(file);
  applyAppearance({...current, backgroundName: name}, preview);
  try {
    const {uploadId} = await call<{uploadId: string}>(ctx, 'appearance.background-start', {name, mime});
    for (let offset = 0; offset < file.size; offset += uploadChunk) {
      const bytes = new Uint8Array(await file.slice(offset, offset + uploadChunk).arrayBuffer());
      await call(ctx, 'appearance.background-chunk', {uploadId, data: bytesBase64(bytes)});
    }
    const result = await call<{saved: boolean; name: string; bytes: number}>(
      ctx, 'appearance.background-complete', {uploadId, name, mime}
    );
    releaseBackground(preview);
    applyAppearance({...current, backgroundName: result.name}, preview);
    return {...result, url: preview};
  } catch (error) {
    URL.revokeObjectURL(preview);
    applyAppearance(previousSettings, previousUrl || undefined);
    throw error;
  }
}

export async function removeAppearanceBackground(ctx: ClientHost) {
  await call(ctx, 'appearance.background-clear');
  releaseBackground();
  applyAppearance({...current, backgroundName: ''});
}

function base64Bytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function imageMime(file: File) {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = (start: number, end: number) => String.fromCharCode(...head.subarray(start, end));
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head[0] === 0x89 && ascii(1, 4) === 'PNG' && head[4] === 0x0d && head[5] === 0x0a) return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return '';
}

function bytesBase64(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

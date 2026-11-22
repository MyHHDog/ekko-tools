import type {ClientHost} from './adapter/host';
import {call, RpcError} from './rpc-client';
import {applyStudioTheme} from './theme';
import {writeAppearanceCache} from './bootstrap-cache';
import {appearanceDefaults, appearanceRegionDefaults, appearanceRegions, normalizeAppearance} from '../shared/appearance';
import {encodeAppearanceSave} from '../shared/appearance-wire';
import type {
  AppearanceBackgroundPosition, AppearanceFont, AppearanceRegion, AppearanceSettings
} from '../shared/appearance';
export {
  appearanceBackgroundPositions, appearanceBackgroundSizes, appearanceDefaults, appearanceFonts,
  appearancePalettes, appearanceRegionDefaults, appearanceRegions, appearanceSchemes, normalizeAppearance
} from '../shared/appearance';
export type {
  AppearanceBackgroundPosition, AppearanceBackgroundSize, AppearanceFont, AppearanceRegion,
  AppearanceScheme, AppearanceSettings, AppearanceSurface
} from '../shared/appearance';
export const backgroundSlots = ['desktop', 'mobile'] as const;
export type BackgroundSlot = typeof backgroundSlots[number];
export type BackgroundUrls = Record<BackgroundSlot, string>;
const fontStacks: Record<AppearanceFont, string> = {
  comic: '"Comic Neue","ZCOOL KuaiLe","Zen Maru Gothic","Gaegu",cursive,sans-serif',
  system: '"Microsoft YaHei UI","Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif',
  serif: '"Noto Serif SC","Songti SC","SimSun",serif',
  mono: '"JetBrains Mono","Fira Code",Consolas,monospace'
};
type RegionTokens = {
  backgrounds: string[]; glass: string; filter: string; radius: string;
  border: string; shadow: string;
};
const regionTokens: Record<AppearanceRegion, RegionTokens> = {
  chrome: {
    backgrounds: ['--ek-bg-shell'], glass: '--ek-glass-chrome-bg',
    filter: '--ek-glass-chrome-filter', radius: '--ek-radius-chrome',
    border: '--ek-border-chrome', shadow: '--ek-shadow-chrome'
  },
  sidebar: {
    backgrounds: ['--ek-bg-sidebar'], glass: '--ek-glass-sidebar-bg',
    filter: '--ek-glass-sidebar-filter', radius: '--ek-radius-sidebar',
    border: '--ek-border-sidebar', shadow: '--ek-shadow-sidebar'
  },
  content: {
    backgrounds: ['--ek-bg-content'], glass: '--ek-glass-content-bg',
    filter: '--ek-glass-content-filter', radius: '--ek-radius-content',
    border: '--ek-border-content', shadow: '--ek-shadow-content'
  },
  card: {
    backgrounds: ['--ek-bg-surface', '--ek-bg-panel-2'], glass: '--ek-glass-card-bg',
    filter: '--ek-glass-card-filter', radius: '--ek-radius-card',
    border: '--ek-border-card', shadow: '--ek-shadow-card'
  },
  input: {
    backgrounds: ['--ek-bg-input', '--ek-bg-surface-2'], glass: '--ek-glass-input-bg',
    filter: '--ek-glass-input-filter', radius: '--ek-radius-input',
    border: '--ek-border-input', shadow: '--ek-shadow-input'
  },
  overlay: {
    backgrounds: ['--ek-bg-raised'], glass: '--ek-glass-overlay-bg',
    filter: '--ek-glass-overlay-filter', radius: '--ek-radius-overlay',
    border: '--ek-border-overlay', shadow: '--ek-shadow-overlay'
  }
};
const customTokens = [
  '--ek-font-ui', '--ek-font-read', '--ek-fs-base', '--ek-lh', '--ek-ls', '--ek-ls-sm',
  '--ek-radius-global', '--ek-radius-chrome', '--ek-radius-card', '--ek-radius-input',
  '--ek-radius-sidebar', '--ek-radius-content', '--ek-radius-overlay', '--ek-radius-sm',
  '--ek-control-h', '--ek-control-h-sm', '--ek-border-w', '--ek-spacing-scale',
  '--ek-bg-page', '--ek-bg-solid', '--ek-bg-base', '--ek-bg-shell', '--ek-bg-sidebar',
  '--ek-bg-panel', '--ek-bg-content', '--ek-bg-panel-2', '--ek-bg-surface', '--ek-bg-surface-2',
  '--ek-bg-input', '--ek-bg-raised', '--ek-bg-blur', '--ek-bg-gradient',
  '--ek-glass-chrome-bg', '--ek-glass-sidebar-bg', '--ek-glass-content-bg',
  '--ek-glass-card-bg', '--ek-glass-input-bg', '--ek-glass-overlay-bg',
  '--ek-glass-chrome-filter', '--ek-glass-sidebar-filter', '--ek-glass-content-filter',
  '--ek-glass-card-filter', '--ek-glass-input-filter', '--ek-glass-overlay-filter',
  '--ek-text', '--ek-text-2', '--ek-text-muted', '--ek-link', '--ek-focus',
  '--ek-border', '--ek-border-light', '--ek-border-chrome', '--ek-border-sidebar',
  '--ek-border-content', '--ek-border-card', '--ek-border-input', '--ek-border-overlay',
  '--ek-glass-border', '--ek-accent', '--ek-on-accent', '--ek-accent-hover', '--ek-accent-soft',
  '--ek-shadow', '--ek-shadow-color', '--ek-shadow-comic', '--ek-shadow-float',
  '--ek-shadow-chrome', '--ek-shadow-sidebar', '--ek-shadow-content', '--ek-shadow-card',
  '--ek-shadow-input', '--ek-shadow-overlay', '--ek-content-max',
  '--ek-user-bg-size', '--ek-user-bg-position'
];
const backgroundPositions: Record<AppearanceBackgroundPosition, string> = {
  center: 'center', top: 'center top', bottom: 'center bottom',
  left: 'left center', right: 'right center'
};
function mobileEnvironment() {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') return window.matchMedia('(max-width: 760px)').matches;
  return window.innerWidth <= 760;
}
let current: AppearanceSettings = {...appearanceDefaults};
let currentBackgroundUrls: BackgroundUrls = {desktop: '', mobile: ''};
type BackgroundIdentity = {name: string; bytes: number};
let currentBackgroundIdentity: Record<BackgroundSlot, BackgroundIdentity> = {
  desktop: {name: '', bytes: 0},
  mobile: {name: '', bytes: 0}
};
let revision = 0;
let backgroundRevision = 0;
const pendingBackgroundSlots = new Map<BackgroundSlot, number>();
let loading: Promise<AppearanceLoadResult> | undefined;
export function currentAppearance() { return current; }
export function currentBackgrounds() { return {...currentBackgroundUrls}; }
export function currentBackground() {
  return mobileEnvironment() && currentBackgroundUrls.mobile
    ? currentBackgroundUrls.mobile
    : currentBackgroundUrls.desktop;
}
export interface AppearanceLoadResult {
  settings: AppearanceSettings;
  backgrounds: BackgroundUrls;
}
function accentLuminance(hex: string) {
  const channels = [1, 3, 5].map(offset => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function withOpacity(color: string, opacity: number) {
  if (opacity >= 0.999) return color;
  return `color-mix(in srgb, ${color} ${Math.round(opacity * 1000) / 10}%, transparent)`;
}
function shadowValue(strength: number, floating = false) {
  if (strength <= 0) return 'none';
  const alpha = Math.min(floating ? 0.48 : 0.34, strength * (floating ? 0.18 : 0.12));
  return floating ? `0 12px 32px rgb(0 0 0 / ${Math.round(alpha * 100)}%)`
    : `0 8px 24px rgb(0 0 0 / ${Math.round(alpha * 100)}%)`;
}
function regionColor(settings: AppearanceSettings, region: AppearanceRegion) {
  const override = settings.regions[region]?.backgroundColor;
  if (override) return override;
  if (region === 'chrome') return settings.pageColor;
  if (region === 'input') return settings.surfaceColor;
  return settings.surfaceColor;
}
function regionOpacity(settings: AppearanceSettings, region: AppearanceRegion) {
  return settings.regions[region]?.opacity ?? settings.opacity ?? appearanceRegionDefaults[region].opacity;
}
function regionBlur(settings: AppearanceSettings, region: AppearanceRegion) {
  return settings.regions[region]?.blur ?? settings.blur;
}
function regionRadius(settings: AppearanceSettings, region: AppearanceRegion) {
  const override = settings.regions[region]?.radius;
  if (override !== undefined) return override;
  if (region === 'card' || region === 'overlay' || region === 'chrome') return settings.radius;
  if (region === 'input') return Math.max(0, settings.radius - 2);
  return 0;
}
function regionBorder(settings: AppearanceSettings, region: AppearanceRegion) {
  return settings.regions[region]?.borderColor ?? settings.borderColor;
}
function regionShadow(settings: AppearanceSettings, region: AppearanceRegion) {
  return settings.regions[region]?.shadow ?? settings.shadow;
}
export function applyAppearance(value: unknown, backgrounds?: Partial<BackgroundUrls>, repaint = true) {
  revision += 1;
  const settings = normalizeAppearance(value);
  current = settings;
  const root = document.documentElement;
  if (settings.followStudio) {
    for (const token of customTokens) root.style.removeProperty(token);
    applyStudioTheme();
  } else {
    for (const token of customTokens) root.style.removeProperty(token);
    const font = fontStacks[settings.font];
    const borderLight = `color-mix(in srgb, ${settings.borderColor} 58%, ${settings.pageColor})`;
    root.style.setProperty('--ek-font-ui', font);
    root.style.setProperty('--ek-font-read', font);
    root.style.setProperty('--ek-fs-base', `${settings.fontSize}px`);
    root.style.setProperty('--ek-lh', String(settings.lineHeight));
    root.style.setProperty('--ek-lh-read', String(settings.lineHeight));
    root.style.setProperty('--ek-radius-global', `${settings.radius}px`);
    root.style.setProperty('--ek-radius-card', `${settings.radius}px`);
    root.style.setProperty('--ek-radius-input', `${Math.max(0, settings.radius - 2)}px`);
    root.style.setProperty('--ek-radius-chrome', `${settings.radius}px`);
    root.style.setProperty('--ek-radius-sidebar', '0px');
    root.style.setProperty('--ek-radius-content', '0px');
    root.style.setProperty('--ek-radius-overlay', `${settings.radius}px`);
    root.style.setProperty('--ek-radius-sm', `${Math.max(0, settings.radius - 2)}px`);
    root.style.setProperty('--ek-control-h', `${settings.controlHeight}px`);
    root.style.setProperty('--ek-control-h-sm', `${Math.max(28, settings.controlHeight - 4)}px`);
    root.style.setProperty('--ek-border-w', `${settings.borderWidth}px`);
    root.style.setProperty('--ek-spacing-scale', String(settings.spacing));
    root.style.setProperty('--ek-ls', `${settings.letterSpacing}px`);
    root.style.setProperty('--ek-ls-sm', `${settings.letterSpacing}px`);
    root.style.setProperty('--ek-bg-page', settings.pageColor);
    root.style.setProperty('--ek-bg-solid', settings.pageColor);
    root.style.setProperty('--ek-bg-base', settings.pageColor);
    root.style.setProperty('--ek-bg-panel', regionColor(settings, 'sidebar'));
    root.style.setProperty('--ek-text', settings.textColor);
    root.style.setProperty('--ek-text-2', settings.secondaryTextColor);
    root.style.setProperty('--ek-text-muted', settings.mutedTextColor);
    root.style.setProperty('--ek-link', settings.linkColor);
    root.style.setProperty('--ek-border', settings.borderColor);
    root.style.setProperty('--ek-border-light', borderLight);
    const lightAccent = accentLuminance(settings.accent) > 0.179;
    root.style.setProperty('--ek-accent', settings.accent);
    root.style.setProperty('--ek-on-accent', lightAccent ? '#1a1a1a' : '#ffffff');
    root.style.setProperty('--ek-accent-hover', `color-mix(in srgb, ${settings.accent} 87%, ${lightAccent ? 'white' : 'black'})`);
    root.style.setProperty('--ek-accent-soft', `color-mix(in srgb, ${settings.accent} 13%, var(--ek-bg-surface))`);
    root.style.setProperty('--ek-focus', `color-mix(in srgb, ${settings.accent} 72%, ${settings.textColor})`);
    root.style.setProperty('--ek-content-max', `${settings.contentWidth}px`);
    root.style.setProperty('--ek-user-bg-size', settings.backgroundSize);
    root.style.setProperty('--ek-user-bg-position', backgroundPositions[settings.backgroundPosition]);
    root.style.setProperty('--ek-shadow', shadowValue(settings.shadow));
    root.style.setProperty('--ek-shadow-color',
      settings.shadow > 0 ? `rgb(0 0 0 / ${Math.round(Math.min(0.32, settings.shadow * 0.12) * 100)}%)` : 'transparent');
    root.style.setProperty('--ek-shadow-comic', shadowValue(settings.shadow));
    root.style.setProperty('--ek-shadow-float', shadowValue(settings.shadow, true));
    for (const region of appearanceRegions) {
      const tokens = regionTokens[region];
      const background = regionColor(settings, region);
      const filter = regionBlur(settings, region);
      const border = regionBorder(settings, region);
      for (const token of tokens.backgrounds) root.style.setProperty(token, background);
      root.style.setProperty(tokens.glass, withOpacity(background, regionOpacity(settings, region)));
      root.style.setProperty(tokens.filter, filter > 0 ? `blur(${filter}px) saturate(1.1)` : 'none');
      root.style.setProperty(tokens.radius, `${regionRadius(settings, region)}px`);
      root.style.setProperty(tokens.border, border);
      root.style.setProperty(tokens.shadow, shadowValue(regionShadow(settings, region), region === 'overlay'));
    }
    root.style.setProperty('--ek-glass-border', regionBorder(settings, 'card'));
    if (settings.gradientColor) {
      root.style.setProperty('--ek-bg-gradient',
        `linear-gradient(${settings.gradientAngle}deg, ${settings.pageColor}, ${settings.gradientColor})`);
    }
    root.dataset.ekStudioTheme = settings.colorScheme;
    root.dataset.ekStudioSurface = 'custom';
    root.style.colorScheme = settings.colorScheme;
  }
  root.style.setProperty('--ek-bg-overlay-color', `rgb(0 0 0 / ${settings.overlay})`);
  if (!settings.followStudio) root.style.setProperty('--ek-bg-blur', `${settings.blur}px`);
  if (backgrounds) replaceBackgrounds(backgrounds);
  else if (repaint) paintBackground();
  return settings;
}
interface AppearanceResult {
  settings: unknown;
  hasBackground: boolean;
  backgroundName?: string;
  backgroundMime?: string;
  backgroundBytes?: number;
  hasMobileBackground?: boolean;
  mobileBackgroundName?: string;
  mobileBackgroundMime?: string;
  mobileBackgroundBytes?: number;
}

const uploadChunk = 675_000;
const readChunk = 525_000;
const maxBackground = 20 * 1024 * 1024;
const appearanceTimeoutMs = 15_000;
const saveVerificationTimeoutMs = 5_000;

function callAppearance<T = any>(ctx: ClientHost, name: string, input?: unknown) {
  return call<T>(ctx, name, input, appearanceTimeoutMs);
}

function paintBackground() {
  const root = document.documentElement;
  const {desktop, mobile} = currentBackgroundUrls;
  root.toggleAttribute('data-ek-custom-background', Boolean(desktop || mobile || current.gradientColor));
  if (desktop) root.style.setProperty('--ek-user-bg-image', `url("${desktop}")`);
  else root.style.removeProperty('--ek-user-bg-image');
  if (mobile) root.style.setProperty('--ek-user-bg-image-mobile', `url("${mobile}")`);
  else root.style.removeProperty('--ek-user-bg-image-mobile');
}

function revokeBackground(url: string) {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url);
}

function replaceBackgrounds(next: Partial<BackgroundUrls>) {
  let changed = false;
  for (const slot of backgroundSlots) {
    const url = next[slot] ?? currentBackgroundUrls[slot];
    if (url === currentBackgroundUrls[slot]) continue;
    revokeBackground(currentBackgroundUrls[slot]);
    currentBackgroundUrls[slot] = url;
    changed = true;
  }
  if (changed) backgroundRevision += 1;
  paintBackground();
}

function releaseBackgrounds() {
  for (const slot of backgroundSlots) revokeBackground(currentBackgroundUrls[slot]);
  currentBackgroundUrls = {desktop: '', mobile: ''};
  currentBackgroundIdentity = {desktop: {name: '', bytes: 0}, mobile: {name: '', bytes: 0}};
  backgroundRevision += 1;
  paintBackground();
}

function backgroundChangedSince(started: number, startedBackgrounds: number) {
  return started !== revision || startedBackgrounds !== backgroundRevision || pendingBackgroundSlots.size > 0;
}

function appearanceSnapshot(): AppearanceLoadResult {
  return {settings: current, backgrounds: currentBackgrounds()};
}

export function loadAppearance(ctx: ClientHost): Promise<AppearanceLoadResult> {
  if (loading) return loading;
  const task = performLoad(ctx);
  loading = task;
  const clear = () => { if (loading === task) loading = undefined; };
  void task.then(clear, clear);
  return task;
}

export function refreshAppearance(ctx: ClientHost): Promise<AppearanceLoadResult> {
  if (!loading) return loadAppearance(ctx);
  return loading.catch(() => undefined).then(() => loadAppearance(ctx));
}

async function performLoad(ctx: ClientHost): Promise<AppearanceLoadResult> {
  const started = revision;
  const startedBackgrounds = backgroundRevision;
  const result = await callAppearance<AppearanceResult>(ctx, 'appearance.get');
  if (backgroundChangedSince(started, startedBackgrounds)) return appearanceSnapshot();
  const [desktop, mobile] = await Promise.all([readSlot(ctx, result, 'desktop'), readSlot(ctx, result, 'mobile')]);
  const reads: Record<BackgroundSlot, SlotRead> = {desktop, mobile};
  if (backgroundChangedSince(started, startedBackgrounds)) {
    for (const slot of backgroundSlots) {
      const read = reads[slot];
      if (read.state === 'ready' && read.url !== currentBackgroundUrls[slot]) revokeBackground(read.url);
    }
    return appearanceSnapshot();
  }
  const backgrounds: BackgroundUrls = {
    desktop: resolveBackgroundUrl(reads.desktop, 'desktop'),
    mobile: resolveBackgroundUrl(reads.mobile, 'mobile')
  };
  const identities = {...currentBackgroundIdentity};
  for (const slot of backgroundSlots) {
    const read = reads[slot];
    if (read.state === 'absent') identities[slot] = {name: '', bytes: 0};
    else if (read.state === 'ready') identities[slot] = backgroundIdentity(result, slot);
  }
  const settings = applyAppearance(result.settings, backgrounds);
  currentBackgroundIdentity = identities;
  writeAppearanceCache(ctx, settings, currentBackgrounds());
  return {settings, backgrounds: currentBackgrounds()};
}

type SlotRead =
  | {state: 'ready'; url: string}
  | {state: 'absent'}
  | {state: 'failed'};

async function readSlot(ctx: ClientHost, result: AppearanceResult, slot: BackgroundSlot): Promise<SlotRead> {
  const present = slot === 'mobile' ? result.hasMobileBackground : result.hasBackground;
  if (!present) return {state: 'absent'};
  const identity = backgroundIdentity(result, slot);
  const known = currentBackgroundIdentity[slot];
  if (identity.name && currentBackgroundUrls[slot] && known.name === identity.name && known.bytes === identity.bytes) {
    return {state: 'ready', url: currentBackgroundUrls[slot]};
  }
  const mime = slot === 'mobile' ? result.mobileBackgroundMime : result.backgroundMime;
  const bytes = slot === 'mobile' ? result.mobileBackgroundBytes : result.backgroundBytes;
  try {
    return {state: 'ready', url: await readBackground(ctx, mime || 'image/jpeg', slot, bytes)};
  } catch {
    return {state: 'failed'};
  }
}

function backgroundIdentity(result: AppearanceResult, slot: BackgroundSlot): BackgroundIdentity {
  const name = slot === 'mobile' ? result.mobileBackgroundName : result.backgroundName;
  const bytes = slot === 'mobile' ? result.mobileBackgroundBytes : result.backgroundBytes;
  return {name: name || '', bytes: Math.max(0, Number(bytes) || 0)};
}

function resolveBackgroundUrl(read: SlotRead, slot: BackgroundSlot) {
  if (read.state === 'ready') return read.url;
  if (read.state === 'failed' || pendingBackgroundSlots.has(slot)) return currentBackgroundUrls[slot];
  return '';
}

async function readBackground(ctx: ClientHost, mime: string, slot: BackgroundSlot, bytes?: number) {
  if (bytes && bytes > readChunk) {
    const offsets: number[] = [];
    for (let offset = 0; offset < bytes; offset += readChunk) offsets.push(offset);
    const parts = new Array<ArrayBuffer>(offsets.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < offsets.length) {
        const index = cursor++;
        const chunk = await callAppearance<{data: string; nextOffset: number; eof: boolean}>(
          ctx, 'appearance.background-read', {offset: offsets[index], length: readChunk, slot}
        );
        parts[index] = base64Bytes(chunk.data).buffer as ArrayBuffer;
      }
    };
    await Promise.all(Array.from({length: Math.min(4, offsets.length)}, worker));
    return URL.createObjectURL(new Blob(parts, {type: mime}));
  }
  const parts: ArrayBuffer[] = [];
  let offset = 0;
  for (;;) {
    const chunk = await callAppearance<{data: string; nextOffset: number; eof: boolean}>(
      ctx, 'appearance.background-read', {offset, length: readChunk, slot}
    );
    parts.push(base64Bytes(chunk.data).buffer as ArrayBuffer);
    if (chunk.eof) break;
    offset = chunk.nextOffset;
  }
  return URL.createObjectURL(new Blob(parts, {type: mime}));
}

export async function saveAppearance(ctx: ClientHost, value: AppearanceSettings, requestId: string) {
  const settings = normalizeAppearance(value);
  applyAppearance(settings);
  try {
    await call(ctx, 'appearance.save', {wire: encodeAppearanceSave(settings)}, appearanceTimeoutMs, requestId);
  } catch (error) {
    if (!(error instanceof RpcError) || error.info.code !== 'TIMEOUT' || ctx.signal.aborted) throw error;
    const persisted = await call<AppearanceResult>(ctx, 'appearance.get', undefined, saveVerificationTimeoutMs, `${requestId}-check`)
      .catch(() => undefined);
    if (ctx.signal.aborted || !persisted?.settings ||
        comparableAppearance(normalizeAppearance(persisted.settings)) !== comparableAppearance(settings)) throw error;
  }
  writeAppearanceCache(ctx, settings, currentBackgrounds());
  return settings;
}

function comparableAppearance(settings: AppearanceSettings) {
  return JSON.stringify({...settings, backgroundName: undefined, backgroundMobileName: undefined});
}

export async function resetAppearance(ctx: ClientHost) {
  await callAppearance(ctx, 'appearance.reset');
  releaseBackgrounds();
  const settings = applyAppearance(appearanceDefaults);
  writeAppearanceCache(ctx, settings, currentBackgrounds());
  return settings;
}

export async function uploadAppearanceBackground(
  ctx: ClientHost,
  file: File,
  slot: BackgroundSlot = 'desktop',
  onPreview?: (url: string) => void
) {
  const mime = await imageMime(file);
  if (!mime) throw new Error('请选择 JPG、PNG 或 WebP 图片');
  if (file.size > maxBackground) throw new Error('背景图片不能超过 20MB');
  const name = (file.name.trim() || 'background').slice(0, 120);
  const nameKey = slot === 'mobile' ? 'backgroundMobileName' : 'backgroundName';
  const previousSettings = {...current}, previousBackgrounds = currentBackgrounds();
  const previousIdentity = {...currentBackgroundIdentity};
  const preview = URL.createObjectURL(file);
  pendingBackgroundSlots.set(slot, (pendingBackgroundSlots.get(slot) || 0) + 1);
  applyAppearance({...current, [nameKey]: name}, {...currentBackgrounds(), [slot]: preview});
  currentBackgroundIdentity[slot] = {name, bytes: file.size};
  onPreview?.(preview);
  try {
    const {uploadId} = await callAppearance<{uploadId: string}>(ctx, 'appearance.background-start', {name, mime, slot});
    for (let offset = 0; offset < file.size; offset += uploadChunk) {
      const bytes = new Uint8Array(await file.slice(offset, offset + uploadChunk).arrayBuffer());
      await callAppearance(ctx, 'appearance.background-chunk', {uploadId, data: bytesBase64(bytes)});
    }
    const result = await callAppearance<{saved: boolean; name: string; bytes: number}>(
      ctx, 'appearance.background-complete', {uploadId, name, mime, slot}
    );
    const settings = applyAppearance({...current, [nameKey]: result.name});
    currentBackgroundIdentity[slot] = {name: result.name, bytes: result.bytes};
    writeAppearanceCache(ctx, settings, currentBackgrounds());
    return {...result, url: preview, slot};
  } catch (error) {
    currentBackgroundIdentity = previousIdentity;
    applyAppearance(previousSettings, previousBackgrounds);
    writeAppearanceCache(ctx, previousSettings, previousBackgrounds);
    throw error;
  } finally {
    const remaining = (pendingBackgroundSlots.get(slot) || 1) - 1;
    if (remaining > 0) pendingBackgroundSlots.set(slot, remaining);
    else pendingBackgroundSlots.delete(slot);
  }
}

export async function removeAppearanceBackground(ctx: ClientHost, slot: BackgroundSlot = 'desktop') {
  await callAppearance(ctx, 'appearance.background-clear', {slot});
  const nameKey = slot === 'mobile' ? 'backgroundMobileName' : 'backgroundName';
  const settings = applyAppearance({...current, [nameKey]: ''}, {...currentBackgrounds(), [slot]: ''});
  currentBackgroundIdentity[slot] = {name: '', bytes: 0};
  writeAppearanceCache(ctx, settings, currentBackgrounds());
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

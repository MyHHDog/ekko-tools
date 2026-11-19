import type { Bootstrap } from '../shared/rpc-contract';
import type { ClientHost } from './adapter/host';
import type { AppearanceSettings } from './appearance';

const store = new Map<string, Bootstrap>();
const MAX_ENTRIES = 6;
const NAME_PREFIX = 'ekko-tools:page-cache:';
interface PageCache {
  key: string;
  boot?: Bootstrap;
  appearance?: AppearanceSettings;
  views?: Record<string, unknown>;
}

function cacheKey(ctx: ClientHost) {
  if (!ctx.plugin?.id || !ctx.identity) return '';
  const identity = ctx.identity;
  return [ctx.plugin.id, identity.userId, identity.profile].join('\u0000');
}

export function readBootstrapCache(ctx: ClientHost) {
  const key = cacheKey(ctx);
  if (!key) return undefined;
  return store.get(key) ?? readPageCache(key)?.boot;
}

export function writeBootstrapCache(ctx: ClientHost, value: Bootstrap) {
  const key = cacheKey(ctx);
  if (!key) return;
  store.delete(key);
  store.set(key, value);
  if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value!);
  writePageCache({ ...readPageCache(key), key, boot: value });
}

export function readAppearanceCache(ctx: ClientHost) {
  const key = cacheKey(ctx);
  return key ? readPageCache(key)?.appearance : undefined;
}

export function writeAppearanceCache(ctx: ClientHost, value: AppearanceSettings) {
  const key = cacheKey(ctx);
  if (key) writePageCache({ ...readPageCache(key), key, appearance: value });
}

export function readViewCache<T>(ctx: ClientHost, name: string) {
  const key = cacheKey(ctx);
  return key ? (readPageCache(key)?.views?.[name] as T | undefined) : undefined;
}

export function writeViewCache(ctx: ClientHost, name: string, value: unknown) {
  const key = cacheKey(ctx);
  if (!key) return;
  const current = readPageCache(key);
  writePageCache({ ...current, key, views: { ...current?.views, [name]: value } });
}

function readPageCache(key: string): PageCache | undefined {
  if (typeof window === 'undefined' || !window.name.startsWith(NAME_PREFIX)) return undefined;
  try {
    const value = JSON.parse(window.name.slice(NAME_PREFIX.length)) as PageCache;
    return value && value.key === key ? value : undefined;
  } catch {
    return undefined;
  }
}

function writePageCache(value: PageCache) {
  if (typeof window === 'undefined') return;
  try {
    window.name = NAME_PREFIX + JSON.stringify(value);
  } catch {
    // 缓存失败不影响正常渲染。
  }
}

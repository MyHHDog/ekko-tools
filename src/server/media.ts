import type { Lifecycle } from './adapter/host';
import { image } from './mail/images';

const MAX_ENTRIES = 160;
const SUCCESS_TTL = 6 * 60 * 60 * 1000;
const FAILURE_TTL = 30 * 1000;

type Entry = { data: string; at: number };

// 移动端 WebView 常拦截插件 iframe 的外链图片；统一由服务端取回 data URL。
export class ImageProxy {
  private cache = new Map<string, Entry>();
  private pending = new Map<string, Promise<string>>();

  constructor(private lifecycle: Lifecycle) {}

  async load(value: string, signal: AbortSignal) {
    let url: string;
    try {
      const parsed = new URL(value);
      if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return '';
      url = parsed.toString();
    } catch {
      return '';
    }
    const hit = this.cache.get(url);
    if (hit && Date.now() - hit.at < (hit.data ? SUCCESS_TTL : FAILURE_TTL)) return hit.data;
    const active = this.pending.get(url);
    if (active) return active;
    const task = image(url, signal, this.lifecycle, [], false)
      .catch(() => '')
      .then(data => {
        this.pending.delete(url);
        this.remember(url, data);
        return data;
      });
    this.pending.set(url, task);
    return task;
  }

  private remember(url: string, data: string) {
    this.cache.delete(url);
    this.cache.set(url, { data, at: Date.now() });
    while (this.cache.size > MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  clear() {
    this.cache.clear();
    this.pending.clear();
  }
}

import { useEffect, useState } from 'react';
import type { ClientHost } from '../adapter/host';
import { call } from '../rpc-client';

type Entry = { data: string; at: number };
const cache = new Map<string, Entry>(), pending = new Map<string, Promise<string>>();
const SUCCESS_TTL = 6 * 60 * 60 * 1000, FAILURE_TTL = 30 * 1000;
const direct = (url: string) => /^(data:|blob:)/i.test(url);

export function useRemoteImage(ctx: ClientHost | undefined, url: string | undefined) {
  const [src, setSrc] = useState(() => url && direct(url) ? url : '');
  useEffect(() => {
    if (!url) { setSrc(''); return; }
    if (direct(url)) { setSrc(url); return; }
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < (hit.data ? SUCCESS_TTL : FAILURE_TTL)) {
      setSrc(hit.data);
      return;
    }
    setSrc('');
    let active = true;
    let task = pending.get(url);
    if (!task && ctx) {
      task = call<{ data: string }>(ctx, 'media.image', { url })
        .then(result => result?.data || '')
        .catch(() => '');
      pending.set(url, task);
      void task.then(data => { cache.set(url, { data, at: Date.now() }); pending.delete(url); });
    }
    if (!task) return;
    void task.then(data => { if (active) setSrc(data); });
    return () => { active = false; };
  }, [ctx, url]);
  return src;
}

export function clearRemoteImageCache() {
  cache.clear();
  pending.clear();
}

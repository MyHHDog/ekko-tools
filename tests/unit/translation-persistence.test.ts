import { describe, expect, it } from 'vitest';
import type { TranslationJob } from '../../src/shared/types';
import { memoryStorage } from '../harness-host';
import { TranslationHistory } from '../../src/server/translate/history';
import { TranslationCache } from '../../src/server/translate/cache';

function job(id: string, at: number): TranslationJob {
  return {
    id, status: 'done', createdAt: at, attempts: 1,
    request: { text: `text-${id}`, from: 'en', to: 'zh', provider: 'hostModel' },
    result: { provider: 'hostModel', translated: `译文-${id}`, latencyMs: 1 },
  };
}

describe('翻译持久化边界', () => {
  it('并发追加历史不丢记录，并稳定保留最近 50 条', async () => {
    const history = new TranslationHistory(memoryStorage());
    await Promise.all(Array.from({ length: 80 }, (_, index) => history.add(job(`job-${index}`, index))));
    const items = await history.list(50);
    expect(items).toHaveLength(50);
    expect(new Set(items.map(item => item.id)).size).toBe(50);
    expect(items.every(item => item.id.startsWith('job-'))).toBe(true);
  });

  it('并发写翻译缓存不会互相覆盖，仍按条数上限淘汰', async () => {
    const cache = new TranslationCache(memoryStorage());
    await Promise.all(Array.from({ length: 120 }, (_, index) => cache.put(`key-${index}`, job(`cache-${index}`, index))));
    expect((await cache.stats()).entries).toBe(100);
    expect((await cache.clear()).cleared).toBe(100);
    expect((await cache.stats()).entries).toBe(0);
  });
});

import type { TranslationJob } from '../../shared/types';
import type { Storage } from '../adapter/host';

const MAX_ENTRIES = 50;

// 翻译历史是用户可见记录，但单条很小；用宿主持久键值库保存，同时串行读改写避免并发覆盖。
export class TranslationHistory {
  private mutation: Promise<unknown> = Promise.resolve();

  constructor(private store: Storage) {}

  bind(store: Storage) {
    this.store = store;
  }

  private queue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.mutation.catch(() => undefined).then(work);
    this.mutation = next.then(() => undefined, () => undefined);
    return next;
  }

  async list(limit = 20): Promise<TranslationJob[]> {
    const value = await this.store.get<TranslationJob[]>('history');
    const items = Array.isArray(value) ? value : [];
    return items.slice(0, Math.max(1, Math.min(limit, MAX_ENTRIES)));
  }

  add(job: TranslationJob): Promise<void> {
    return this.queue(async () => {
      const old = await this.list(MAX_ENTRIES);
      const next = [job, ...old.filter(item => item.id !== job.id)].slice(0, MAX_ENTRIES);
      await this.store.set('history', next);
    });
  }
}

import { apply } from '../src/server/index';
import type { Dependencies } from '../src/server/index';
import type { Dispose, Host, Run, Storage } from '../src/server/adapter/host';
import { FixtureConnector } from './fixtures/connector';

export function memoryStorage(data = new Map<string, any>(), segments: string[] = []): Storage {
  const key = (name: string) => JSON.stringify([...segments, name]);
  return {
    namespace: (...next) => memoryStorage(data, [...segments, ...next]),
    get: async name => structuredClone(data.get(key(name))),
    set: async (name, value) => { data.set(key(name), structuredClone(value)); },
    delete: async name => { data.delete(key(name)); },
    keys: async () => [...data.keys()]
      .filter(item => JSON.parse(item).slice(0, -1).join('/') === segments.join('/'))
      .map(item => JSON.parse(item).at(-1)),
  };
}

export function lifecycle() {
  const handles = new Set<Dispose>();
  return {
    handles,
    add(fn: Dispose) {
      let active = true;
      const release = () => { if (!active) return; active = false; handles.delete(release); return fn(); };
      handles.add(release);
      return release;
    },
    async close() { for (const release of [...handles]) await release(); },
  };
}

export function createHarness(
  dataDir: string,
  options: Dependencies & { config?: Record<string, any>; storage?: Storage } = {},
) {
  const handlers = new Map<string, (input: any, run: Run) => Promise<any>>();
  const actions = new Map<string, any>();
  const schedules: { id: string; intervalMs: number; action: string; input: any }[] = [];
  const storage = options.storage || memoryStorage();
  const life = lifecycle();
  const controller = new AbortController();
  const events: { type: string; data: any; options?: any }[] = [];
  const logs: unknown[] = [];
  const hostModels = {
    list: async () => ({ data: [{ id: 'fixture-default', isDefault: true }] }),
    respond: async (input: any) => ({
      output_text: input.input === 'Hello world' ? '你好，世界' : `译文：${input.input}`,
    }),
  };
  const identity = { userId: 1, profile: 'test' };
  const host: Host = {
    identity,
    config: options.config || {},
    paths: { dataDir },
    signal: controller.signal,
    state: { plugin: storage },
    host: { models: hostModels },
    lifecycle: life,
    extensions: {
      rpc: { register(name, fn) { handlers.set(name, fn); return () => { handlers.delete(name); }; } },
      actions: { register(action) { actions.set(action.name, action); return () => { actions.delete(action.name); }; } },
    },
    scheduler: { every(id, intervalMs, action, input = {}) { schedules.push({ id, intervalMs, action, input }); return () => {}; } },
    log: {
      info: (message, data) => logs.push({ message, data }),
      warn: (message, data) => logs.push({ message, data }),
      error: (message, data) => logs.push({ message, data }),
    },
  };
  const stop = apply(host, { ...options, real: options.real || new FixtureConnector() });
  return {
    host, events, logs, storage, life, controller, actions, schedules,
    call(name: string, input?: any, who = identity) {
      const handler = handlers.get(name);
      if (!handler) return Promise.resolve({ ok: false, error: { code: 'NOT_FOUND', message: '未知操作', retryable: false } });
      const callController = new AbortController();
      const run: Run = {
        identity: who,
        signal: callController.signal,
        state: { plugin: storage },
        host: host.host,
        messages: { emit: (type, data, options) => events.push({ type, data, options }) },
      };
      return Promise.resolve().then(() => handler(input, run)).finally(() => callController.abort());
    },
    async close() { controller.abort(); await stop(); await life.close(); },
    async runAction(name: string, input: any = {}, who = identity) {
      const action = actions.get(name);
      if (!action) throw Error('unknown action ' + name);
      const run = {
        identity: who,
        signal: controller.signal,
        state: { plugin: storage },
        host: host.host,
        messages: { emit: (type: string, data: any, options?: any) => events.push({ type, data, options }) },
      };
      return action.execute(input, run);
    },
  };
}

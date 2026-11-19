import { describe, expect, it } from 'vitest';
import { readBootstrapCache, writeBootstrapCache } from '../../src/client/bootstrap-cache';

function host(profile = 'default') {
  return { plugin: { id: 'ekko-tools' }, identity: { userId: 7, profile } } as any;
}

describe('首屏缓存', () => {
  it('按插件与身份读取，缺省身份不写入', () => {
    const value = { providers: [], accounts: [], languages: [], vaultWarning: false } as any;
    expect(readBootstrapCache(host())).toBeUndefined();
    writeBootstrapCache(host(), value);
    expect(readBootstrapCache(host())).toBe(value);
    expect(readBootstrapCache(host('other'))).toBeUndefined();
    const anonymous = { plugin: { id: 'ekko-tools' } } as any;
    writeBootstrapCache(anonymous, value);
    expect(readBootstrapCache(anonymous)).toBeUndefined();
  });
});

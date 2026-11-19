// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { appearanceDefaults } from '../../src/client/appearance';
import { readAppearanceCache, readViewCache, writeAppearanceCache, writeViewCache } from '../../src/client/bootstrap-cache';

function host(profile = 'default') {
  return { plugin: { id: 'ekko-tools' }, identity: { userId: 7, profile } } as any;
}

describe('页面缓存', () => {
  beforeEach(() => { window.name = ''; });

  it('外观缓存写入 window.name，跨脚本重载可读且按身份隔离', () => {
    writeAppearanceCache(host(), appearanceDefaults);
    expect(window.name.startsWith('ekko-tools:page-cache:')).toBe(true);
    expect(readAppearanceCache(host())).toEqual(appearanceDefaults);
    expect(readAppearanceCache(host('other'))).toBeUndefined();
  });

  it('视图缓存与外观缓存合并保存', () => {
    writeAppearanceCache(host(), appearanceDefaults);
    writeViewCache(host(), 'mail', { filter: '', page: { items: [], total: 0 } });
    expect(readViewCache(host(), 'mail')).toEqual({ filter: '', page: { items: [], total: 0 } });
    expect(readAppearanceCache(host())).toEqual(appearanceDefaults);
  });
});

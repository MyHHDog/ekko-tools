import {afterEach, describe, expect, it, vi} from 'vitest';
import {uuid} from '../../src/client/uuid';

const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

afterEach(() => vi.unstubAllGlobals());

describe('uuid', () => {
  it('优先使用 crypto.randomUUID', () => {
    vi.stubGlobal('crypto', {randomUUID: () => '11111111-1111-4111-8111-111111111111'});
    expect(uuid()).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('没有 randomUUID 时使用 getRandomValues', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0xab);
        return bytes;
      },
    });
    const value = uuid();
    expect(value).toMatch(pattern);
    expect(value).toBe('abababab-abab-4bab-abab-abababababab');
  });

  it('randomUUID 返回空值时继续降级', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => '',
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0x02);
        return bytes;
      },
    });
    expect(uuid()).toMatch(pattern);
  });

  it('randomUUID 抛错时继续降级', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => {
        throw new Error('not available');
      },
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0x01);
        return bytes;
      },
    });
    expect(uuid()).toMatch(pattern);
  });

  it('完全没有 Web Crypto 时仍返回合法 UUID', () => {
    vi.stubGlobal('crypto', undefined);
    expect(uuid()).toMatch(pattern);
    expect(uuid()).not.toBe(uuid());
  });
});

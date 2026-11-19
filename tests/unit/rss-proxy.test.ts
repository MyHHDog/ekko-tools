import {describe, expect, it} from 'vitest';
import {
  normalizeProxyUrl, parseWindowsProxy, selectEnvProxy, shouldBypassProxy,
} from '../../src/server/rss/proxy';

describe('RSS 代理', () => {
  it('补全协议并保留主机端口', () => {
    expect(normalizeProxyUrl('127.0.0.1:7890')).toBe('http://127.0.0.1:7890');
    expect(normalizeProxyUrl('https://proxy.example:8443/')).toBe('https://proxy.example:8443');
  });

  it('拒绝不支持的代理地址', () => {
    expect(() => normalizeProxyUrl('')).toThrow();
    expect(() => normalizeProxyUrl('socks5://127.0.0.1:1080')).toThrow();
    expect(() => normalizeProxyUrl('http://user@127.0.0.1:7890')).toThrow();
  });

  it('按目标协议读取环境变量并遵守 NO_PROXY', () => {
    const env = {
      HTTP_PROXY: 'http://127.0.0.1:7890',
      HTTPS_PROXY: 'http://127.0.0.1:7891',
      NO_PROXY: '.example.com,localhost',
    };
    expect(selectEnvProxy(new URL('http://feed.test'), env)).toBe('http://127.0.0.1:7890');
    expect(selectEnvProxy(new URL('https://feed.test'), env)).toBe('http://127.0.0.1:7891');
    expect(selectEnvProxy(new URL('https://api.example.com'), env)).toBeUndefined();
  });

  it('解析 Windows 的协议映射与直连例外', () => {
    expect(parseWindowsProxy('http=127.0.0.1:7890;https=127.0.0.1:7891', 'https:')).toBe('http://127.0.0.1:7891');
    expect(parseWindowsProxy('127.0.0.1:7890', 'http:')).toBe('http://127.0.0.1:7890');
    expect(shouldBypassProxy('api.example.com', '*.example.com;<local>')).toBe(true);
    expect(shouldBypassProxy('nas', '<local>')).toBe(true);
    expect(shouldBypassProxy('feed.test', '*.example.com')).toBe(false);
  });
});

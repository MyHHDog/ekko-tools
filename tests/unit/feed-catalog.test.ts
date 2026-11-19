import { expect, it } from 'vitest';
import {
  feedCatalog, feedCategories, feedHost, normalizeFeedUrl, sameFeedUrl,
} from '../../src/shared/feed-catalog';

it('内置订阅源分类完整、ID 与 URL 唯一且均为 http(s)', () => {
  expect(feedCategories).toHaveLength(9);
  expect(feedCatalog).toHaveLength(27);
  const ids = new Set<string>(), urls = new Set<string>();
  for (const item of feedCatalog) {
    expect(feedCategories.some(category => category.id === item.category)).toBe(true);
    expect(item.id).not.toBe('');
    expect(ids.has(item.id)).toBe(false);
    ids.add(item.id);
    const feed = new URL(item.url), site = new URL(item.siteUrl);
    expect(['http:', 'https:']).toContain(feed.protocol);
    expect(['http:', 'https:']).toContain(site.protocol);
    expect(['localhost', '127.0.0.1', '::1']).not.toContain(feed.hostname);
    const normalized = normalizeFeedUrl(item.url);
    expect(urls.has(normalized)).toBe(false);
    urls.add(normalized);
  }
  for (const category of feedCategories) {
    expect(feedCatalog.filter(item => item.category === category.id)).toHaveLength(3);
  }
});

it('订阅 URL 比较忽略尾部斜杠与主机大小写', () => {
  expect(sameFeedUrl('https://SSPAI.com/feed/', 'https://sspai.com/feed')).toBe(true);
  expect(sameFeedUrl('https://sspai.com/feed?v=1', 'https://sspai.com/feed')).toBe(false);
  expect(feedHost('https://www.example.com/feed')).toBe('example.com');
  expect(normalizeFeedUrl('https://example.com/feed/')).toBe('https://example.com/feed');
});

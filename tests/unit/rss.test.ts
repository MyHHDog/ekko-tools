import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { parseSubscription } from '../../src/server/rss/parse';
import { RssService } from '../../src/server/rss/service';
import { RssStore } from '../../src/server/rss/store';
import { AppError } from '../../src/shared/error-codes';
import type { FetchedPage } from '../../src/server/rss/fetch';
import { contract } from '../../src/server/index';
import { validateModel } from '../../sdk/harness/contracts.mjs';
import { cleanup, tempdir } from '../helpers';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await cleanup(directory);
});

function rssFeed(title: string, items: { id: string; title: string; url: string }[], next?: string) {
  const now = new Date().toUTCString();
  const namespace = next ? ' xmlns:atom="http://www.w3.org/2005/Atom"' : '';
  const nextLink = next ? `<atom:link rel="next" href="${next}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"${namespace}><channel><title>${title}</title>` +
    `<link>https://example.com</link><description>示例订阅</description>` +
    nextLink +
    items.map(item => `<item><guid>${item.id}</guid><title>${item.title}</title>` +
      `<link>${item.url}</link><pubDate>${now}</pubDate><description>正文 ${item.title}</description></item>`).join('') +
    '</channel></rss>';
}

function page(url: string, body: string, status = 200): FetchedPage {
  return { url, status, body, contentType: 'application/rss+xml' };
}

function service(directory: string, fetcher: (url: string, options?: any) => Promise<FetchedPage>, fullTextWaitMs?: number) {
  const host = { lifecycle: { add: () => () => {} }, config: {} } as any;
  const vault = { get: async () => { throw new AppError('NOT_FOUND'); } } as any;
  return new RssService(host, vault, join(directory, 'rss'), fetcher, 5000, fullTextWaitMs);
}

function run(models?: any) {
  return {
    identity: { userId: 1, profile: 'rss-test' }, signal: new AbortController().signal,
    state: { plugin: {} }, host: { models }, messages: { emit: () => {} },
  } as any;
}

describe('RSS 解析', () => {
  it('解析 RSS 2.0、Atom 与 JSON Feed', () => {
    const rss = parseSubscription(rssFeed('示例', [{ id: 'r1', title: '第一篇', url: 'https://example.com/1' }]));
    expect(rss.title).toBe('示例');
    expect(rss.entries[0]).toMatchObject({ title: '第一篇', url: 'https://example.com/1' });
    const atom = parseSubscription(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom 源</title>` +
      `<link href="https://atom.example"/><entry><id>a1</id><title>Atom 文章</title>` +
      `<link href="https://atom.example/1"/><updated>2026-01-01T00:00:00Z</updated>` +
      `<content type="html">Atom 正文</content></entry></feed>`);
    expect(atom.title).toBe('Atom 源');
    expect(atom.entries[0].title).toBe('Atom 文章');
    const json = parseSubscription(JSON.stringify({
      version: 'https://jsonfeed.org/version/1.1', title: 'JSON 源', home_page_url: 'https://json.example',
      items: [{ id: 'j1', title: 'JSON 文章', url: 'https://json.example/1', content_text: 'JSON 正文' }],
    }));
    expect(json.title).toBe('JSON 源');
    expect(json.entries[0].title).toBe('JSON 文章');
  });

  it('无法识别的内容返回 FEED_INVALID', () => {
    expect(() => parseSubscription('not a feed')).toThrowError(/订阅内容无法解析/);
  });

  it('补全相对图标并在缺失时回退站点 favicon', () => {
    const body = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>相对图标</title>` +
      `<link>https://example.com/blog/</link><description>示例</description>` +
      `<image><url>/static/icon.png</url><title>相对图标</title><link>https://example.com</link></image>` +
      `<item><guid>1</guid><title>文章</title><link>https://example.com/1</link></item></channel></rss>`;
    expect(parseSubscription(body, 'https://example.com/feed.xml').icon).toBe('https://example.com/static/icon.png');
    const fallback = parseSubscription(rssFeed('站点', [{ id: '1', title: '文章', url: 'https://example.com/1' }]),
      'https://example.com/feed.xml');
    expect(fallback.icon).toBe('https://example.com/favicon.ico');
  });

  it('RPC 入参允许客户端请求标识与调用方分组', () => {
    expect(() => validateModel(contract, 'rssEntriesInput', { __requestId: 'r1', __owner: 'reading' })).not.toThrow();
    expect(() => validateModel(contract, 'requestIdOnly', { __requestId: 'r2', __owner: 'reading' })).not.toThrow();
    expect(() => validateModel(contract, 'rssSettingsInput', { __requestId: 'r3', __owner: 'reading' })).not.toThrow();
  });
});

describe('RSS 本地库', () => {
  it('阅读正文样式可保存，数值会收敛到安全范围', async () => {
    const directory = await tempdir(); directories.push(directory);
    const rss = service(directory, async url => page(url, ''));
    const saved = rss.saveSettings({
      articleTheme: 'dark', articleFont: 'mono', articleFontSize: 30, articleLineHeight: 1.234,
      articleWidth: 2000, articleCustomCss: 'x'.repeat(13000),
    });
    expect(saved).toMatchObject({ articleTheme: 'dark', articleFont: 'mono', articleFontSize: 24, articleLineHeight: 1.4, articleWidth: 1024 });
    expect(saved.articleCustomCss).toHaveLength(12000);
    expect(() => validateModel(contract, 'rssSettings', saved)).not.toThrow();
    rss.close();
  });

  it('多语句写入失败时整体回滚，不留下半条订阅数据', async () => {
    const directory = await tempdir(); directories.push(directory);
    const store = new RssStore(join(directory, 'rss', 'rss.db'));
    expect(() => store.transaction(() => {
      store.run('INSERT INTO folders(id,name,created_at) VALUES(?,?,?)', ['rollback', '回滚', Date.now()]);
      throw new Error('fixture failure');
    })).toThrow('fixture failure');
    expect(store.get("SELECT id FROM folders WHERE id='rollback'")).toBeUndefined();
    store.close();
  });

  it('添加订阅、分页、已读与收藏', async () => {
    const directory = await tempdir(); directories.push(directory);
    let calls = 0;
    const body = rssFeed('订阅', [
      { id: '1', title: '第一篇', url: 'https://example.com/1' },
      { id: '2', title: '第二篇', url: 'https://example.com/2' },
      { id: '3', title: '第三篇', url: 'https://example.com/3' },
    ]);
    const rss = service(directory, async url => { calls++; return page(url, body); });
    const added = await rss.addFeed({ url: 'https://example.com/feed.xml' });
    expect(added.feed.title).toBe('订阅');
    expect(calls).toBe(1);
    const duplicate = await rss.addFeed({ url: 'https://example.com/feed.xml' });
    expect(duplicate.feed.id).toBe(added.feed.id);
    expect(calls).toBe(1);
    const boot = rss.bootstrap();
    expect(() => validateModel(contract, 'rssBootstrap', boot)).not.toThrow();
    expect(boot.counts).toMatchObject({ feeds: 1, unread: 3 });
    const first = rss.listEntries({ limit: 1 });
    expect(() => validateModel(contract, 'rssEntryPage', first)).not.toThrow();
    expect(first.items).toHaveLength(1);
    expect(first.total).toBe(3);
    expect(first.nextCursor).toBe(1);
    const second = rss.listEntries({ limit: 1, cursor: first.nextCursor });
    expect(second.items).toHaveLength(1);
    const entry = await rss.getEntry(first.items[0].id);
    expect(() => validateModel(contract, 'rssEntry', entry)).not.toThrow();
    expect(entry.read).toBe(true);
    expect(rss.bootstrap().counts.unread).toBe(2);
    rss.markRead(entry.id, false);
    expect(rss.bootstrap().counts.unread).toBe(3);
    rss.star(entry.id, true);
    expect(rss.bootstrap().counts.starred).toBe(1);
    const starred = rss.listEntries({ view: 'starred' });
    expect(starred.items.map(item => item.id)).toEqual([entry.id]);
    rss.removeFeed(added.feed.id);
    expect(rss.bootstrap().counts).toMatchObject({ feeds: 0, unread: 0, starred: 0 });
    rss.close();
  });

  it('按当前筛选范围一键全部已读，不影响其他订阅源', async () => {
    const directory = await tempdir(); directories.push(directory);
    const feeds: Record<string, string> = {
      'https://example.com/a.xml': rssFeed('甲源', [
        { id: 'a1', title: '甲一', url: 'https://example.com/a1' },
        { id: 'a2', title: '甲二', url: 'https://example.com/a2' },
      ]),
      'https://example.com/b.xml': rssFeed('乙源', [
        { id: 'b1', title: '乙一', url: 'https://example.com/b1' },
      ]),
    };
    const rss = service(directory, async url => page(url, feeds[url]));
    const first = await rss.addFeed({ url: 'https://example.com/a.xml' });
    const second = await rss.addFeed({ url: 'https://example.com/b.xml' });
    expect(rss.bootstrap().counts.unread).toBe(3);
    const result = rss.markAllRead({ feedId: first.feed.id });
    expect(() => validateModel(contract, 'rssOkOutput', result)).not.toThrow();
    expect(rss.listEntries({ feedId: first.feed.id }).unread).toBe(0);
    expect(rss.listEntries({ feedId: second.feed.id }).unread).toBe(1);
    rss.markAllRead({ view: 'all' });
    expect(rss.bootstrap().counts.unread).toBe(0);
    rss.close();
  });

  it('抓取失败写入 lastError，刷新统计失败数', async () => {
    const directory = await tempdir(); directories.push(directory);
    const body = rssFeed('订阅', [{ id: '1', title: '第一篇', url: 'https://example.com/1' }]);
    let fail = false;
    const rss = service(directory, async url => {
      if (fail) throw new AppError('NETWORK_UNREACHABLE', true, 'network');
      return page(url, body);
    });
    await rss.addFeed({ url: 'https://example.com/feed.xml' });
    fail = true;
    const result = await rss.refresh();
    expect(result).toMatchObject({ checked: 1, newEntries: 0, failed: 1 });
    expect(rss.bootstrap().feeds[0].lastError).toMatch(/连不上|网络|重试/);
    rss.close();
  });

  it('多源刷新有界并发且单源失败不影响其他源', async () => {
    const directory = await tempdir(); directories.push(directory);
    const urls = Array.from({ length: 4 }, (_, index) => `https://example.com/feed-${index}.xml`);
    const bodies = Object.fromEntries(urls.map((url, index) =>
      [url, rssFeed(`订阅 ${index}`, [{ id: `e${index}`, title: `文章 ${index}`, url: `https://example.com/${index}` }])]));
    let active = 0, maxActive = 0, failUrl = '';
    const rss = service(directory, async url => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 30));
      active--;
      if (url === failUrl) throw new AppError('NETWORK_UNREACHABLE', true, 'network');
      return page(url, bodies[url]);
    });
    for (const url of urls) await rss.addFeed({ url });
    maxActive = 0; failUrl = urls[3];
    const result = await rss.refresh();
    expect(result).toMatchObject({ checked: 4, failed: 1 });
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(3);
    rss.close();
  });

  it('正文提取较慢时先返回订阅源内容，不阻塞文章打开', async () => {
    const directory = await tempdir(); directories.push(directory);
    const slow = 'https://example.com/slow';
    const body = rssFeed('订阅', [{ id: 'slow-1', title: '慢文章', url: slow }]);
    const rss = service(directory, async url => {
      if (url === slow) return new Promise<FetchedPage>(() => {});
      return page(url, body);
    }, 30);
    await rss.addFeed({ url: 'https://example.com/feed.xml' });
    const started = Date.now();
    const entry = await rss.getEntry(rss.listEntries({}).items[0].id);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(entry.read).toBe(true);
    expect(entry.contentHtml).toContain('正文');
    rss.close();
  });

  it('单次抓取按每源上限完整入库，并可持续分页到本地最后一篇', async () => {
    const directory = await tempdir(); directories.push(directory);
    const items = Array.from({ length: 350 }, (_, index) => ({
      id: `bulk-${index}`, title: `批量文章 ${index}`, url: `https://example.com/bulk/${index}`,
    }));
    const rss = service(directory, async url => page(url, rssFeed('批量订阅', items)));
    await rss.addFeed({ url: 'https://example.com/feed.xml' });
    let cursor: number | undefined, count = 0, pages = 0;
    do {
      const result = rss.listEntries({ limit: 100, cursor });
      count += result.items.length; pages++;
      expect(result.total).toBe(350);
      cursor = result.nextCursor;
    } while (cursor !== undefined);
    expect(count).toBe(350);
    expect(pages).toBe(4);
    rss.close();
  });

  it('沿订阅源声明的下一页归档补全历史文章', async () => {
    const directory = await tempdir(); directories.push(directory);
    const next = 'https://example.com/feed-page-2.xml';
    const first = rssFeed('归档订阅', [
      { id: 'new-1', title: '最新一', url: 'https://example.com/new-1' },
      { id: 'new-2', title: '最新二', url: 'https://example.com/new-2' },
    ], next);
    const second = rssFeed('归档订阅', [
      { id: 'old-1', title: '历史一', url: 'https://example.com/old-1' },
      { id: 'old-2', title: '历史二', url: 'https://example.com/old-2' },
    ]);
    const fetched: string[] = [];
    const rss = service(directory, async url => {
      fetched.push(url);
      return page(url, url === next ? second : first);
    });
    await rss.addFeed({ url: 'https://example.com/feed.xml' });
    const all = rss.listEntries({ limit: 100 });
    expect(fetched).toEqual(['https://example.com/feed.xml', next]);
    expect(all.total).toBe(4);
    expect(all.items.map(item => item.title).sort()).toEqual(['历史一', '历史二', '最新一', '最新二']);
    rss.close();
  });

  it('已有订阅缺失图标时按站点补 favicon', async () => {
    const directory = await tempdir(); directories.push(directory);
    const body = rssFeed('无图标', [{ id: '1', title: '文章', url: 'https://example.com/1' }]);
    const rss = service(directory, async url => page(url, body));
    const { feed } = await rss.addFeed({ url: 'https://example.com/feed.xml' });
    rss.close();
    const db = new DatabaseSync(join(directory, 'rss', 'rss.db'));
    db.prepare('UPDATE feeds SET icon=? WHERE id=?').run('', feed.id);
    db.close();
    const reopened = service(directory, async url => page(url, body));
    expect(reopened.bootstrap().feeds[0].icon).toBe('https://example.com/favicon.ico');
    reopened.close();
  });

  it('订阅源可移动到分组并移回未分组', async () => {
    const directory = await tempdir(); directories.push(directory);
    const body = rssFeed('订阅', [{ id: '1', title: '文章', url: 'https://example.com/1' }]);
    const rss = service(directory, async url => page(url, body));
    const { folder } = rss.addFolder('技术');
    const { feed } = await rss.addFeed({ url: 'https://example.com/feed.xml' });
    expect(rss.moveFeed(feed.id, folder.id)).toEqual({ ok: true });
    expect(rss.bootstrap().feeds[0].folderId).toBe(folder.id);
    expect(rss.moveFeed(feed.id)).toEqual({ ok: true });
    expect(rss.bootstrap().feeds[0].folderId).toBeUndefined();
    expect(() => rss.moveFeed(feed.id, 'missing')).toThrowError();
    rss.close();
  });

  it('订阅源可重命名，刷新后保留自定义名称', async () => {
    const directory = await tempdir(); directories.push(directory);
    let siteTitle = '原始名称';
    const rss = service(directory, async url =>
      page(url, rssFeed(siteTitle, [{ id: '1', title: '文章', url: 'https://example.com/1' }])));
    const { feed } = await rss.addFeed({ url: 'https://example.com/feed.xml' });
    const renamed = rss.renameFeed(feed.id, '  我的订阅  ');
    expect(renamed.feed.title).toBe('我的订阅');
    expect(() => validateModel(contract, 'rssFeedOutput', renamed)).not.toThrow();
    expect(rss.bootstrap().feeds[0].title).toBe('我的订阅');
    expect(rss.listEntries({}).items[0].feedTitle).toBe('我的订阅');
    siteTitle = '源站新名称';
    await rss.refresh();
    expect(rss.bootstrap().feeds[0].title).toBe('我的订阅');
    expect(() => rss.renameFeed('missing', '名称')).toThrowError();
    rss.close();
  });

  it('失败后记录退避时间与运行日志，手动刷新可绕过退避', async () => {
    const directory = await tempdir(); directories.push(directory);
    const body = rssFeed('订阅', [{ id: '1', title: '第一篇', url: 'https://example.com/1' }]);
    let fail = false;
    const rss = service(directory, async url => {
      if (fail) throw new AppError('NETWORK_UNREACHABLE', true, 'network');
      return page(url, body);
    });
    await rss.addFeed({ url: 'https://example.com/feed.xml' });
    fail = true;
    await rss.refresh();
    rss.close();
    const db = new DatabaseSync(join(directory, 'rss', 'rss.db'));
    const feed = db.prepare('SELECT failure_count,next_fetch_at,last_status FROM feeds').get() as any;
    expect(feed.failure_count).toBe(1);
    expect(feed.next_fetch_at).toBeGreaterThan(Date.now());
    expect(feed.last_status).toBe(0);
    const run = db.prepare('SELECT status,error FROM feed_runs ORDER BY id DESC LIMIT 1').get() as any;
    expect(run.status).toBe(0);
    expect(run.error).toMatch(/连不上|网络|重试/);
    db.close();
    let fetches = 0;
    const reopened = service(directory, async url => { fetches++; return page(url, body); });
    const skipped = await reopened.poll();
    expect(skipped).toMatchObject({ checked: 0, skipped: false });
    expect(fetches).toBe(0);
    const forced = await reopened.refresh();
    expect(forced.checked).toBe(1);
    expect(fetches).toBe(1);
    reopened.close();
  });

  it('OPML 导入与导出真实订阅', async () => {
    const directory = await tempdir(); directories.push(directory);
    const rss = service(directory, async url => page(url, rssFeed(url, [
      { id: url, title: url, url },
    ])));
    const opml = `<?xml version="1.0"?><opml version="2.0"><body>` +
      `<outline text="A" xmlUrl="https://a.example/feed"/><outline text="B" xmlUrl="https://b.example/feed"/>` +
      '</body></opml>';
    const imported = await rss.importOpml(opml);
    expect(imported).toEqual({ imported: 2, skipped: 0 });
    expect(rss.bootstrap().counts.feeds).toBe(2);
    const exported = rss.opmlExport().content;
    expect(exported).toContain('https://a.example/feed');
    expect(exported).toContain('https://b.example/feed');
    rss.close();
  });
});

describe('RSS AI 摘要', () => {
  it('调用宿主模型生成文章摘要与阅读简报', async () => {
    const directory = await tempdir(); directories.push(directory);
    const body = rssFeed('订阅', [{ id: '1', title: 'AI 文章', url: 'https://example.com/1' }]);
    const rss = service(directory, async url => page(url, body));
    const { feed } = await rss.addFeed({ url: 'https://example.com/feed.xml' });
    const models = {
      list: async () => ({ data: [{ id: 'provider/default-model', isDefault: true }] }),
      respond: async (input: any) => {
        expect(input.model).toBe('provider/default-model');
        if (input.input.includes('<article>')) {
          return { output_text: JSON.stringify({ tldr: '一句话摘要', points: ['要点一', '要点二'], whyRead: '值得阅读', tags: ['AI', '测试'] }) };
        }
        const entryId = /id=([^\s]+)/.exec(input.input)?.[1] || '';
        return { output_text: JSON.stringify({
          title: '今日简报', overview: '今天值得关注的内容',
          sections: [{ name: '重点', items: [{ entryId, line: '一条摘要' }] }],
        }) };
      },
    };
    const entry = await rss.getEntry(rss.listEntries({}).items[0].id);
    const summary = await rss.summarize(entry.id, run(models));
    expect(summary.summary).toMatchObject({ tldr: '一句话摘要', tags: ['AI', '测试'] });
    expect(rss.listEntries({}).items[0].hasSummary).toBe(true);
    expect(() => validateModel(contract, 'rssSummaryOutput', summary)).not.toThrow();
    expect(rss.bootstrap().digest).toBeUndefined();
    const digest = await rss.generateDigest(run(models), 'day');
    expect(() => validateModel(contract, 'rssDigestOutput', digest)).not.toThrow();
    expect(digest.digest.sections[0].items[0]).toMatchObject({ entryId: entry.id, source: feed.title });
    expect(rss.getDigest()?.title).toBe('今日简报');
    rss.close();
  });

  it('AI 未配置时拒绝摘要并返回配置错误', async () => {
    const directory = await tempdir(); directories.push(directory);
    const body = rssFeed('订阅', [{ id: '1', title: '文章', url: 'https://example.com/1' }]);
    const rss = service(directory, async url => page(url, body));
    await rss.addFeed({ url: 'https://example.com/feed.xml' });
    const id = rss.listEntries({}).items[0].id;
    await expect(rss.summarize(id, run())).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(rss.generateDigest(run(), 'day')).rejects.toMatchObject({ code: 'VALIDATION' });
    rss.close();
  });
  it('宿主模型目录为空时沿用当前翻译模型', async () => {
    const directory = await tempdir(); directories.push(directory);
    const body = rssFeed('订阅', [{ id: '1', title: 'AI 文章', url: 'https://example.com/1' }]);
    const rss = service(directory, async url => page(url, body));
    await rss.addFeed({ url: 'https://example.com/feed.xml' });
    const models = {
      list: async () => ({}),
      respond: async (input: any) => {
        expect(input.model).toBe('auto/deepseek-v4.1-flash');
        return { output_text: JSON.stringify({ tldr: '摘要', points: ['要点'], whyRead: '值得读', tags: ['AI'] }) };
      },
    };
    const custom = {
      ...run(models),
      state: { plugin: { namespace: () => ({
        get: async (key: string) => key === 'preferences' ? { model: 'auto/deepseek-v4.1-flash' } : undefined,
      }) } },
    } as any;
    const summary = await rss.summarize(rss.listEntries({}).items[0].id, custom);
    expect(summary.summary.tldr).toBe('摘要');
    rss.close();
  });
  it('模型返回纯文本时仍生成可读摘要', async () => {
    const directory = await tempdir(); directories.push(directory);
    const body = rssFeed('订阅', [{ id: '1', title: '文章', url: 'https://example.com/1' }]);
    const rss = service(directory, async url => page(url, body));
    await rss.addFeed({ url: 'https://example.com/feed.xml' });
    const models = {
      list: async () => ({ data: [{ id: 'model-a', isDefault: true }] }),
      respond: async () => ({ output_text: '这篇文章介绍了一个新的开发工具\n它支持本地缓存\n适合日常阅读' }),
    };
    const summary = await rss.summarize(rss.listEntries({}).items[0].id, run(models));
    expect(summary.summary.points.length).toBeGreaterThan(0);
    expect(summary.summary.tldr).toContain('开发工具');
    rss.close();
  });
  it('模型调用异常归类为供应商错误', async () => {
    const directory = await tempdir(); directories.push(directory);
    const body = rssFeed('订阅', [{ id: '1', title: '文章', url: 'https://example.com/1' }]);
    const rss = service(directory, async url => page(url, body));
    await rss.addFeed({ url: 'https://example.com/feed.xml' });
    const models = {
      list: async () => ({ data: [{ id: 'model-a', isDefault: true }] }),
      respond: async () => { throw new Error('upstream failed'); },
    };
    await expect(rss.summarize(rss.listEntries({}).items[0].id, run(models)))
      .rejects.toMatchObject({ code: 'PROVIDER_BAD_RESPONSE' });
    rss.close();
  });
  it('抓取时把阅读代理设置传给抓取器', async () => {
    const directory = await tempdir(); directories.push(directory);
    const body = rssFeed('订阅', [{ id: '1', title: '文章', url: 'https://example.com/1' }]);
    let received: any;
    const rss = service(directory, async (url, options) => {
      received = options;
      return page(url, body);
    });
    expect(rss.saveSettings({ proxyMode: 'custom', proxyUrl: '127.0.0.1:7890' }).proxyUrl)
      .toBe('http://127.0.0.1:7890');
    await rss.addFeed({ url: 'https://example.com/feed.xml' });
    expect(received.proxy).toEqual({ mode: 'custom', url: 'http://127.0.0.1:7890' });
    rss.close();
  });
});

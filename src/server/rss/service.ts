import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { parseOpml } from 'feedsmith';
import { AppError, assert } from '../../shared/error-codes';
import { defaultRssSettings } from '../../shared/rss';
import type {
  RssBootstrap, RssCounts, RssDigest, RssEntry, RssEntryItem, RssEntryPage,
  RssFeed, RssFolder, RssSettings, RssSummary,
} from '../../shared/rss';
import type { Host, Run } from '../adapter/host';
import type { Vault } from '../vault/store';
import { RssAi } from './ai';
import { fetchText, type FetchedPage } from './fetch';
import { parseSubscription } from './parse';
import { articleText, firstImage, sanitizeArticle } from './sanitize';
import { RssStore } from './store';
type Fetch = (url: string, options?: any) => Promise<FetchedPage>;
const MAX_ARCHIVE_PAGES = 20;
const MIN_ENTRY_LIMIT = 50;
const MAX_ENTRY_LIMIT = 2000;
function stampDay(value = Date.now()) { const date = new Date(value); date.setHours(0, 0, 0, 0); return date.getTime(); }
function safeJson<T>(value: string | undefined, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}
export class RssService {
  private db?: RssStore;
  private ai: RssAi;
  constructor(private host: Host, private vault: Vault, private directory: string,
    private fetcher: Fetch = fetchText, private timeoutMs = 20000) {
    this.ai = new RssAi(host, vault, timeoutMs);
    host.lifecycle.add(() => this.close());
  }
  private store() {
    if (!this.db) this.db = new RssStore(join(this.directory, 'rss.db'));
    return this.db;
  }
  close() { this.db?.close(); this.db = undefined; }
  private settings(): RssSettings {
    const row = this.store().get<{ value: string }>("SELECT value FROM settings WHERE key='config'");
    const saved = safeJson<Partial<RssSettings>>(row?.value, {});
    return { ...defaultRssSettings, ...saved };
  }
  private entryLimit() {
    return Math.min(MAX_ENTRY_LIMIT, Math.max(1, this.settings().maxEntriesPerFeed));
  }
  saveSettings(input: Partial<RssSettings>) {
    const current = this.settings();
    const clamp = (value: unknown, min: number, max: number, fallback: number) => {
      const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
    };
    const lineHeight = Number(input.articleLineHeight);
    const next: RssSettings = {
      summaryProvider: input.summaryProvider === 'openai' ? 'openai' : input.summaryProvider === 'hostModel' ? 'hostModel' : current.summaryProvider,
      summaryModel: typeof input.summaryModel === 'string' ? input.summaryModel.slice(0, 200) : current.summaryModel,
      summaryLang: input.summaryLang === 'en' ? 'en' : input.summaryLang === 'zh' ? 'zh' : current.summaryLang,
      autoSummary: typeof input.autoSummary === 'boolean' ? input.autoSummary : current.autoSummary,
      pollMinutes: clamp(input.pollMinutes, 5, 120, current.pollMinutes),
      retentionDays: clamp(input.retentionDays, 7, 365, current.retentionDays),
      maxEntriesPerFeed: clamp(input.maxEntriesPerFeed, MIN_ENTRY_LIMIT, MAX_ENTRY_LIMIT, current.maxEntriesPerFeed),
      fullText: typeof input.fullText === 'boolean' ? input.fullText : current.fullText,
      remoteImages: typeof input.remoteImages === 'boolean' ? input.remoteImages : current.remoteImages,
      articleTheme: input.articleTheme === 'sepia' || input.articleTheme === 'dark' ? input.articleTheme : input.articleTheme === 'paper' ? 'paper' : current.articleTheme,
      articleFont: input.articleFont === 'sans' || input.articleFont === 'mono' ? input.articleFont : input.articleFont === 'serif' ? 'serif' : current.articleFont,
      articleFontSize: clamp(input.articleFontSize, 12, 24, current.articleFontSize),
      articleLineHeight: Number.isFinite(lineHeight) ? Math.round(Math.min(2.4, Math.max(1.4, lineHeight)) * 100) / 100 : current.articleLineHeight,
      articleWidth: clamp(input.articleWidth, 520, 1024, current.articleWidth),
      articleCustomCss: typeof input.articleCustomCss === 'string' ? input.articleCustomCss.slice(0, 12000) : current.articleCustomCss,
    };
    this.store().run("INSERT INTO settings(key,value) VALUES('config',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [JSON.stringify(next)]);
    return next;
  }
  getSettings() { return this.settings(); }
  async aiConfigured(run: Run) { return this.ai.configured(this.settings(), run); }
  // 已订阅但未记录图标的源，按站点补 favicon；加载失败时客户端仍回退首字母。
  private backfillIcons() {
    const rows = this.store().all<any>("SELECT id,site_url FROM feeds WHERE (icon IS NULL OR icon='') AND site_url IS NOT NULL");
    for (const row of rows) {
      try {
        const icon = new URL('/favicon.ico', row.site_url).toString();
        this.store().run('UPDATE feeds SET icon=? WHERE id=?', [icon, row.id]);
      } catch { /* 站点地址无法解析时跳过 */ }
    }
  }
  private folderRows() {
    return this.store().all<any>(`SELECT f.*,(SELECT COUNT(*) FROM entries e JOIN feeds x ON x.id=e.feed_id
      WHERE x.folder_id=f.id AND e.read=0) unread FROM folders f ORDER BY f.sort_order,f.created_at`);
  }
  private feedRows() {
    return this.store().all<any>(`SELECT f.*,(SELECT COUNT(*) FROM entries e WHERE e.feed_id=f.id AND e.read=0) unread
      FROM feeds f ORDER BY f.sort_order,f.created_at`);
  }
  private mapFolder(row: any): RssFolder {
    return { id: row.id, name: row.name, createdAt: row.created_at, unread: row.unread || 0 };
  }
  private mapFeed(row: any): RssFeed {
    return {
      id: row.id, url: row.url, title: row.title, siteUrl: row.site_url, description: row.description,
      icon: row.icon, enabled: row.enabled === 1,
      ...(row.folder_id ? { folderId: row.folder_id } : {}),
      ...(row.last_fetched_at ? { lastFetchedAt: row.last_fetched_at } : {}),
      ...(row.last_error ? { lastError: row.last_error } : {}),
      unread: row.unread || 0,
    };
  }
  private latestDigest(): RssDigest | undefined {
    const row = this.store().get<{ payload: string }>('SELECT payload FROM digests ORDER BY created_at DESC LIMIT 1');
    return row ? safeJson<RssDigest | undefined>(row.payload, undefined) : undefined;
  }
  bootstrap(): RssBootstrap {
    this.backfillIcons();
    const feeds = this.feedRows().map(row => this.mapFeed(row));
    const counts: RssCounts = {
      feeds: feeds.length,
      unread: this.store().get<{ n: number }>('SELECT COUNT(*) n FROM entries WHERE read=0')?.n || 0,
      today: this.store().get<{ n: number }>('SELECT COUNT(*) n FROM entries WHERE published_at>=?', [stampDay()])?.n || 0,
      starred: this.store().get<{ n: number }>('SELECT COUNT(*) n FROM entries WHERE starred=1')?.n || 0,
    };
    const lastSyncAt = this.store().get<{ at: number }>('SELECT MAX(last_fetched_at) at FROM feeds')?.at || undefined;
    const digest = this.latestDigest();
    return {
      folders: this.folderRows().map(row => this.mapFolder(row)), feeds,
      settings: this.settings(), counts,
      ...(lastSyncAt ? { lastSyncAt } : {}),
      ...(digest ? { digest } : {}),
    };
  }
  addFolder(name: string) {
    const value = String(name || '').trim().slice(0, 30);
    assert(value);
    const id = randomUUID();
    const order = this.store().get<{ n: number }>('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM folders')?.n || 0;
    const now = Date.now();
    this.store().run('INSERT INTO folders(id,name,created_at,sort_order) VALUES(?,?,?,?)', [id, value, now, order]);
    return { folder: this.mapFolder({ id, name: value, created_at: now }) };
  }
  removeFolder(id: string) {
    this.store().run('UPDATE feeds SET folder_id=NULL WHERE folder_id=?', [String(id)]);
    this.store().run('DELETE FROM folders WHERE id=?', [String(id)]);
    return { removed: true };
  }
  private feedById(id: string) {
    const row = this.store().get<any>('SELECT * FROM feeds WHERE id=?', [id]);
    assert(row, 'NOT_FOUND');
    return this.mapFeed(row);
  }
  private entryId(feedId: string, guid: string) {
    return `${feedId}:${createHash('sha256').update(guid).digest('hex').slice(0, 24)}`;
  }
  private upsertEntries(feedId: string, parsed: ReturnType<typeof parseSubscription>) {
    const before = new Set(this.store().all<{ id: string }>('SELECT id FROM entries WHERE feed_id=?', [feedId]).map(row => row.id));
    const now = Date.now();
    const max = this.entryLimit();
    const incoming = [...parsed.entries].sort((left, right) => right.publishedAt - left.publishedAt).slice(0, max);
    let added = 0;
    for (const item of incoming) {
      const id = this.entryId(feedId, item.guid);
      this.store().run(`INSERT INTO entries(id,feed_id,guid,title,url,author,published_at,snippet,content_html,content_text,image,lang,read,starred,fetched_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,0,?)
        ON CONFLICT(feed_id,guid) DO UPDATE SET title=excluded.title,url=excluded.url,author=excluded.author,
          published_at=excluded.published_at,snippet=excluded.snippet,image=excluded.image,lang=excluded.lang,
          content_html=CASE WHEN entries.content_fetched_at IS NULL THEN excluded.content_html ELSE entries.content_html END,
          content_text=CASE WHEN entries.content_fetched_at IS NULL THEN excluded.content_text ELSE entries.content_text END`,
      [id, feedId, item.guid, item.title, item.url, item.author || null, item.publishedAt, item.snippet,
        item.contentHtml, item.contentText, item.image || null, item.lang || null, now]);
      if (!before.has(id)) added++;
    }
    this.store().run(`DELETE FROM entries WHERE feed_id=? AND id NOT IN
      (SELECT id FROM entries WHERE feed_id=? ORDER BY published_at DESC LIMIT ?)`, [feedId, feedId, max]);
    this.store().run('DELETE FROM summaries WHERE entry_id NOT IN (SELECT id FROM entries)');
    return added;
  }
  private async loadSubscription(url: string, options: any, archive: boolean) {
    const page = await this.fetcher(url, options);
    if (page.status === 304) return { page };
    const head = parseSubscription(page.body, url);
    if (!archive || !head.nextUrl) return { page, parsed: head };
    const max = this.entryLimit(), entries = [...head.entries];
    const seen = new Set(entries.map(item => item.guid));
    const visited = new Set([url]);
    let next: string | undefined = head.nextUrl;
    for (let pages = 1; next && entries.length < max && pages < MAX_ARCHIVE_PAGES; pages++) {
      if (visited.has(next)) break;
      visited.add(next);
      const olderPage = await this.fetcher(next, { timeoutMs: this.timeoutMs });
      if (olderPage.status === 304) break;
      const older = parseSubscription(olderPage.body, next);
      for (const item of older.entries) {
        if (seen.has(item.guid)) continue;
        seen.add(item.guid); entries.push(item);
        if (entries.length >= max) break;
      }
      next = older.nextUrl;
    }
    return { page, parsed: { ...head, entries } };
  }
  async addFeed(input: { url?: string; folderId?: string }) {
    const raw = String(input.url || '').trim();
    let url: URL;
    try { url = new URL(raw); } catch { throw new AppError('VALIDATION'); }
    assert(/^https?:$/.test(url.protocol));
    const exists = this.store().get<any>('SELECT * FROM feeds WHERE url=?', [url.toString()]);
    if (exists) return { feed: this.mapFeed(exists) };
    const { page, parsed } = await this.loadSubscription(url.toString(), { timeoutMs: this.timeoutMs }, true);
    assert(parsed, 'FEED_INVALID');
    const folderId = input.folderId && this.store().get('SELECT id FROM folders WHERE id=?', [input.folderId]) ? input.folderId : null;
    const id = randomUUID(), now = Date.now();
    const order = this.store().get<{ n: number }>('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM feeds WHERE COALESCE(folder_id,\'\')=?', [folderId || ''])?.n || 0;
    this.store().run(`INSERT INTO feeds(id,url,title,site_url,description,icon,folder_id,enabled,etag,last_modified,
      last_fetched_at,created_at,failure_count,next_fetch_at,last_status,updated_at,sort_order) VALUES(?,?,?,?,?,?,?,1,?,?,?,?,0,?,?,?,?)`,
    [id, url.toString(), parsed.title, parsed.siteUrl || url.origin, parsed.description, parsed.icon,
      folderId, page.etag || null, page.lastModified || null, now, now,
      now + this.settings().pollMinutes * 60000, page.status, now, order]);
    this.upsertEntries(id, parsed);
    return { feed: this.feedById(id) };
  }
  removeFeed(id: string) {
    this.store().run('DELETE FROM entries WHERE feed_id=?', [String(id)]);
    this.store().run('DELETE FROM feeds WHERE id=?', [String(id)]);
    this.store().run('DELETE FROM summaries WHERE entry_id NOT IN (SELECT id FROM entries)');
    return { removed: true };
  }
  moveFeed(id: string, folderId?: string) {
    assert(this.store().get('SELECT id FROM feeds WHERE id=?', [String(id)]), 'NOT_FOUND');
    const target = folderId ? String(folderId) : '';
    if (target) assert(this.store().get('SELECT id FROM folders WHERE id=?', [target]), 'NOT_FOUND');
    const order = this.store().get<{ n: number }>('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM feeds WHERE COALESCE(folder_id,\'\')=?', [target])?.n || 0;
    this.store().run('UPDATE feeds SET folder_id=?,sort_order=?,updated_at=? WHERE id=?', [target || null, order, Date.now(), String(id)]);
    return { ok: true };
  }
  private recordRun(feedId: string, status: number, added: number, error?: string) {
    this.store().run('INSERT INTO feed_runs(feed_id,at,status,new_entries,error) VALUES(?,?,?,?,?)',
      [feedId, Date.now(), status, added, error ? error.slice(0, 200) : null]);
    this.store().run('DELETE FROM feed_runs WHERE id NOT IN (SELECT id FROM feed_runs ORDER BY id DESC LIMIT 2000)');
  }
  private async refreshOne(row: any) {
    const pollMs = this.settings().pollMinutes * 60000;
    try {
      const { page, parsed } = await this.loadSubscription(row.url, {
        timeoutMs: this.timeoutMs, etag: row.etag || undefined, lastModified: row.last_modified || undefined,
      }, false);
      if (page.status === 304) {
        const now = Date.now();
        this.store().run(`UPDATE feeds SET last_fetched_at=?,last_error=NULL,failure_count=0,last_status=304,
          next_fetch_at=?,updated_at=? WHERE id=?`, [now, now + pollMs, now, row.id]);
        this.recordRun(row.id, 304, 0);
        return 0;
      }
      if (!parsed) return 0;
      const added = this.upsertEntries(row.id, parsed);
      const now = Date.now();
      this.store().run(`UPDATE feeds SET title=?,site_url=?,description=?,icon=?,etag=?,last_modified=?,
        last_fetched_at=?,last_error=NULL,failure_count=0,last_status=?,next_fetch_at=?,updated_at=? WHERE id=?`,
      [parsed.title || row.title, parsed.siteUrl || row.site_url, parsed.description || row.description,
        parsed.icon || row.icon, page.etag || row.etag, page.lastModified || row.last_modified, now,
        page.status, now + pollMs, now, row.id]);
      this.recordRun(row.id, page.status, added);
      return added;
    } catch (error) {
      const message = error instanceof AppError ? error.message : '抓取失败，请检查订阅地址';
      const failures = Number(row.failure_count || 0) + 1;
      const now = Date.now(), retryAt = now + Math.min(pollMs * 2 ** Math.min(failures, 6), 6 * 3600000);
      this.store().run(`UPDATE feeds SET last_error=?,failure_count=?,last_status=0,next_fetch_at=?,updated_at=? WHERE id=?`,
        [message.slice(0, 200), failures, retryAt, now, row.id]);
      this.recordRun(row.id, 0, 0, message);
      throw error;
    }
  }
  private cleanup() {
    const settings = this.settings();
    const cutoff = Date.now() - settings.retentionDays * 86400000;
    this.store().run('DELETE FROM entries WHERE published_at<?', [cutoff]);
    this.store().run('DELETE FROM summaries WHERE entry_id NOT IN (SELECT id FROM entries)');
  }
  async refresh(id?: string, dueOnly = false) {
    const rows = id
      ? this.store().all<any>('SELECT * FROM feeds WHERE id=?', [String(id)])
      : dueOnly
        ? this.store().all<any>(`SELECT * FROM feeds WHERE enabled=1
          AND (next_fetch_at IS NULL OR next_fetch_at<=?) ORDER BY last_fetched_at ASC`, [Date.now()])
        : this.store().all<any>('SELECT * FROM feeds WHERE enabled=1 ORDER BY last_fetched_at ASC');
    let checked = 0, newEntries = 0, failed = 0;
    for (const row of rows) {
      checked++;
      try { newEntries += await this.refreshOne(row); }
      catch { failed++; }
    }
    this.cleanup();
    return { checked, newEntries, failed };
  }
  async poll() {
    const settings = this.settings();
    const row = this.store().get<{ value: string }>("SELECT value FROM settings WHERE key='last-poll'");
    const last = Number(row?.value || 0);
    if (Date.now() - last < settings.pollMinutes * 60000) return { checked: 0, newEntries: 0, failed: 0, skipped: true };
    const result = await this.refresh(undefined, true);
    this.store().run("INSERT INTO settings(key,value) VALUES('last-poll',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [String(Date.now())]);
    return { ...result, skipped: false };
  }
  private mapEntry(row: any): RssEntry {
    const summary = safeJson<RssSummary | undefined>(row.summary_payload, undefined);
    return {
      id: row.id, feedId: row.feed_id, feedTitle: row.feed_title,
      ...(row.feed_icon ? { feedIcon: row.feed_icon } : {}),
      title: row.title, url: row.url, ...(row.author ? { author: row.author } : {}), publishedAt: row.published_at,
      snippet: row.snippet, read: row.read === 1, starred: row.starred === 1,
      hasSummary: Boolean(summary), ...(row.image ? { image: row.image } : {}), contentHtml: row.content_html,
      contentText: row.content_text, fetchedAt: row.fetched_at, ...(summary ? { summary } : {}),
    };
  }
  private entryFilter(input: { folderId?: string; feedId?: string; view?: string; query?: string }) {
    const where = ['1=1'], params: any[] = [];
    if (input.feedId) { where.push('e.feed_id=?'); params.push(String(input.feedId)); }
    if (input.folderId) { where.push('f.folder_id=?'); params.push(String(input.folderId)); }
    if (input.view === 'unread') where.push('e.read=0');
    if (input.view === 'starred') where.push('e.starred=1');
    const query = String(input.query || '').trim();
    if (query) {
      where.push('(e.title LIKE ? OR e.snippet LIKE ? OR e.content_text LIKE ?)');
      params.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }
    return { clause: where.join(' AND '), params };
  }
  listEntries(input: { folderId?: string; feedId?: string; view?: string; query?: string; cursor?: number; limit?: number }): RssEntryPage {
    const { clause, params } = this.entryFilter(input);
    const limit = Math.min(100, Math.max(1, Number(input.limit) || 30));
    const offset = Math.max(0, Number(input.cursor) || 0);
    const from = 'FROM entries e JOIN feeds f ON f.id=e.feed_id';
    const base = `${from} WHERE ${clause}`;
    const total = this.store().get<{ n: number }>(`SELECT COUNT(*) n ${base}`, params)?.n || 0;
    const unread = this.store().get<{ n: number }>(`SELECT COUNT(*) n ${base} AND e.read=0`, params)?.n || 0;
    const rows = this.store().all<any>(`SELECT e.*,f.title feed_title,f.icon feed_icon,s.payload summary_payload
      ${from} LEFT JOIN summaries s ON s.entry_id=e.id WHERE ${clause} ORDER BY e.published_at DESC,e.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]);
    const items: RssEntryItem[] = rows.map(row => {
      const value = this.mapEntry(row);
      return {
        id: value.id, feedId: value.feedId, feedTitle: value.feedTitle,
        ...(value.feedIcon ? { feedIcon: value.feedIcon } : {}),
        title: value.title, url: value.url, ...(value.author ? { author: value.author } : {}),
        publishedAt: value.publishedAt, snippet: value.snippet, read: value.read, starred: value.starred,
        hasSummary: value.hasSummary, ...(value.image ? { image: value.image } : {}),
      };
    });
    return { items, ...(offset + items.length < total ? { nextCursor: offset + items.length } : {}), total, unread };
  }
  private async extractFullText(row: any) {
    if (row.content_fetched_at || !/^https?:/i.test(row.url || '')) return;
    try {
      const page = await this.fetcher(row.url, { timeoutMs: this.timeoutMs, limit: 6 * 1024 * 1024 });
      const document = parseHTML(page.body).document;
      const article = new Readability(document as unknown as Document, { charThreshold: 180 }).parse();
      if (!article?.content) return;
      const html = sanitizeArticle(article.content);
      const contentText = articleText(html);
      if (contentText.length < 180) return;
      this.store().run(`UPDATE entries SET content_html=?,content_text=?,snippet=?,image=COALESCE(image,?),content_fetched_at=?
        WHERE id=?`, [html, contentText, contentText.slice(0, 180), firstImage(html) || null, Date.now(), row.id]);
    } catch { /* 正文提取失败时保留订阅源正文 */ }
  }
  async getEntry(id: string): Promise<RssEntry> {
    let row = this.store().get<any>(`SELECT e.*,f.title feed_title,f.icon feed_icon,s.payload summary_payload
      FROM entries e JOIN feeds f ON f.id=e.feed_id LEFT JOIN summaries s ON s.entry_id=e.id WHERE e.id=?`, [String(id)]);
    assert(row, 'NOT_FOUND');
    if (this.settings().fullText) {
      await this.extractFullText(row);
      row = this.store().get<any>(`SELECT e.*,f.title feed_title,f.icon feed_icon,s.payload summary_payload
        FROM entries e JOIN feeds f ON f.id=e.feed_id LEFT JOIN summaries s ON s.entry_id=e.id WHERE e.id=?`, [String(id)]);
    }
    this.store().run('UPDATE entries SET read=1 WHERE id=?', [String(id)]);
    row.read = 1;
    return this.mapEntry(row);
  }
  markRead(id: string, read: boolean) {
    this.store().run('UPDATE entries SET read=? WHERE id=?', [read ? 1 : 0, String(id)]);
    return { ok: true as const };
  }
  reorderFolders(ids: string[]) {
    const list = [...new Set(ids.map(String))];
    assert(list.length === ids.length && list.length <= 2000);
    this.store().exec('BEGIN');
    try {
      list.forEach((id, index) => this.store().run('UPDATE folders SET sort_order=? WHERE id=?', [index, id]));
      this.store().exec('COMMIT');
    } catch (error) {
      this.store().exec('ROLLBACK');
      throw error;
    }
    return { ok: true as const };
  }
  reorderFeeds(ids: string[]) {
    const list = [...new Set(ids.map(String))];
    assert(list.length === ids.length && list.length <= 2000);
    this.store().exec('BEGIN');
    try {
      list.forEach((id, index) => this.store().run('UPDATE feeds SET sort_order=? WHERE id=?', [index, id]));
      this.store().exec('COMMIT');
    } catch (error) {
      this.store().exec('ROLLBACK');
      throw error;
    }
    return { ok: true as const };
  }
  markAllRead(input: { folderId?: string; feedId?: string; view?: string; query?: string }) {
    const { clause, params } = this.entryFilter(input);
    this.store().run(`UPDATE entries SET read=1 WHERE read=0 AND id IN
      (SELECT e.id FROM entries e JOIN feeds f ON f.id=e.feed_id WHERE ${clause})`, params);
    return { ok: true as const };
  }
  star(id: string, starred: boolean) {
    this.store().run('UPDATE entries SET starred=? WHERE id=?', [starred ? 1 : 0, String(id)]);
    return { ok: true as const };
  }
  async summarize(id: string, run: Run, lang?: 'zh' | 'en') {
    const settings = this.settings();
    if (!await this.ai.configured(settings, run)) throw new AppError('VALIDATION', false, 'configuration');
    const entry = await this.getEntry(id);
    const summary = await this.ai.summary(entry, lang ? { ...settings, summaryLang: lang } : settings, run);
    this.store().run('INSERT INTO summaries(entry_id,payload,created_at) VALUES(?,?,?) ON CONFLICT(entry_id) DO UPDATE SET payload=excluded.payload,created_at=excluded.created_at',
      [entry.id, JSON.stringify(summary), summary.createdAt]);
    return { summary };
  }
  getDigest(): RssDigest | undefined { return this.latestDigest(); }
  async generateDigest(run: Run, period: 'day' | 'week' = 'day') {
    const since = Date.now() - (period === 'week' ? 7 : 1) * 86400000;
    const rows = this.store().all<any>(`SELECT e.*,f.title feed_title,f.icon feed_icon,s.payload summary_payload
      FROM entries e JOIN feeds f ON f.id=e.feed_id LEFT JOIN summaries s ON s.entry_id=e.id
      WHERE e.published_at>=? ORDER BY e.published_at DESC LIMIT 40`, [since]);
    if (!rows.length) throw new AppError('NOT_FOUND');
    const settings = this.settings();
    if (!await this.ai.configured(settings, run)) throw new AppError('VALIDATION', false, 'configuration');
    const digest = await this.ai.digest(rows.map(row => this.mapEntry(row)), settings, run, period);
    this.store().run('INSERT INTO digests(id,payload,created_at) VALUES(?,?,?)', [digest.id, JSON.stringify(digest), digest.createdAt]);
    this.store().run('DELETE FROM digests WHERE id NOT IN (SELECT id FROM digests ORDER BY created_at DESC LIMIT 20)');
    return { digest };
  }
  async importOpml(content: string) {
    let parsed: any;
    try { parsed = parseOpml(String(content || '')); }
    catch { throw new AppError('FEED_INVALID'); }
    const urls: string[] = [];
    const walk = (outlines: any[]) => {
      for (const item of outlines || []) {
        if (typeof item.xmlUrl === 'string') urls.push(item.xmlUrl);
        if (Array.isArray(item.outlines)) walk(item.outlines);
      }
    };
    walk(parsed?.body?.outlines || []);
    let imported = 0, skipped = 0;
    for (const url of urls.slice(0, 50)) {
      try { await this.addFeed({ url }); imported++; }
      catch { skipped++; }
    }
    return { imported, skipped };
  }
  opmlExport() {
    const escape = (value: string) => value.replace(/[&<>"']/g, char =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char] || char));
    const outlines = this.feedRows().map(row =>
      `<outline type="rss" text="${escape(row.title)}" title="${escape(row.title)}" xmlUrl="${escape(row.url)}" htmlUrl="${escape(row.site_url)}"/>`
    ).join('');
    return { content: `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head><title>Ekko 阅读</title></head><body>${outlines}</body></opml>` };
  }
}

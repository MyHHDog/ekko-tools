import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
type Row = Record<string, any>;
export class RssStore {
  private db?: DatabaseSync;
  constructor(private file: string) {}
  private open() {
    if (this.db) return this.db;
    mkdirSync(dirname(this.file), { recursive: true });
    const db = new DatabaseSync(this.file);
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS folders(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at INTEGER NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS feeds(id TEXT PRIMARY KEY,url TEXT UNIQUE NOT NULL,title TEXT NOT NULL,custom_title TEXT,
        site_url TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',icon TEXT NOT NULL DEFAULT '',
        folder_id TEXT,enabled INTEGER NOT NULL DEFAULT 1,etag TEXT,last_modified TEXT,
        last_fetched_at INTEGER,last_error TEXT,created_at INTEGER NOT NULL,
        failure_count INTEGER NOT NULL DEFAULT 0,next_fetch_at INTEGER,last_status INTEGER,
        sort_order INTEGER NOT NULL DEFAULT 0,updated_at INTEGER);
      CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY,feed_id TEXT NOT NULL,guid TEXT NOT NULL,
        title TEXT NOT NULL,url TEXT NOT NULL,author TEXT,published_at INTEGER NOT NULL,
        snippet TEXT NOT NULL DEFAULT '',content_html TEXT NOT NULL DEFAULT '',content_text TEXT NOT NULL DEFAULT '',
        image TEXT,lang TEXT,read INTEGER NOT NULL DEFAULT 0,starred INTEGER NOT NULL DEFAULT 0,
        fetched_at INTEGER NOT NULL,content_fetched_at INTEGER,UNIQUE(feed_id,guid));
      CREATE TABLE IF NOT EXISTS summaries(entry_id TEXT PRIMARY KEY,payload TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS digests(id TEXT PRIMARY KEY,payload TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS feed_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,feed_id TEXT NOT NULL,
        at INTEGER NOT NULL,status INTEGER,new_entries INTEGER NOT NULL DEFAULT 0,error TEXT);
      CREATE INDEX IF NOT EXISTS entries_feed_date ON entries(feed_id,published_at DESC);
      CREATE INDEX IF NOT EXISTS entries_date ON entries(published_at DESC);
      CREATE INDEX IF NOT EXISTS entries_read ON entries(read,published_at DESC);`);
    // 旧库补列，保留已有订阅与文章数据。
    const columns = new Set((db.prepare('PRAGMA table_info(feeds)').all() as Row[]).map(row => row.name));
    for (const [name, ddl] of [
      ['custom_title', 'custom_title TEXT'],
      ['failure_count', 'failure_count INTEGER NOT NULL DEFAULT 0'],
      ['next_fetch_at', 'next_fetch_at INTEGER'],
      ['last_status', 'last_status INTEGER'],
      ['sort_order', 'sort_order INTEGER NOT NULL DEFAULT 0'],
      ['updated_at', 'updated_at INTEGER'],
    ]) if (!columns.has(name)) db.exec(`ALTER TABLE feeds ADD COLUMN ${ddl}`);
    const folderColumns = new Set((db.prepare('PRAGMA table_info(folders)').all() as Row[]).map(row => row.name));
    if (!folderColumns.has('sort_order')) db.exec('ALTER TABLE folders ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
    db.exec('CREATE INDEX IF NOT EXISTS feeds_next_fetch ON feeds(enabled,next_fetch_at)');
    db.exec('CREATE INDEX IF NOT EXISTS feed_runs_feed ON feed_runs(feed_id,at DESC)');
    this.db = db;
    return db;
  }
  all<T = Row>(sql: string, params: any[] = []): T[] {
    return this.open().prepare(sql).all(...params) as T[];
  }
  get<T = Row>(sql: string, params: any[] = []): T | undefined {
    return this.open().prepare(sql).get(...params) as T | undefined;
  }
  run(sql: string, params: any[] = []) {
    return this.open().prepare(sql).run(...params);
  }
  transaction<T>(work: () => T): T {
    const db = this.open();
    db.exec('BEGIN');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* 保留原始错误。 */ }
      throw error;
    }
  }
  exec(sql: string) { this.open().exec(sql); }
  close() { this.db?.close(); this.db = undefined; }
}

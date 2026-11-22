import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Account, MailSummary } from '../../shared/types';
import type { MailDraft, MailDraftAttachment, MailDraftSummary } from '../../shared/mail';
import {maxDraftAttachmentBytes} from '../../shared/mail';
import type { Storage } from '../adapter/host';
import { validateStored } from '../contract';
import { assert } from '../../shared/error-codes';

type Row = Record<string, any>;
export interface StoredSyncState {
  initialized?: boolean;
  lastSyncAt?: number;
  lastErrorAt?: number;
  lastError?: unknown;
  oldestCursor?: string;
  exhausted?: boolean;
  knownCount?: number;
}
type BodyIndex = Record<string, { at: number; bytes: number }>;

// 邮件数据独立落 SQLite；插件键值库只保留偏好等小对象，避免 2MB 上限与整表重写。
export class MailStorage implements Storage {
  private db?: DatabaseSync;
  constructor(private readonly file: string) {}

  private open() {
    if (this.db) return this.db;
    mkdirSync(dirname(this.file), { recursive: true });
    const db = new DatabaseSync(this.file);
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,provider TEXT NOT NULL,address TEXT NOT NULL,
        alias TEXT NOT NULL,color_token TEXT NOT NULL,username TEXT,imap_json TEXT,smtp_json TEXT,
        state_json TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS accounts_address ON accounts(address COLLATE NOCASE);
      CREATE TABLE IF NOT EXISTS messages(account_id TEXT NOT NULL,message_id TEXT NOT NULL,
        from_name TEXT,from_address TEXT NOT NULL,subject TEXT NOT NULL DEFAULT '',snippet TEXT NOT NULL DEFAULT '',
        date INTEGER NOT NULL,unread INTEGER NOT NULL DEFAULT 1,has_attachments INTEGER NOT NULL DEFAULT 0,
        lang TEXT,translated INTEGER NOT NULL DEFAULT 0,read_local INTEGER,read_pending INTEGER,
        PRIMARY KEY(account_id,message_id),
        FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS messages_date ON messages(date DESC);
      CREATE INDEX IF NOT EXISTS messages_account_date ON messages(account_id,date DESC);
      CREATE TABLE IF NOT EXISTS sync_state(account_id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS known_messages(account_id TEXT NOT NULL,message_id TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL,PRIMARY KEY(account_id,message_id));
      CREATE TABLE IF NOT EXISTS read_state(account_id TEXT NOT NULL,message_id TEXT NOT NULL,
        read INTEGER NOT NULL,PRIMARY KEY(account_id,message_id));
      CREATE TABLE IF NOT EXISTS read_pending(account_id TEXT NOT NULL,message_id TEXT NOT NULL,
        read INTEGER NOT NULL,PRIMARY KEY(account_id,message_id));
      CREATE TABLE IF NOT EXISTS translated_state(account_id TEXT NOT NULL,message_id TEXT NOT NULL,
        translated INTEGER NOT NULL,PRIMARY KEY(account_id,message_id));
      CREATE TABLE IF NOT EXISTS body_index(key TEXT PRIMARY KEY,account_id TEXT NOT NULL,
        message_id TEXT NOT NULL,bytes INTEGER NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS bilingual(key TEXT PRIMARY KEY,payload TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS images(key TEXT PRIMARY KEY,payload TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY,accountId TEXT NOT NULL,"to" TEXT NOT NULL,
        subject TEXT NOT NULL,body TEXT NOT NULL,updatedAt INTEGER NOT NULL,format TEXT);
      CREATE TABLE IF NOT EXISTS draft_attachments(draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
        id TEXT NOT NULL,name TEXT NOT NULL,content BLOB NOT NULL,PRIMARY KEY(draft_id,id));
      CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,payload TEXT NOT NULL);`);
    if(!db.prepare('PRAGMA table_info(drafts)').all().some(column=>column.name==='format'))db.exec('ALTER TABLE drafts ADD COLUMN format TEXT');
    this.db = db;
    return db;
  }

  namespace() { return this; }
  close() { this.db?.close(); this.db = undefined; }
  private meta(key: string) {
    return this.open().prepare('SELECT value FROM meta WHERE key=?').get(key) as Row | undefined;
  }
  private setMeta(key: string, value: string) {
    this.open().prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  }
  imported() { return this.meta('legacy_imported')?.value === '1'; }
  markImported() { this.setMeta('legacy_imported', '1'); }

  listDrafts(): MailDraftSummary[] {
    return this.open().prepare('SELECT id,accountId,"to",subject,updatedAt FROM drafts ORDER BY updatedAt DESC,id DESC').all()
      .map(row => ({...row}) as unknown as MailDraftSummary);
  }
  getDraft(id: string): MailDraft | undefined {
    const row = this.open().prepare('SELECT * FROM drafts WHERE id=?').get(id);
    if (!row) return undefined;
    const {format,...fields}=row;
    const attachments=this.open().prepare('SELECT id,name,length(content) AS bytes FROM draft_attachments WHERE draft_id=? ORDER BY rowid').all(id);
    const draft={...fields,...(format===null?{}:{format}),...(attachments.length?{attachments}:{})} as unknown as MailDraft;
    validateStored('mail-draft', draft);
    return draft;
  }
  draftAttachments(id:string){
    return this.open().prepare('SELECT name AS filename,content FROM draft_attachments WHERE draft_id=? ORDER BY rowid').all(id)
      .map(row=>({filename:String(row.filename),content:Buffer.from(row.content as Uint8Array)}));
  }
  saveDraft(draft: MailDraft, update: boolean, additions: (MailDraftAttachment&{content:Buffer})[] = []) {
    validateStored('mail-draft', draft);
    const db = this.open();
    const {id,accountId,to,subject,body,updatedAt,format,attachments=[]} = draft;
    db.exec('BEGIN IMMEDIATE');
    try{
      if(update)assert(db.prepare('UPDATE drafts SET accountId=?,"to"=?,subject=?,body=?,updatedAt=?,format=? WHERE id=?')
        .run(accountId,to,subject,body,updatedAt,format??null,id).changes,'NOT_FOUND');
      else assert(db.prepare('INSERT INTO drafts (id,accountId,"to",subject,body,updatedAt,format) SELECT ?,?,?,?,?,?,? WHERE (SELECT count(*) FROM drafts)<100')
        .run(id,accountId,to,subject,body,updatedAt,format??null).changes);
      const keep=new Set(attachments.map(file=>file.id));
      const remove=db.prepare('DELETE FROM draft_attachments WHERE draft_id=? AND id=?');
      for(const file of db.prepare('SELECT id FROM draft_attachments WHERE draft_id=?').all(id))if(!keep.has(String(file.id)))remove.run(id,file.id);
      const occupied=Number(db.prepare('SELECT coalesce(sum(length(content)),0) AS bytes FROM draft_attachments').get()?.bytes);
      assert(occupied+additions.reduce((sum,file)=>sum+file.bytes,0)<=maxDraftAttachmentBytes*10);
      const insert=db.prepare('INSERT INTO draft_attachments (draft_id,id,name,content) VALUES (?,?,?,?)');
      for(const file of additions)insert.run(id,file.id,file.name,file.content);
      db.exec('COMMIT');
    }catch(reason){db.exec('ROLLBACK');throw reason;}
    return draft;
  }
  deleteDraft(id: string) {
    return {deleted: !!this.open().prepare('DELETE FROM drafts WHERE id=?').run(id).changes};
  }

  private mapAccount(row: Row): Account {
    return {
      id: row.id, provider: row.provider, address: row.address, alias: row.alias,
      colorToken: row.color_token,
      ...(row.username ? { username: row.username } : {}),
      ...(row.imap_json ? { imap: JSON.parse(row.imap_json) } : {}),
      ...(row.smtp_json ? { smtp: JSON.parse(row.smtp_json) } : {}),
      state: JSON.parse(row.state_json), createdAt: row.created_at,
    };
  }
  private saveAccounts(all: Account[]) {
    const db = this.open();
    db.exec('BEGIN');
    try {
      const keep = new Set(all.map(account => account.id));
      for (const row of db.prepare('SELECT id FROM accounts').all() as Row[]) {
        if (!keep.has(row.id)) db.prepare('DELETE FROM accounts WHERE id=?').run(row.id);
      }
      const now = Date.now();
      const statement = db.prepare(`INSERT INTO accounts(id,provider,address,alias,color_token,username,imap_json,smtp_json,state_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,address=excluded.address,
        alias=excluded.alias,color_token=excluded.color_token,username=excluded.username,imap_json=excluded.imap_json,
        smtp_json=excluded.smtp_json,state_json=excluded.state_json,updated_at=excluded.updated_at`);
      for (const account of all) statement.run(account.id, account.provider, account.address, account.alias,
        account.colorToken, account.username || null, account.imap ? JSON.stringify(account.imap) : null,
        account.smtp ? JSON.stringify(account.smtp) : null, JSON.stringify(account.state), account.createdAt, now);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  private mapMessage(row: Row): MailSummary {
    return {
      accountId: row.account_id, messageId: row.message_id,
      from: row.from_name ? { name: row.from_name, address: row.from_address } : { address: row.from_address },
      subject: row.subject, snippet: row.snippet, date: row.date, unread: row.unread === 1,
      hasAttachments: row.has_attachments === 1, ...(row.lang ? { lang: row.lang } : {}),
      translated: row.translated === 1,
    };
  }
  private messagesFor(accountId?: string) {
    const sql = accountId
      ? 'SELECT * FROM messages WHERE account_id=? ORDER BY date ASC,message_id ASC'
      : 'SELECT * FROM messages ORDER BY date ASC,message_id ASC';
    return (accountId ? this.open().prepare(sql).all(accountId) : this.open().prepare(sql).all()) as Row[];
  }
  removeMessage(accountId: string, messageId: string) {
    const db = this.open(), key = accountId + ':' + messageId;
    db.exec('BEGIN');
    try {
      for (const table of ['messages','read_state','read_pending','translated_state','body_index'])
        db.prepare(`DELETE FROM ${table} WHERE account_id=? AND message_id=?`).run(accountId, messageId);
      db.prepare('DELETE FROM images WHERE key=?').run(key);
      db.prepare('DELETE FROM bilingual WHERE substr(key,1,?)=?').run(key.length+1,key+':');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  private saveMessages(items: MailSummary[]) {
    const groups = new Map<string, MailSummary[]>();
    for (const item of items) {
      const list = groups.get(item.accountId) || [];
      list.push(item);
      groups.set(item.accountId, list);
    }
    if (!groups.size) return;
    const db = this.open();
    db.exec('BEGIN');
    try {
      const remove = db.prepare('DELETE FROM messages WHERE account_id=? AND message_id=?');
      const upsert = db.prepare(`INSERT INTO messages(account_id,message_id,from_name,from_address,subject,snippet,
        date,unread,has_attachments,lang) VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(account_id,message_id) DO UPDATE SET from_name=excluded.from_name,from_address=excluded.from_address,
        subject=excluded.subject,snippet=excluded.snippet,date=excluded.date,unread=excluded.unread,
        has_attachments=excluded.has_attachments,lang=excluded.lang`);
      for (const [accountId, list] of groups) {
        const keep = new Set(list.map(item => item.messageId));
        for (const row of db.prepare('SELECT message_id FROM messages WHERE account_id=?').all(accountId) as Row[]) {
          if (!keep.has(row.message_id)) remove.run(accountId, row.message_id);
        }
        for (const item of list) upsert.run(item.accountId, item.messageId, item.from.name || null,
          item.from.address, item.subject, item.snippet, item.date, item.unread ? 1 : 0,
          item.hasAttachments ? 1 : 0, item.lang || null);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  private flagMap(table: 'read_state' | 'read_pending' | 'translated_state') {
    const rows = this.open().prepare(`SELECT account_id,message_id,${table === 'translated_state' ? 'translated' : 'read'} value
      FROM ${table}`).all() as Row[];
    const result: Record<string, boolean> = {};
    for (const row of rows) result[row.account_id + ':' + row.message_id] = row.value === 1;
    return result;
  }
  private saveFlags(table: 'read_state' | 'read_pending' | 'translated_state', values: Record<string, boolean>) {
    const db = this.open();
    const column = table === 'translated_state' ? 'translated' : 'read';
    db.exec('BEGIN');
    try {
      db.exec(`DELETE FROM ${table}`);
      const insert = db.prepare(`INSERT INTO ${table}(account_id,message_id,${column}) VALUES(?,?,?)`);
      for (const [key, value] of Object.entries(values)) {
        const at = key.indexOf(':');
        if (at <= 0) continue;
        insert.run(key.slice(0, at), key.slice(at + 1), value ? 1 : 0);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  readFlag(accountId: string, messageId: string) {
    const row = this.open().prepare('SELECT read FROM read_state WHERE account_id=? AND message_id=?')
      .get(accountId, messageId) as Row | undefined;
    return row ? row.read === 1 : undefined;
  }
  pendingRead(accountId: string, messageId: string) {
    const row = this.open().prepare('SELECT read FROM read_pending WHERE account_id=? AND message_id=?')
      .get(accountId, messageId) as Row | undefined;
    return row ? row.read === 1 : undefined;
  }
  unreadMessageIds(accountId: string, messageIds: string[]) {
    const unread = this.open().prepare(`SELECT 1 FROM messages
      LEFT JOIN read_pending USING (account_id,message_id)
      LEFT JOIN read_state USING (account_id,message_id)
      WHERE messages.account_id=? AND messages.message_id=?
        AND COALESCE(read_pending.read,read_state.read,1-messages.unread)=0`);
    return [...new Set(messageIds)].filter(messageId => unread.get(accountId, messageId) !== undefined);
  }
  setReadFlag(accountId: string, messageId: string, read: boolean) {
    this.open().prepare(`INSERT INTO read_state(account_id,message_id,read) VALUES(?,?,?)
      ON CONFLICT(account_id,message_id) DO UPDATE SET read=excluded.read`).run(accountId, messageId, read ? 1 : 0);
  }
  setReadFlags(updates: { accountId: string; messageId: string; read: boolean }[]) {
    const db = this.open(), statement = db.prepare(`INSERT INTO read_state(account_id,message_id,read) VALUES(?,?,?)
      ON CONFLICT(account_id,message_id) DO UPDATE SET read=excluded.read`);
    db.exec('BEGIN');
    try {
      for (const item of updates) statement.run(item.accountId, item.messageId, item.read ? 1 : 0);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  setPendingRead(accountId: string, messageId: string, read: boolean) {
    this.open().prepare(`INSERT INTO read_pending(account_id,message_id,read) VALUES(?,?,?)
      ON CONFLICT(account_id,message_id) DO UPDATE SET read=excluded.read`).run(accountId, messageId, read ? 1 : 0);
  }
  setPendingReads(updates: { accountId: string; messageId: string; read: boolean }[]) {
    if (!updates.length) return;
    const db = this.open(), statement = db.prepare(`INSERT INTO read_pending(account_id,message_id,read) VALUES(?,?,?)
      ON CONFLICT(account_id,message_id) DO UPDATE SET read=excluded.read`);
    db.exec('BEGIN');
    try {
      for (const item of updates) statement.run(item.accountId, item.messageId, item.read ? 1 : 0);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  deletePendingRead(accountId: string, messageId: string) {
    this.open().prepare('DELETE FROM read_pending WHERE account_id=? AND message_id=?').run(accountId, messageId);
  }
  deletePendingReads(keys: string[]) {
    const statement = this.open().prepare('DELETE FROM read_pending WHERE account_id=? AND message_id=?');
    for (const key of keys) {
      const at = key.indexOf(':');
      if (at > 0) statement.run(key.slice(0, at), key.slice(at + 1));
    }
  }
  markKnown(entries: { accountId: string; messageId: string; at: number }[], limit = 20000) {
    if (!entries.length) return;
    const db = this.open();
    db.exec('BEGIN');
    try {
      const insert = db.prepare('INSERT OR IGNORE INTO known_messages(account_id,message_id,first_seen_at) VALUES(?,?,?)');
      for (const item of entries) insert.run(item.accountId, item.messageId, item.at);
      const count = Number((db.prepare('SELECT COUNT(*) n FROM known_messages').get() as Row).n);
      if (count > limit) {
        const remove = db.prepare('DELETE FROM known_messages WHERE rowid=?');
        const rows = db.prepare('SELECT rowid FROM known_messages ORDER BY first_seen_at ASC,rowid ASC LIMIT ?')
          .all(count - limit) as Row[];
        for (const row of rows) remove.run(row.rowid);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  knownCount(accountId: string) {
    return Number((this.open().prepare('SELECT COUNT(*) n FROM known_messages WHERE account_id=?')
      .get(accountId) as Row).n);
  }
  saveSyncState(accountId: string, state: StoredSyncState) {
    this.open().prepare(`INSERT INTO sync_state(account_id,payload,updated_at) VALUES(?,?,?)
      ON CONFLICT(account_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`)
      .run(accountId, JSON.stringify(state), Date.now());
  }
  deleteSyncState(accountId: string) {
    this.open().prepare('DELETE FROM sync_state WHERE account_id=?').run(accountId);
  }

  async get<T = any>(key: string): Promise<T | undefined> {
    const db = this.open();
    if (key.startsWith('mail-body:')) return undefined;
    if (key === 'accounts') return (db.prepare('SELECT * FROM accounts ORDER BY created_at').all() as Row[]).map(row => this.mapAccount(row)) as T;
    if (key === 'mail-cache') return this.messagesFor().map(row => this.mapMessage(row)) as T;
    if (key === 'mail-sync') {
      const result: Record<string, StoredSyncState> = {};
      for (const row of db.prepare('SELECT account_id,payload FROM sync_state').all() as Row[]) result[row.account_id] = JSON.parse(row.payload);
      return result as T;
    }
    if (key === 'mail-known') {
      const result: Record<string, number> = {};
      for (const row of db.prepare('SELECT account_id,message_id,first_seen_at FROM known_messages').all() as Row[]) {
        result[row.account_id + ':' + row.message_id] = row.first_seen_at;
      }
      return result as T;
    }
    if (key === 'read') return this.flagMap('read_state') as T;
    if (key === 'read-pending') return this.flagMap('read_pending') as T;
    if (key === 'translated') return this.flagMap('translated_state') as T;
    if (key === 'mail-body-index') {
      const result: BodyIndex = {};
      for (const row of db.prepare('SELECT key,bytes,at FROM body_index').all() as Row[]) result[row.key] = { at: row.at, bytes: row.bytes };
      return result as T;
    }
    if (key === 'bilingual') {
      const result: Record<string, unknown> = {};
      for (const row of db.prepare('SELECT key,payload FROM bilingual').all() as Row[]) result[row.key] = JSON.parse(row.payload);
      return result as T;
    }
    if (key === 'images') {
      const result: Record<string, unknown> = {};
      for (const row of db.prepare('SELECT key,payload FROM images').all() as Row[]) result[row.key] = JSON.parse(row.payload);
      return result as T;
    }
    const row = db.prepare('SELECT payload FROM kv WHERE key=?').get(key) as Row | undefined;
    return (row ? JSON.parse(row.payload) : undefined) as T;
  }

  async set(key: string, value: any): Promise<void> {
    const db = this.open();
    if (key === 'accounts') return this.saveAccounts(value || []);
    if (key === 'mail-cache') return this.saveMessages(value || []);
    if (key === 'mail-sync') {
      db.exec('BEGIN');
      try {
        db.exec('DELETE FROM sync_state');
        const insert = db.prepare('INSERT INTO sync_state(account_id,payload,updated_at) VALUES(?,?,?)');
        for (const [accountId, state] of Object.entries(value || {})) insert.run(accountId, JSON.stringify(state), Date.now());
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return;
    }
    if (key === 'mail-known') {
      db.exec('BEGIN');
      try {
        db.exec('DELETE FROM known_messages');
        const insert = db.prepare('INSERT INTO known_messages(account_id,message_id,first_seen_at) VALUES(?,?,?)');
        for (const [item, at] of Object.entries(value || {})) {
          const split = item.indexOf(':');
          if (split > 0) insert.run(item.slice(0, split), item.slice(split + 1), Number(at) || Date.now());
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return;
    }
    if (key === 'read') return this.saveFlags('read_state', value || {});
    if (key === 'read-pending') return this.saveFlags('read_pending', value || {});
    if (key === 'translated') return this.saveFlags('translated_state', value || {});
    if (key === 'mail-body-index') {
      db.exec('BEGIN');
      try {
        db.exec('DELETE FROM body_index');
        const insert = db.prepare('INSERT INTO body_index(key,account_id,message_id,bytes,at) VALUES(?,?,?,?,?)');
        for (const [bodyKey, info] of Object.entries(value || {})) {
          const split = bodyKey.indexOf(':');
          insert.run(bodyKey, split > 0 ? bodyKey.slice(0, split) : '', split > 0 ? bodyKey.slice(split + 1) : bodyKey,
            Number((info as any)?.bytes) || 0, Number((info as any)?.at) || Date.now());
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return;
    }
    if (key === 'bilingual' || key === 'images') {
      const table = key;
      db.exec('BEGIN');
      try {
        db.exec(`DELETE FROM ${table}`);
        const insert = db.prepare(`INSERT INTO ${table}(key,payload,at) VALUES(?,?,?)`);
        for (const [item, payload] of Object.entries(value || {})) insert.run(item, JSON.stringify(payload), Date.now());
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return;
    }
    if (key.startsWith('mail-body:')) return;
    db.prepare('INSERT INTO kv(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload')
      .run(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    const db = this.open();
    if (key.startsWith('mail-body:')) {
      db.prepare('DELETE FROM body_index WHERE key=?').run(key.slice('mail-body:'.length));
      return;
    }
    if (key === 'accounts') { db.exec('DELETE FROM accounts'); return; }
    if (key === 'mail-cache') { db.exec('DELETE FROM messages'); return; }
    if (key === 'mail-sync') { db.exec('DELETE FROM sync_state'); return; }
    if (key === 'mail-known') { db.exec('DELETE FROM known_messages'); return; }
    if (key === 'read') { db.exec('DELETE FROM read_state'); return; }
    if (key === 'read-pending') { db.exec('DELETE FROM read_pending'); return; }
    if (key === 'translated') { db.exec('DELETE FROM translated_state'); return; }
    if (key === 'mail-body-index') { db.exec('DELETE FROM body_index'); return; }
    if (key === 'bilingual') { db.exec('DELETE FROM bilingual'); return; }
    if (key === 'images') { db.exec('DELETE FROM images'); return; }
    db.prepare('DELETE FROM kv WHERE key=?').run(key);
  }

  async keys(): Promise<string[]> {
    const db = this.open();
    return ['accounts', 'mail-cache', 'mail-sync', 'mail-known', 'read', 'read-pending', 'translated',
      'mail-body-index', 'bilingual', 'images',
      ...(db.prepare('SELECT key FROM body_index').all() as Row[]).map(row => 'mail-body:' + row.key)];
  }

  clearAccount(accountId: string) {
    const db = this.open();
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM messages WHERE account_id=?').run(accountId);
      db.prepare('DELETE FROM sync_state WHERE account_id=?').run(accountId);
      db.prepare('DELETE FROM known_messages WHERE account_id=?').run(accountId);
      db.prepare('DELETE FROM read_state WHERE account_id=?').run(accountId);
      db.prepare('DELETE FROM read_pending WHERE account_id=?').run(accountId);
      db.prepare('DELETE FROM translated_state WHERE account_id=?').run(accountId);
      db.prepare('DELETE FROM body_index WHERE account_id=?').run(accountId);
      db.prepare("DELETE FROM bilingual WHERE key LIKE ?").run(accountId + ':%');
      db.prepare("DELETE FROM images WHERE key LIKE ?").run(accountId + ':%');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  putBodyIndex(key: string, accountId: string, messageId: string, bytes: number) {
    this.open().prepare(`INSERT INTO body_index(key,account_id,message_id,bytes,at) VALUES(?,?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET bytes=excluded.bytes,at=excluded.at`).run(key, accountId, messageId, bytes, Date.now());
  }

  async importLegacy(data: {
    accounts?: Account[]; cache?: MailSummary[]; sync?: Record<string, StoredSyncState>;
    known?: Record<string, number>; read?: Record<string, boolean>; pending?: Record<string, boolean>;
    translated?: Record<string, boolean>; bilingual?: Record<string, unknown>; images?: Record<string, unknown>;
  }) {
    if (this.imported()) return;
    if (data.accounts?.length) this.saveAccounts(data.accounts);
    if (data.cache?.length) this.saveMessages(data.cache);
    if (data.read) await this.set('read', data.read);
    if (data.pending) await this.set('read-pending', data.pending);
    if (data.translated) await this.set('translated', data.translated);
    if (data.sync) await this.set('mail-sync', data.sync);
    if (data.known) await this.set('mail-known', data.known);
    if (data.bilingual) await this.set('bilingual', data.bilingual);
    if (data.images) await this.set('images', data.images);
  }
}

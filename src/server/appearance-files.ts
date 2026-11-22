import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assert } from '../shared/error-codes';

type Store = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
};

export interface BackgroundMeta {
  name: string;
  mime: string;
  bytes: number;
  updatedAt: number;
}
export type BackgroundSlot = 'desktop' | 'mobile';

interface Upload {
  partition: string;
  slot: BackgroundSlot;
  name: string;
  mime: string;
  chunks: Buffer[];
  bytes: number;
  at: number;
}

const maxBytes = 20 * 1024 * 1024;
const maxChunk = 900_000;
const readBytes = 525_000;
const uploadTtl = 10 * 60 * 1000;

export class AppearanceFiles {
  private uploads = new Map<string, Upload>();

  constructor(private readonly dataDir: string) {}

  private directory() {
    return join(this.dataDir, 'appearance');
  }

  private file(partition: string, slot: BackgroundSlot) {
    return join(this.directory(), slot === 'mobile' ? `${partition}-mobile.img` : `${partition}.img`);
  }

  private metaKey(slot: BackgroundSlot) {
    return slot === 'mobile' ? 'appearance-bg-mobile-meta' : 'appearance-bg-meta';
  }

  private prune(now = Date.now()) {
    for (const [id, upload] of this.uploads) {
      if (now - upload.at > uploadTtl) this.uploads.delete(id);
    }
  }

  start(partition: string, slot: BackgroundSlot, name: string, mime: string) {
    assert(typeof name === 'string' && name.trim().length > 0 && name.length <= 120);
    assert(['image/jpeg', 'image/png', 'image/webp'].includes(mime));
    this.prune();
    if (this.uploads.size >= 8) {
      const oldest = [...this.uploads.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) this.uploads.delete(oldest[0]);
    }
    const uploadId = randomUUID();
    this.uploads.set(uploadId, {
      partition, slot, name: name.trim(), mime, chunks: [], bytes: 0, at: Date.now()
    });
    return { uploadId };
  }

  chunk(partition: string, uploadId: string, data: string) {
    this.prune();
    const upload = this.uploads.get(uploadId);
    assert(upload && upload.partition === partition);
    assert(typeof data === 'string' && data.length <= maxChunk && data.length % 4 === 0);
    assert(/^[a-z0-9+/]*={0,2}$/i.test(data));
    const bytes = Buffer.from(data, 'base64');
    assert(bytes.length > 0 && upload.bytes + bytes.length <= maxBytes);
    upload.chunks.push(bytes);
    upload.bytes += bytes.length;
    upload.at = Date.now();
    return { received: upload.bytes };
  }

  async complete(partition: string, store: Store, uploadId: string, name: string, mime: string, slot: BackgroundSlot) {
    this.prune();
    const upload = this.uploads.get(uploadId);
    assert(upload && upload.partition === partition && upload.slot === slot);
    assert(upload.name === name.trim() && upload.mime === mime);
    const body = Buffer.concat(upload.chunks);
    assert(body.length > 0 && body.length <= maxBytes);
    const actual = detectMime(body);
    assert(actual && ['image/jpeg', 'image/png', 'image/webp'].includes(actual));
    const meta: BackgroundMeta = {
      name: upload.name.slice(0, 120), mime: actual, bytes: body.length, updatedAt: Date.now()
    };
    await this.write(partition, upload.slot, body);
    await store.set(this.metaKey(upload.slot), meta);
    this.uploads.delete(uploadId);
    return meta;
  }

  async get(partition: string, store: Store, slot: BackgroundSlot = 'desktop') {
    const meta = await store.get<BackgroundMeta>(this.metaKey(slot));
    if (!validMeta(meta)) return undefined;
    try {
      const info = await stat(this.file(partition, slot));
      return info.size === meta.bytes ? meta : undefined;
    } catch {
      await store.delete(this.metaKey(slot));
      return undefined;
    }
  }

  async read(partition: string, store: Store, offset: number, length = readBytes, slot: BackgroundSlot = 'desktop') {
    const meta = await this.get(partition, store, slot);
    assert(meta);
    assert(Number.isInteger(offset) && offset >= 0 && offset < meta.bytes);
    assert(Number.isInteger(length) && length > 0);
    const remaining = meta.bytes - offset;
    const wanted = Math.min(length, remaining);
    const size = wanted === remaining ? wanted : wanted - (wanted % 3);
    assert(size > 0);
    const buffer = Buffer.allocUnsafe(size);
    const handle = await open(this.file(partition, slot), 'r');
    try {
      const result = await handle.read(buffer, 0, size, offset);
      assert(result.bytesRead === size);
    } finally {
      await handle.close();
    }
    return {
      data: buffer.toString('base64'),
      nextOffset: offset + size,
      eof: offset + size >= meta.bytes
    };
  }

  async migrate(partition: string, store: Store) {
    const existing = await this.get(partition, store, 'desktop');
    if (existing) return existing;
    const legacy = await store.get<string>('appearance-bg');
    if (typeof legacy !== 'string' || !legacy) return undefined;
    try {
      const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=]+)$/i.exec(legacy);
      assert(match);
      const body = Buffer.from(match[2], 'base64');
      const mime = detectMime(body);
      assert(mime === match[1].toLowerCase() && body.length <= maxBytes);
      const name = String(await store.get('appearance-bg-name') || 'background').slice(0, 120);
      const meta: BackgroundMeta = { name, mime, bytes: body.length, updatedAt: Date.now() };
      await this.write(partition, 'desktop', body);
      await store.delete('appearance-bg');
      await store.delete('appearance-bg-name');
      await store.set('appearance-bg-meta', meta);
      return meta;
    } catch {
      await store.delete('appearance-bg');
      await store.delete('appearance-bg-name');
      return undefined;
    }
  }

  async clear(partition: string, store: Store, slot: BackgroundSlot = 'desktop') {
    await rm(this.file(partition, slot), { force: true });
    await store.delete(this.metaKey(slot));
    if (slot === 'desktop') {
      await store.delete('appearance-bg');
      await store.delete('appearance-bg-name');
    }
  }

  dispose() {
    this.uploads.clear();
  }

  private async write(partition: string, slot: BackgroundSlot, body: Buffer) {
    await mkdir(this.directory(), { recursive: true });
    const target = this.file(partition, slot);
    const temp = `${target}.${randomUUID()}.tmp`;
    await writeFile(temp, body);
    try {
      await rename(temp, target);
    } catch {
      await rm(target, { force: true });
      await rename(temp, target);
    }
  }

}

function detectMime(body: Buffer) {
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (body.length >= 12 && body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return '';
}

function validMeta(value: unknown): value is BackgroundMeta {
  const meta = value as BackgroundMeta | undefined;
  return !!meta && typeof meta.name === 'string' && typeof meta.mime === 'string' &&
    Number.isInteger(meta.bytes) && meta.bytes > 0 && Number.isFinite(meta.updatedAt);
}


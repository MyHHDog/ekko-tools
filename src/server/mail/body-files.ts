import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RawMail } from './parse';

interface StoredBodyFile {
  at: number;
  raw: RawMail;
}

// 邮件正文含附件 base64 时远超宿主键值存储上限，改为按消息哈希落盘，索引仍存插件存储。
export class MailBodyFiles {
  constructor(private readonly dataDir: string) {}

  private directory() {
    return join(this.dataDir, 'mail-bodies');
  }

  private file(key: string) {
    return join(this.directory(), createHash('sha256').update(key).digest('hex') + '.json');
  }

  async get(key: string): Promise<RawMail | undefined> {
    try {
      const value = JSON.parse(await readFile(this.file(key), 'utf8')) as StoredBodyFile;
      return value?.raw && typeof value.raw.messageId === 'string' ? value.raw : undefined;
    } catch {
      return undefined;
    }
  }

  async put(key: string, raw: RawMail) {
    await mkdir(this.directory(), { recursive: true });
    const target = this.file(key);
    const temp = `${target}.${randomUUID()}.tmp`;
    const body = JSON.stringify({ at: Date.now(), raw } satisfies StoredBodyFile);
    await writeFile(temp, body, 'utf8');
    try {
      await rename(temp, target);
    } catch {
      await rm(target, { force: true });
      await rename(temp, target);
    }
    return Buffer.byteLength(body);
  }

  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
}

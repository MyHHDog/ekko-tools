import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { partition } from '../src/server/adapter/host';

export function openMailDb(directory: string) {
  const key = partition({ identity: { userId: 1, profile: 'test' } } as any);
  return new DatabaseSync(join(directory, key, 'mail', 'mail.db'));
}

export function mailBodiesDir(directory: string) {
  const key = partition({ identity: { userId: 1, profile: 'test' } } as any);
  return join(directory, key, 'mail-bodies');
}

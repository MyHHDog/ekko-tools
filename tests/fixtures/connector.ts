import fixtures from './index.json';
import type { Connector, Credentials, ReplyMessage } from '../../src/server/mail/connector';
import type { RawMail } from '../../src/server/mail/parse';
import { AppError } from '../../src/shared/error-codes';

export type FixtureProvider = '163' | 'qq' | 'gmail';

export class FixtureConnector implements Connector {
  private seenByMessage = new Map<string, boolean>();
  sent: { to: string; subject: string; text: string }[] = [];

  private key(acc: Credentials, messageId: string) { return acc.account.id + ':' + messageId; }
  private unread(acc: Credentials, mail: RawMail) {
    const seen = this.seenByMessage.get(this.key(acc, mail.messageId));
    return seen === undefined ? mail.unread : !seen;
  }
  async test(_acc: Credentials, signal: AbortSignal) {
    if (signal.aborted) throw new AppError('TIMEOUT', true);
    return { status: 'connected' as const, checkedAt: Date.now() };
  }

  async list(acc: Credentials, q: { cursor?: string; limit: number }, signal: AbortSignal) {
    await this.test(acc, signal);
    const mails = fixtures[acc.account.provider as FixtureProvider] as RawMail[];
    const start = Number(q.cursor || 0);
    return {
      items: mails.slice(start, start + q.limit).map(mail => ({
        accountId: acc.account.id,
        messageId: mail.messageId,
        from: mail.from,
        subject: mail.subject,
        snippet: mail.text.slice(0, 140),
        date: mail.date,
        unread: this.unread(acc, mail),
        hasAttachments: mail.attachments.length > 0,
      })),
      nextCursor: start + q.limit < mails.length ? String(start + q.limit) : undefined,
    };
  }

  async fetch(acc: Credentials, messageId: string, signal: AbortSignal) {
    await this.test(acc, signal);
    const mails = fixtures[acc.account.provider as FixtureProvider] as RawMail[];
    const raw = mails.find(mail => mail.messageId === messageId);
    if (!raw) throw new AppError('NOT_FOUND');
    const copy = structuredClone(raw);
    copy.unread = this.unread(acc, raw);
    return copy;
  }

  async olderCursor(acc: Credentials, messageIds: string[], _signal: AbortSignal) {
    const mails = fixtures[acc.account.provider as FixtureProvider] as RawMail[];
    const indexes = messageIds.map(id => mails.findIndex(mail => mail.messageId === id)).filter(index => index >= 0);
    if (!indexes.length) return undefined;
    const next = Math.max(...indexes) + 1;
    return next < mails.length ? String(next) : undefined;
  }

  async seen(_acc: Credentials, messageIds: string[], _signal: AbortSignal) {
    const mails = fixtures[_acc.account.provider as FixtureProvider] as RawMail[];
    return Object.fromEntries(messageIds.map(messageId => {
      const saved = this.seenByMessage.get(this.key(_acc, messageId));
      const raw = mails.find(mail => mail.messageId === messageId);
      return [messageId, saved ?? (raw ? !raw.unread : false)];
    }));
  }

  setSeen(acc: Credentials, messageId: string, seen: boolean) { this.seenByMessage.set(this.key(acc, messageId), seen); }

  async markRead(acc: Credentials, messageId: string, read: boolean, _signal: AbortSignal) {
    this.seenByMessage.set(this.key(acc, messageId), read);
  }

  async markReadMany(acc: Credentials, messageIds: string[], read: boolean, _signal: AbortSignal) {
    for (const messageId of messageIds) this.seenByMessage.set(this.key(acc, messageId), read);
  }

  async reply(_acc: Credentials, message: ReplyMessage, _signal: AbortSignal) {
    this.sent.push({ to: message.to, subject: message.subject, text: message.text });
    return { messageId: '<fixture-reply@ekko-tools>' };
  }

  close() {}
}

import { EventEmitter } from 'node:events';

export function fixtureImap(uidValidity = 1n) {
  const commands: string[] = [];
  const options: any[] = [];
  const source = Buffer.from('From: Sender <sender@example.com>\r\nTo: demo@example.com\r\nSubject: Integration fixture\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello team.\r\n\r\nPlease review the schedule.');
  class Client extends EventEmitter {
    mailbox = { uidValidity, uidNext: 2, exists: 1 };
    closed = false;
    constructor(option: any) { super(); options.push(option); }
    async connect() { commands.push('LOGIN'); }
    async mailboxOpen(_name: string, opts: any) {
      if (!opts.readOnly) throw Error('必须只读');
      commands.push('EXAMINE');
      return this.mailbox;
    }
    async *fetch(range: string, _query: any, opts: any) {
      commands.push(opts.uid ? 'UID FETCH' : 'FETCH');
      yield { uid: 1, envelope: { subject: 'Integration fixture', from: [{ name: 'Sender', address: 'sender@example.com' }], date: new Date(1794580000000) }, flags: new Set(), bodyStructure: {} };
    }
    async fetchOne(_uid: string, query: any) {
      commands.push(query.source ? 'UID FETCH BODY.PEEK' : 'UID FETCH SIZE');
      return { uid: 1, size: source.length, source, flags: new Set() };
    }
    close() { if (!this.closed) { this.closed = true; commands.push('CLOSE SOCKET'); } }
  }
  return { commands, options, factory: (opts: any) => new Client(opts) as any };
}

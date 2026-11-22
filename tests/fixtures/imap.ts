import { EventEmitter } from 'node:events';

export function fixtureImap(uidValidity = 1n, initialMessages = 1, writable?:{capabilities:string[];trash:boolean;rejectMove?:boolean}) {
  const commands: string[] = [];
  const options: any[] = [];
  let total = initialMessages;
  const removed = new Set<number>();
  const uids = () => Array.from({length:total},(_,index)=>index+1).filter(uid=>!removed.has(uid));
  const source = Buffer.from('From: Sender <sender@example.com>\r\nTo: demo@example.com\r\nSubject: Integration fixture\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello team.\r\n\r\nPlease review the schedule.');
  class Client extends EventEmitter {
    mailbox = { uidValidity, uidNext: total + 1, exists: total };
    capabilities = new Set(writable?.capabilities);
    enabled = new Set<string>();
    closed = false;
    constructor(option: any) { super(); options.push(option); }
    async connect() { commands.push('LOGIN'); }
    async mailboxOpen(_name: string, opts: any) {
      if (!opts.readOnly && !writable) throw Error('必须只读');
      commands.push(opts.readOnly?'EXAMINE':'SELECT');
      this.mailbox = { uidValidity, uidNext: total + 1, exists: uids().length };
      return this.mailbox;
    }
    async *fetch(range: string, _query: any, opts: any) {
      commands.push(opts.uid ? 'UID FETCH' : 'FETCH');
      const [first, last = first] = range.split(':').map(Number);
      const matching=opts.uid?uids().filter(uid=>first<=uid&&uid<=last):uids().slice(first-1,last);
      for (const uid of matching)
        yield { uid, envelope: { subject: 'Integration fixture', from: [{ name: 'Sender', address: 'sender@example.com' }], date: new Date(1794580000000) }, flags: new Set(), bodyStructure: {} };
    }
    async fetchOne(id: string, query: any) {
      commands.push(query.source?'UID FETCH BODY.PEEK':query.uid?'UID FETCH':'UID FETCH SIZE');
      const uid=Number(id),seq=uids().indexOf(uid)+1;
      return seq?{uid,seq,size:source.length,source,flags:new Set()}:false;
    }
    async list(){return writable?.trash?[{path:'Trash',specialUse:'\\Trash',flags:new Set()}]:[];}
    async messageMove(uid:string,path:string,opts:{uid:boolean}){
      commands.push(`${opts.uid?'UID ':''}MOVE ${uid} ${path}`);
      if(writable?.rejectMove)return false;
      removed.add(Number(uid));return {destination:path};
    }
    async messageCopy(uid:string,path:string,opts:{uid:boolean}){
      commands.push(`${opts.uid?'UID ':''}COPY ${uid} ${path}`);
      return !writable?.rejectMove;
    }
    async messageDelete(uid:string,opts:{uid:boolean}){
      commands.push(`${opts.uid?'UID ':''}EXPUNGE ${uid}`);
      removed.add(Number(uid));return true;
    }
    close() { if (!this.closed) { this.closed = true; commands.push('CLOSE SOCKET'); } }
  }
  return { commands, options, deliver: () => ++total, factory: (opts: any) => new Client(opts) as any };
}

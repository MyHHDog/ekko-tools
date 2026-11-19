import { mkdir, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { seal, unseal } from './crypto';
import { AppError } from '../../shared/error-codes';
export class Vault {
  private queue: Promise<unknown>=Promise.resolve();
  private snapshot?:{at:number;mtimeMs:number;size:number;data:Record<string,string>};
  constructor(private directory: string,private passphrase?: string) {}
  private async password() {
    await mkdir(this.directory,{recursive:true,mode:0o700});
    if (this.passphrase) return this.passphrase;
    const file=join(this.directory,'vault.key');
    try { return await readFile(file); } catch (e) {
      if ((e as NodeJS.ErrnoException).code!=='ENOENT') throw e;
      const key=randomBytes(32);
      try { await writeFile(file,key,{flag:'wx',mode:0o600}); return key; }
      catch (e) { key.fill(0); if ((e as NodeJS.ErrnoException).code==='EEXIST') return readFile(file); throw e; }
    }
  }
  private async entries(password: string|Buffer) {
    try { return await unseal(await readFile(join(this.directory,'vault.bin')),password); }
    catch (e) { if ((e as NodeJS.ErrnoException).code==='ENOENT') return {}; throw new AppError('VAULT_LOCKED'); }
  }
  private async fileState() {
    try { const value=await stat(join(this.directory,'vault.bin'));return {mtimeMs:value.mtimeMs,size:value.size}; }
    catch { return {mtimeMs:0,size:0}; }
  }
  private async data() {
    if(this.snapshot&&Date.now()-this.snapshot.at<30_000){
      const file=await this.fileState();
      if(file.mtimeMs===this.snapshot.mtimeMs&&file.size===this.snapshot.size)return {...this.snapshot.data};
    }
    const password=await this.password();
    try {
      const value=await this.entries(password);
      this.snapshot={at:Date.now(),...await this.fileState(),data:value};
      return {...value};
    } finally { if (Buffer.isBuffer(password)) password.fill(0); }
  }
  private run<T>(task: ()=>Promise<T>): Promise<T> {
    const next=this.queue.then(task); this.queue=next.catch(()=>{}); return next;
  }
  async get(id: string) {
    return this.run(async()=>{const data=await this.data();if (!(id in data)) throw new AppError('NOT_FOUND');return data[id];});
  }
  private change(id: string,value?: string) {
    return this.run(async()=>{const data=await this.data();
      if (value===undefined) delete data[id]; else data[id]=value;
      const tmp=join(this.directory,'vault.bin.tmp');
      try {
        const password=await this.password();
        try { await writeFile(tmp,await seal(data,password),{mode:0o600}); }
        finally { if(Buffer.isBuffer(password)) password.fill(0); }
        await rename(tmp,join(this.directory,'vault.bin'));
        this.snapshot={at:Date.now(),...await this.fileState(),data:{...data}};
      } catch(e) { await unlink(join(this.directory,'vault.bin.tmp')).catch(()=>{}); throw e; }
    });
  }
  put(id: string,value: string) { return this.change(id,value); }
  delete(id: string) { return this.change(id); }
}

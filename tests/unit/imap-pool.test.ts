import {describe,it,expect,vi} from 'vitest';
import {ImapPool} from '../../src/server/mail/imap-pool';
import {lifecycle} from '../helpers';

function fakeClient(){
  const listeners=new Map<string,(value?:unknown)=>void>();
  const client={
    usable:true,
    connect:vi.fn(async()=>{}),
    close:vi.fn(()=>{
      client.usable=false;
      listeners.get('close')?.();
    }),
    on:vi.fn((name:string,listener:(value?:unknown)=>void)=>{
      listeners.set(name,listener);
      return client;
    }),
  };
  return client;
}

describe('IMAP 连接池',()=>{
  it('并发租用共享连接，最后一个租约释放后才关闭',async()=>{
    const life=lifecycle(),client=fakeClient(),factory=vi.fn(()=>client as any);
    const pool=new ImapPool(life,factory,20);
    const first=await pool.acquire('account',{} as any);
    const second=await pool.acquire('account',{} as any);
    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
    pool.release('account',first);
    await new Promise(resolve=>setTimeout(resolve,40));
    expect(client.close).not.toHaveBeenCalled();
    pool.release('account',second);
    await new Promise(resolve=>setTimeout(resolve,40));
    expect(client.close).toHaveBeenCalledTimes(1);
  });
});

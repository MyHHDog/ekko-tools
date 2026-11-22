import {randomUUID} from 'node:crypto';
import {assert} from '../../shared/error-codes';
import {maxDraftAttachmentBytes,maxDraftSnapshotBytes} from '../../shared/mail';

const ttl=15*60*1000;
type Upload={buffer:Buffer;received:number;expires:number;kind:'attachment'|'snapshot'};

export class DraftUploads {
  private uploads=new Map<string,Upload>();

  private prune(){
    const now=Date.now();
    for(const [id,upload] of this.uploads)if(upload.expires<=now)this.uploads.delete(id);
  }

  start(bytes:number,kind:Upload['kind']){
    this.prune();
    const cap=kind==='attachment'?maxDraftAttachmentBytes:maxDraftSnapshotBytes;
    assert(Number.isInteger(bytes)&&bytes>0&&bytes<=cap);
    const reserved=[...this.uploads.values()].reduce((sum,item)=>sum+item.buffer.length,0);
    assert(this.uploads.size<12&&reserved+bytes<=2*(maxDraftAttachmentBytes+maxDraftSnapshotBytes));
    const uploadId=randomUUID();
    this.uploads.set(uploadId,{buffer:Buffer.alloc(bytes),received:0,kind,expires:Date.now()+ttl});
    return {uploadId};
  }

  append(wire:string){
    this.prune();
    const [id,encodedOffset,data,extra]=wire.split('!',4);
    assert(/^[a-f0-9-]{36}$/.test(id)&&/^[0-9a-z]{1,5}$/.test(encodedOffset)&&data&&extra===undefined);
    const offset=Number.parseInt(encodedOffset,36);
    assert(offset.toString(36)===encodedOffset);
    const upload=this.uploads.get(id);
    assert(upload,'NOT_FOUND');
    assert(offset===upload.received&&/^[\w-]+$/.test(data));
    const chunk=Buffer.from(data,'base64url');
    assert(chunk.length&&chunk.toString('base64url')===data&&offset+chunk.length<=upload.buffer.length);
    chunk.copy(upload.buffer,offset);
    upload.received+=chunk.length;upload.expires=Date.now()+ttl;
    return {received:upload.received};
  }

  complete(id:string,kind:Upload['kind']){
    this.prune();
    const upload=this.uploads.get(id);
    assert(upload,'NOT_FOUND');
    assert(upload.kind===kind&&upload.received===upload.buffer.length);
    return upload.buffer;
  }

  drop(id:string){return {deleted:this.uploads.delete(id)};}
  clear(){this.uploads.clear();}
}

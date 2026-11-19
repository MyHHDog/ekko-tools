import { randomBytes, scrypt, createCipheriv, createDecipheriv } from 'node:crypto';
const derive=(password:string|Buffer,salt:Buffer)=>new Promise<Buffer>((resolve,reject)=>{
  scrypt(password,salt,32,{N:16384,r:8,p:1},(error,key)=>error?reject(error):resolve(key));
});
export async function seal(data: Record<string,string>, password: string|Buffer) {
  const salt=randomBytes(16), iv=randomBytes(12);
  const key=await derive(password,salt);
  try {
    const cipher=createCipheriv('aes-256-gcm',key,iv);
    const header=Buffer.from(JSON.stringify({version:1,N:16384,r:8,p:1,salt:salt.toString('base64')}));
    cipher.setAAD(header);
    const ciphertext=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);
    return Buffer.from(JSON.stringify({header:header.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}));
  } finally { key.fill(0); }
}
export async function unseal(raw: Buffer,password: string|Buffer): Promise<Record<string,string>> {
  const doc=JSON.parse(raw.toString()), header=Buffer.from(doc.header,'base64'), meta=JSON.parse(header.toString());
  if (meta.version!==1||meta.N!==16384||meta.r!==8||meta.p!==1) throw Error('Invalid header');
  const key=await derive(password,Buffer.from(meta.salt,'base64'));
  try {
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(doc.iv,'base64'));
    decipher.setAAD(header); decipher.setAuthTag(Buffer.from(doc.tag,'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(doc.ciphertext,'base64')),decipher.final()]).toString());
  } finally { key.fill(0); }
}

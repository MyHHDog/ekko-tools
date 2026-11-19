import { mkdir,writeFile,appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
export async function writeChunks(file,text){
  await mkdir(dirname(file),{recursive:true});
  await writeFile(file,'');
  const lines=text.replace(/\r\n/g,'\n').split('\n');
  for(let i=0;i<lines.length;i+=50)await appendFile(file,lines.slice(i,i+50).join('\n')+(i+50<lines.length?'\n':''));
}

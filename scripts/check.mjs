import {readFile,stat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const manifest=JSON.parse(await readFile('plugin.json','utf8')),pkg=JSON.parse(await readFile('package.json','utf8'));
const icons='settings skills mcp code terminal bot folder book chart grid history chat'.split(' ');
assert.equal(manifest.apiVersion,1);assert.equal(manifest.version,pkg.version);
assert.equal(manifest.workspace,undefined);assert(manifest.views.some(v=>v.slot==='workspace'));
assert.equal(new Set(manifest.views.map(v=>v.id)).size,manifest.views.length);
for(const view of manifest.views){assert(['page','workspace','settings','agent-settings'].includes(view.slot));if(view.slot==='workspace')assert(icons.includes(view.icon));}
for(const nav of manifest.navigation.main){assert(manifest.views.some(v=>v.id===nav.viewId));assert(nav.icon);if(!icons.includes(nav.icon)){assert(/\.(png|jpe?g|webp|gif)$/i.test(nav.icon));assert((await stat(nav.icon)).size<=256*1024);}}
assert(manifest.configSchema.properties.baiduSecret.secret);assert(manifest.configSchema.properties.vaultPassphrase.secret);assert(!('config' in manifest));
assert(!pkg.scripts.install.includes('npm'));
async function files(dir){return (await Promise.all((await readdir(dir,{withFileTypes:true})).map(async ent=>ent.isDirectory()?files(join(dir,ent.name)):[join(dir,ent.name)]))).flat();}
const glassFiles=/[\\/](theme-studio|studio-surfaces)\.css$/;
for(const file of await files('src/client')){
  const source=await readFile(file,'utf8');if(file.endsWith('design-tokens.css'))continue;
  assert(!/\b(fetch|XMLHttpRequest|WebSocket|localStorage)\s*[.(]/.test(source),`${file} 不能直接网络或 localStorage`);
  if(file.endsWith('.css')){if(!glassFiles.test(file))assert(!/backdrop-filter\s*:/.test(source));assert(!/#[\da-f]{3,8}\b|rgba?\(/i.test(source),`${file} 颜色应来自 token`);}
}
for(const file of [manifest.client,manifest.server])assert((await stat(file)).size>0);
console.log('清单、slot、图标、凭据 schema、客户端网络边界和样式静态检查通过');

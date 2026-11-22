import { existsSync, readFileSync } from 'node:fs';
import { assertContracts, validateModel } from '../../sdk/harness/contracts.mjs';

const contractUrl=['../contracts/plugin.json','../../contracts/plugin.json'].map(path=>new URL(path,import.meta.url)).find(url=>existsSync(url));
if(!contractUrl)throw new Error('contracts/plugin.json 不存在：插件目录必须完整分发');
export const contract=assertContracts(JSON.parse(readFileSync(contractUrl,'utf8')));
export const validateStored=(key:string,value:unknown)=>validateModel(contract,contract.storage[key].model,value);
export const validateEvent=(key:string,value:unknown)=>validateModel(contract,contract.events[key].model,value);

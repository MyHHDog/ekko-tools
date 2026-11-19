import type { ProviderResult, TranslateRequest } from '../../shared/types';
import { assert } from '../../shared/error-codes';
import { languages } from '../../shared/rpc-contract';
export interface TranslateProvider {
  readonly id: 'baidu'|'deepl'|'hostModel'|'openai';
  isConfigured(): boolean;
  translate(request: TranslateRequest,signal: AbortSignal): Promise<ProviderResult>;
}
export function validateRequest(req: TranslateRequest) {
  assert(req&&typeof req.text==='string'&&req.text.trim());
  assert(Array.from(req.text).length<=5000,'INPUT_TOO_LONG');
  assert(languages.includes(req.from as 'auto')&&languages.slice(1).includes(req.to as 'zh'),'UNSUPPORTED_LANGUAGE');
  assert(!req.provider||['baidu','deepl','hostModel','openai'].includes(req.provider));
}
export function detect(text: string) {return /[\u3040-\u30ff]/u.test(text)?'ja':/[\u4e00-\u9fff]/u.test(text)?'zh':'en';}
export function needsTranslation(text:string,target:string) {
  const prose=text.replace(/https?:\/\/\S+|www\.\S+|\S+@\S+/giu,' ');
  const detected=detect(prose);
  return detected!==target||((target==='zh'||target==='ja')&&/[a-z]{2,}/i.test(prose));
}

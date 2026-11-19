import { lookup } from 'node:dns/promises';
import { fetch as undiciFetch } from 'undici';
import { AppError } from '../../shared/error-codes';
import type { RssProxyMode } from '../../shared/rss';
import { proxyAgent, resolveRssProxy } from './proxy';
export interface FetchOptions {
  timeoutMs?: number; limit?: number; etag?: string; lastModified?: string; allowPrivate?: boolean;
  proxy?: { mode: RssProxyMode; url: string };
}
export interface FetchedPage {
  url: string; status: number; body: string; contentType: string;
  etag?: string; lastModified?: string;
}
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 EkkoTools/0.12';
const MAX_REDIRECTS = 5;
const privateV4 = [
  [/^0\./, '0.0.0.0/8'], [/^10\./, '10.0.0.0/8'], [/^127\./, '127.0.0.0/8'],
  [/^169\.254\./, '169.254.0.0/16'], [/^172\.(1[6-9]|2\d|3[01])\./, '172.16.0.0/12'],
  [/^192\.168\./, '192.168.0.0/16'], [/^224\./, '224.0.0.0/4'],
] as const;
function privateAddress(address: string) {
  if (address.includes(':')) {
    const value = address.toLowerCase();
    return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') ||
      value.startsWith('fe80:') || value.startsWith('ff');
  }
  return privateV4.some(([pattern]) => pattern.test(address));
}
async function checkedUrl(raw: string, allowPrivate: boolean) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new AppError('VALIDATION'); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new AppError('VALIDATION');
  if (allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0') throw new AppError('VALIDATION');
  if (privateAddress(host)) throw new AppError('VALIDATION');
  let addresses: { address: string }[] = [];
  try { addresses = await lookup(host, { all: true, verbatim: true }); }
  catch { throw new AppError('NETWORK_UNREACHABLE', true, 'network'); }
  if (!addresses.length || addresses.some(item => privateAddress(item.address))) throw new AppError('VALIDATION');
  return url;
}
export function decodeBody(raw: ArrayBuffer, contentType: string) {
  const match = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType);
  const encoding = match?.[1]?.toLowerCase();
  try {
    return new TextDecoder(encoding === 'gb2312' ? 'gbk' : encoding || 'utf-8').decode(raw);
  } catch {
    return new TextDecoder('utf-8').decode(raw);
  }
}
export async function fetchText(raw: string, options: FetchOptions = {}): Promise<FetchedPage> {
  const timeoutMs = Math.max(3000, options.timeoutMs || 20000);
  const limit = Math.max(64 * 1024, options.limit || 3 * 1024 * 1024);
  const headers: Record<string, string> = {
    'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, */*;q=0.5',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
  if (options.etag) headers['If-None-Match'] = options.etag;
  if (options.lastModified) headers['If-Modified-Since'] = options.lastModified;
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await checkedUrl(current, options.allowPrivate === true);
    const proxyUrl = await resolveRssProxy(url.toString(), options.proxy?.mode || 'none', options.proxy?.url || '');
    let response: Response;
    try {
      response = await undiciFetch(url, {
        headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
        ...(proxyUrl ? { dispatcher: proxyAgent(proxyUrl) } : {}),
      }) as unknown as Response;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('NETWORK_UNREACHABLE', true, 'network');
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || hop === MAX_REDIRECTS) throw new AppError('NETWORK_UNREACHABLE', true, 'network');
      current = new URL(location, url).toString();
      continue;
    }
    if (response.status === 304) return { url: url.toString(), status: 304, body: '', contentType: '', etag: options.etag, lastModified: options.lastModified };
    if (!response.ok) throw new AppError('NETWORK_UNREACHABLE', response.status >= 500, 'network');
    const length = Number(response.headers.get('content-length') || 0);
    if (length > limit) throw new AppError('FEED_TOO_LARGE');
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > limit) throw new AppError('FEED_TOO_LARGE');
    const contentType = response.headers.get('content-type') || '';
    return {
      url: response.url || url.toString(), status: response.status, body: decodeBody(buffer, contentType),
      contentType, etag: response.headers.get('etag') || undefined,
      lastModified: response.headers.get('last-modified') || undefined,
    };
  }
  throw new AppError('NETWORK_UNREACHABLE', true, 'network');
}

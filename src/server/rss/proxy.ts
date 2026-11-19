import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProxyAgent } from 'undici';
import { AppError } from '../../shared/error-codes';
import type { RssProxyMode } from '../../shared/rss';

const exec = promisify(execFile);
const agents = new Map<string, ProxyAgent>();
const systemCache = new Map<string, { at: number; value?: string }>();
const SYSTEM_TTL = 15_000;

export function shouldBypassProxy(hostname: string, patterns?: string) {
  if (!patterns) return false;
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  for (const raw of patterns.split(/[;,]/)) {
    let pattern = raw.trim().toLowerCase();
    if (!pattern) continue;
    if (pattern === '*') return true;
    if (pattern === '<local>') {
      if (!host.includes('.') || host === 'localhost') return true;
      continue;
    }
    pattern = pattern.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split('/')[0].replace(/:\d+$/, '').replace(/^\*?\./, '');
    if (pattern && (host === pattern || host.endsWith(`.${pattern}`))) return true;
  }
  return false;
}

export function normalizeProxyUrl(raw: string) {
  const input = raw.trim();
  if (!input) throw new AppError('VALIDATION', false, 'configuration');
  const text = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `http://${input}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new AppError('VALIDATION', false, 'configuration');
  }
  if (!/^https?:$/.test(url.protocol) || !url.hostname) throw new AppError('VALIDATION', false, 'configuration');
  if (url.username || url.password) throw new AppError('VALIDATION', false, 'configuration');
  return `${url.protocol}//${url.host}`;
}

export function selectEnvProxy(target: URL, env: Record<string, string | undefined> = process.env) {
  if (shouldBypassProxy(target.hostname, env.NO_PROXY || env.no_proxy)) return undefined;
  const https = target.protocol === 'https:';
  const value = https
    ? env.HTTPS_PROXY || env.https_proxy || env.ALL_PROXY || env.all_proxy
    : env.HTTP_PROXY || env.http_proxy || env.ALL_PROXY || env.all_proxy;
  if (!value) return undefined;
  try {
    return normalizeProxyUrl(value);
  } catch {
    return undefined;
  }
}

export function parseWindowsProxy(server: string, protocol: 'http:' | 'https:') {
  const entries = server.split(';').map(value => value.trim()).filter(Boolean);
  const named = new Map<string, string>();
  let fallback = '';
  for (const entry of entries) {
    const split = entry.indexOf('=');
    if (split > 0) named.set(entry.slice(0, split).trim().toLowerCase(), entry.slice(split + 1).trim());
    else if (!fallback) fallback = entry;
  }
  const value = named.get(protocol === 'https:' ? 'https' : 'http') || named.get('http') || fallback;
  if (!value) return undefined;
  try {
    return normalizeProxyUrl(value);
  } catch {
    return undefined;
  }
}

async function windowsProxy(target: URL) {
  const { stdout } = await exec('reg', [
    'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
  ], { windowsHide: true, timeout: 2500 });
  const value = (name: string) => {
    const match = new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+?)\\s*$`, 'im').exec(stdout);
    return match?.[1]?.trim();
  };
  if (!/^(0x)?1$/i.test(value('ProxyEnable') || '')) return undefined;
  if (shouldBypassProxy(target.hostname, value('ProxyOverride'))) return undefined;
  const server = value('ProxyServer');
  return server ? parseWindowsProxy(server, target.protocol === 'https:' ? 'https:' : 'http:') : undefined;
}

async function macProxy(target: URL) {
  const { stdout } = await exec('scutil', ['--proxy'], { timeout: 2500 });
  const field = new Map<string, string>();
  for (const match of stdout.matchAll(/^\s*([A-Za-z]+)\s*:\s*(.+?)\s*$/gm)) {
    if (!/^\d+$/.test(match[1])) field.set(match[1], match[2]);
  }
  const prefix = target.protocol === 'https:' ? 'HTTPS' : 'HTTP';
  if (field.get(`${prefix}Enable`) !== '1') return undefined;
  const host = field.get(`${prefix}Proxy`) || field.get('HTTPProxy');
  const port = field.get(`${prefix}Port`) || field.get('HTTPPort');
  if (!host || !port) return undefined;
  return normalizeProxyUrl(`${host}:${port}`);
}

async function systemProxy(target: URL) {
  const fromEnv = selectEnvProxy(target);
  if (fromEnv) return fromEnv;
  if (process.platform === 'win32') {
    try { return await windowsProxy(target); } catch { return undefined; }
  }
  if (process.platform === 'darwin') {
    try { return await macProxy(target); } catch { return undefined; }
  }
  return undefined;
}

export async function resolveRssProxy(target: string, mode: RssProxyMode, customUrl: string) {
  if (mode === 'none') return undefined;
  if (mode === 'custom') return normalizeProxyUrl(customUrl);
  const url = new URL(target);
  const key = `${url.protocol}//${url.hostname}`;
  const hit = systemCache.get(key);
  if (hit && Date.now() - hit.at < SYSTEM_TTL) return hit.value;
  const value = await systemProxy(url);
  systemCache.set(key, { at: Date.now(), value });
  return value;
}

export function proxyAgent(url: string) {
  let agent = agents.get(url);
  if (!agent) {
    agent = new ProxyAgent(url);
    agents.set(url, agent);
  }
  return agent;
}

export async function closeProxyAgents() {
  const current = [...agents.values()];
  agents.clear();
  systemCache.clear();
  await Promise.allSettled(current.map(agent => agent.close()));
}

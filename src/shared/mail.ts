import type { ServerEndpoint } from './types';

export type MailBodyFormat = 'plain' | 'markdown';
export interface MailDraftAttachment { id: string; name: string; bytes: number }
export interface MailDraftFields { accountId: string; to: string; subject: string; body: string; format?: MailBodyFormat }
export interface MailDraftSave extends MailDraftFields { id?: string; attachments?: {id:string;name:string}[] }
export interface MailDraft extends MailDraftFields { id: string; updatedAt: number; attachments?: MailDraftAttachment[] }
export type MailDraftSummary = Omit<MailDraft, 'body' | 'format' | 'attachments'>;
export const maxDraftAttachments = 5;
export const maxDraftAttachmentBytes = 10 * 1024 * 1024;
export const maxDraftSnapshotBytes = 128_000;
export const cleanDraftFilename=(name:string)=>name.trim().replace(/[/\\:\u0000-\u001f\u007f]/g,'_').replace(/^\.+/,'_').slice(0,180).trim();
export const blockedAttachmentExtension=(name:string)=>/\.(exe|com|bat|cmd|ps1|msi|scr|js|vbs|lnk|html?|svg|reg|jar|app|sh|hta)$/i.test(name);
export const isMailboxAddress = (address: string) => {
  const [local, domain, extra] = address.split('@');
  return extra === undefined && address.length <= 254 && local.length <= 64 &&
    /^[\w!#$%&'*+\/=?^`{|}~-]+(?:\.[\w!#$%&'*+\/=?^`{|}~-]+)*$/.test(local) &&
    !!domain && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(domain) &&
    !/\s/.test(address);
};

export const defaultMailBodyZoom = 100;
export const minMailBodyZoom = 20;
export const maxMailBodyZoom = 200;

export function normalizeMailBodyZoom(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultMailBodyZoom;
  const rounded = Math.round(value / 10) * 10;
  return Math.min(maxMailBodyZoom, Math.max(minMailBodyZoom, rounded));
}

export function endpointSecure(kind: 'imap' | 'smtp', port: number, fallback: boolean) {
  if (kind === 'imap') return port === 993 ? true : port === 143 ? false : fallback;
  return port === 465 ? true : port === 587 || port === 25 ? false : fallback;
}

export function normalizeEndpoint(endpoint: ServerEndpoint, kind: 'imap' | 'smtp') {
  const secure = endpointSecure(kind, endpoint.port, endpoint.secure);
  if (secure === endpoint.secure) return false;
  endpoint.secure = secure;
  return true;
}

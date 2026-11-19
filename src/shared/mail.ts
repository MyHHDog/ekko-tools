import type { ServerEndpoint } from './types';

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

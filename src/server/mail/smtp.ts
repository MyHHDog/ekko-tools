import nodemailer from 'nodemailer';
import type { Account } from '../../shared/types';
import type { ReplyMessage, ReplyResult } from './connector';
import { AppError } from '../../shared/error-codes';
import { serverEndpoint } from './presets';

const networkCodes = new Set(['ECONNECTION','ECONNREFUSED','ECONNRESET','ENOTFOUND','EAI_AGAIN','ESOCKET','ETIMEDOUT','ETIMEOUT']);

function sendError(error: unknown) {
  const value = error as { code?: string; responseCode?: number; message?: string };
  if (value.code === 'EAUTH' || value.responseCode === 535 || value.responseCode === 534)
    return new AppError('AUTH_FAILED', false, 'authentication');
  if (networkCodes.has(value.code || '')) return new AppError('NETWORK_UNREACHABLE', true, 'network');
  if (/certificate|self.signed|tls/i.test(value.message || '')) return new AppError('SEND_FAILED', false, 'configuration');
  return new AppError('SEND_FAILED', false, 'provider');
}

function transportFor(account: Account, secret: string, timeoutMs: number) {
  const endpoint = serverEndpoint(account, 'smtp');
  return nodemailer.createTransport({
    host: endpoint.host,
    port: endpoint.port,
    secure: endpoint.secure,
    requireTLS: !endpoint.secure,
    auth: { user: account.username || account.address, pass: secret },
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
  });
}

function closeOnAbort(transport: ReturnType<typeof transportFor>, signal: AbortSignal) {
  const close = () => transport.close();
  signal.addEventListener('abort', close, { once: true });
  return () => { signal.removeEventListener('abort', close); transport.close(); };
}

export async function verifySmtp(account: Account, secret: string, signal: AbortSignal, timeoutMs: number) {
  const transport = transportFor(account, secret, timeoutMs), close = closeOnAbort(transport, signal);
  try {
    if (signal.aborted) throw new AppError('TIMEOUT');
    await transport.verify();
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (signal.aborted) throw new AppError('TIMEOUT', true);
    throw sendError(error);
  } finally {
    close();
  }
}

export async function sendReply(account: Account, secret: string, message: ReplyMessage, signal: AbortSignal, timeoutMs: number, alias = 'Ekko Tools'): Promise<ReplyResult> {
  const transport = transportFor(account, secret, timeoutMs), close = closeOnAbort(transport, signal);
  try {
    if (signal.aborted) throw new AppError('TIMEOUT');
    const info = await transport.sendMail({
      from: { name: account.alias || alias, address: account.address },
      to: { name: '', address: message.to },
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments,
      disableFileAccess: true,
      disableUrlAccess: true,
      inReplyTo: message.inReplyTo,
      references: message.references,
    });
    return { messageId: typeof info.messageId === 'string' ? info.messageId : undefined };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (signal.aborted) throw new AppError('TIMEOUT', true);
    throw sendError(error);
  } finally {
    close();
  }
}

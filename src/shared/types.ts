export type MailProviderId = '163' | 'qq' | 'gmail' | 'custom';
export type TranslateProviderId = 'baidu' | 'deepl' | 'hostModel' | 'openai';

export interface ServerEndpoint {
  host: string;
  port: number;
  secure: boolean;
}

export interface GlossaryEntry {
  source: string;
  target: string;
}

export type ErrorCode =
  | 'NETWORK_UNREACHABLE' | 'TIMEOUT' | 'AUTH_FAILED' | 'AUTH_REQUIRED_APP_PASSWORD'
  | 'RATE_LIMITED' | 'PROVIDER_QUOTA' | 'PROVIDER_BAD_RESPONSE' | 'UNSUPPORTED_LANGUAGE'
  | 'INPUT_TOO_LONG' | 'ATTACHMENT_TOO_LARGE' | 'NOT_FOUND' | 'VAULT_LOCKED'
  | 'SEND_FAILED' | 'MAIL_TRASH_UNAVAILABLE' | 'MAIL_DELETE_FAILED' | 'VALIDATION' | 'FEED_TOO_LARGE' | 'FEED_INVALID' | 'INTERNAL';

export interface ErrorInfo {
  category?: 'configuration'|'network'|'authentication'|'provider'|'parse'|'internal';
  code: ErrorCode;
  message: string;          // 用户可读，不含凭据
  retryable: boolean;
  accountId?: string;
}
export type Result<T> = { ok: true; data: T } | { ok: false; error: ErrorInfo };

export type ConnectionState =
  | { status: 'connecting' }
  | { status: 'connected'; checkedAt: number }
  | { status: 'auth_failed'; error: ErrorInfo }
  | { status: 'offline'; error: ErrorInfo; nextRetryAt?: number };

export interface Account {              // 不含任何 secret
  id: string;                           // 随机 UUID
  provider: MailProviderId;
  address: string;                      // 展示时脱敏可选
  alias: string;                        // 来源标记简称，≤6 字
  colorToken: 'a1' | 'a2' | 'a3' | 'a4' | 'a5' | 'a6'; // 映射宿主变量，非色值
  username?: string;                    // 可选：IMAP/SMTP 登录名，缺省用 address
  imap?: ServerEndpoint;                // 自建邮箱必填
  smtp?: ServerEndpoint;                // 自建邮箱必填
  state: ConnectionState;
  createdAt: number;
}

export interface AddAccountInput {
  provider: MailProviderId;
  address: string;
  secret: string;                       // 授权码/应用密码，仅此入参出现
  alias?: string;
  username?: string;
  imap?: ServerEndpoint;
  smtp?: ServerEndpoint;
}

export interface Attachment {
  id: string;
  filename: string;                     // 已清洗，禁止路径分隔符
  mime: string;
  size: number;
  inline: boolean;
  blocked?: 'too_large' | 'dangerous_type';
}

export interface MailSummary {
  translated?: boolean;
  accountId: string;
  messageId: string;                    // 服务端 UID
  from: { name?: string; address: string };
  subject: string;
  snippet: string;                      // 纯文本，≤140 字
  date: number;
  unread: boolean;                      // 仅本地状态
  hasAttachments: boolean;
  lang?: string;                        // 检测结果
}

export interface MailMessage extends MailSummary {
  to: { name?: string; address: string }[];
  cc: { name?: string; address: string }[];
  html?: string;                        // 已清洗（§11），可直接放入 sandbox iframe
  text: string;                         // 纯文本回退
  attachments: Attachment[];
  remoteContentBlocked: boolean;        // 是否拦截了远程图片
}

export interface TranslateRequest {
  text: string;                         // ≤ 5000 字符
  from: string;                         // 'auto' 或语言码
  to: string;
  provider?: TranslateProviderId;
  retryNonce?: string;
}

export interface ProviderResult {
  provider: TranslateProviderId;
  detectedFrom?: string;
  translated: string;
  latencyMs: number;
  usage?: { chars: number };
}

export interface ProviderTestResult {
  provider: TranslateProviderId;
  configured: boolean;
  ok: boolean;
  latencyMs: number;
  sample?: string;
  error?: ErrorInfo;
}

export interface CacheStats {
  entries: number;
  bytes: number;
  oldestAt?: number;
  newestAt?: number;
  cleared?: number;
}

export interface TranslationJob {
  id: string;
  request: TranslateRequest;
  status: 'pending' | 'done' | 'failed';
  result?: ProviderResult;
  error?: ErrorInfo;
  createdAt: number;
  attempts: number;                     // 含自动重试
  cached?: boolean;                     // 命中本地翻译缓存
}

export interface BilingualSegment { index: number; source: string; translated?: string; error?: ErrorInfo }
export interface BilingualBody { messageId: string; segments: BilingualSegment[]; complete: boolean }

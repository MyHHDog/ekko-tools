import type { ErrorCode, ErrorInfo } from './types';
export const messages: Record<ErrorCode,string> = {
  NETWORK_UNREACHABLE:'暂时连不上服务，请稍后重试', TIMEOUT:'请求超时，请重试',
  AUTH_FAILED:'授权失败，请核对授权码或翻译密钥', AUTH_REQUIRED_APP_PASSWORD:'Gmail 需要两步验证和应用专用密码',
  RATE_LIMITED:'请求过于频繁，请稍后重试', PROVIDER_QUOTA:'供应商余额或配额不足',
  PROVIDER_BAD_RESPONSE:'服务返回异常，请重试', UNSUPPORTED_LANGUAGE:'不支持此语言方向',
  INPUT_TOO_LONG:'超出 5000 字，请删减后翻译', ATTACHMENT_TOO_LARGE:'附件超过大小上限，请在邮箱网页版下载',
  NOT_FOUND:'内容不存在或已失效，请刷新', VAULT_LOCKED:'凭据库无法解锁，请检查口令或文件完整性',
  SEND_FAILED:'邮件发送失败，请检查 SMTP 设置和收发权限',
  MAIL_TRASH_UNAVAILABLE:'此邮箱未提供可安全使用的垃圾箱，请在邮箱网页版删除',
  MAIL_DELETE_FAILED:'服务器未确认邮件已移入垃圾箱，请检查邮箱后重试',
  FEED_TOO_LARGE:'订阅内容过大，已停止抓取',
  FEED_INVALID:'订阅内容无法解析，请检查地址或稍后重试',
  VALIDATION:'输入无效，请检查填写内容',
  INTERNAL:'操作未完成，请重试'
};
export class AppError extends Error {
  constructor(public code: ErrorCode, public retryable = false,public category?:ErrorInfo['category']) { super(category==='parse'?'邮件内容无法解析，请重新同步或在邮箱网页版查看':category==='configuration'?'配置不完整，请检查供应商设置后重试':messages[code]); }
}
export function errorInfo(error: unknown): ErrorInfo {
  const accountId=(error as {accountId?:unknown})?.accountId;
  const withAccount=(info:ErrorInfo):ErrorInfo=>typeof accountId==='string'?{...info,accountId}:info;
  if (error instanceof AppError) return withAccount({code:error.code,message:error.message,retryable:error.retryable,category:error.category||categoryOf(error.code)});
  const e = error as {code?:string; authenticationFailed?:boolean; name?:string;cause?:{code?:string}};
  const network=/^(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EPIPE|ECONNABORTED|ERR_STREAM_PREMATURE_CLOSE|NoConnection|ClosedAfterConnectTLS|ClosedAfterConnectText)$/i;
  const response=String((error as {serverResponseCode?:unknown})?.serverResponseCode||'').toUpperCase();
  const code: ErrorCode = e?.authenticationFailed ? 'AUTH_FAILED' :
    e?.name==='AbortError'||e?.code==='ETIMEDOUT' ? 'TIMEOUT' :
    network.test(e?.code||e?.cause?.code||'') ? 'NETWORK_UNREACHABLE' :
    ['UNAVAILABLE','SERVERBUG','LIMIT'].includes(response) ? 'NETWORK_UNREACHABLE' :
    e?.name==='SyntaxError'?'PROVIDER_BAD_RESPONSE':'INTERNAL';
  return withAccount({code,message:messages[code],retryable:['TIMEOUT','NETWORK_UNREACHABLE'].includes(code),category:e?.name==='SyntaxError'?'parse':categoryOf(code)});
}
function categoryOf(code:ErrorCode):NonNullable<ErrorInfo['category']>{
  return code.startsWith('AUTH_')?'authentication':['TIMEOUT','NETWORK_UNREACHABLE'].includes(code)?'network':
    ['VALIDATION','VAULT_LOCKED','UNSUPPORTED_LANGUAGE','INPUT_TOO_LONG','FEED_TOO_LARGE','FEED_INVALID'].includes(code)?'configuration':
    ['PROVIDER_BAD_RESPONSE','PROVIDER_QUOTA','RATE_LIMITED','SEND_FAILED','MAIL_TRASH_UNAVAILABLE','MAIL_DELETE_FAILED'].includes(code)?'provider':'internal';
}
export function assert(value: unknown, code: ErrorCode = 'VALIDATION'): asserts value {
  if (!value) throw new AppError(code);
}

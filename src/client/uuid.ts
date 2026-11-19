type CryptoLike = {
  randomUUID?: () => string;
  getRandomValues?: (bytes: Uint8Array) => Uint8Array;
};

let counter = 0;

function fallbackBytes(bytes: Uint8Array) {
  const now = Date.now();
  const seed = counter++;
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[0] = now & 0xff;
  bytes[1] = (now >>> 8) & 0xff;
  bytes[2] = (now >>> 16) & 0xff;
  bytes[3] = (now >>> 24) & 0xff;
  bytes[10] = seed & 0xff;
  bytes[11] = (seed >>> 8) & 0xff;
  bytes[12] = (seed >>> 16) & 0xff;
  bytes[13] = (seed >>> 24) & 0xff;
}

/** 兼容非安全上下文和旧 WebView：它们可能没有 crypto.randomUUID。 */
export function uuid(): string {
  const api = (globalThis as { crypto?: CryptoLike }).crypto;
  if (typeof api?.randomUUID === 'function') {
    try {
      const value = api.randomUUID();
      if (typeof value === 'string' && value) return value;
    } catch {
      // 继续使用 getRandomValues 或时间戳降级。
    }
  }

  const bytes = new Uint8Array(16);
  let filled = false;
  if (typeof api?.getRandomValues === 'function') {
    try {
      api.getRandomValues(bytes);
      filled = true;
    } catch {
      // 继续使用时间戳与 Math.random 降级。
    }
  }
  if (!filled) fallbackBytes(bytes);

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

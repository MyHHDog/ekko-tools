import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
// 生成 256x256 图标：圆角深底 + 白色书形（命名 icon book 的具象化），替换 1x1 占位图。
const S = 256, R = 56;
const px = new Uint8Array(S * S * 4);
const inRound = (x, y) => { const cx = Math.max(R, Math.min(S - R, x)), cy = Math.max(R, Math.min(S - R, y)); return (x - cx) ** 2 + (y - cy) ** 2 <= R * R; };
const inBook = (x, y) => { // 书本：两页 + 中缝，白色描边风
  const lx = 58, rx = 198, top = 64, mid = 128, bottom = 196, spine = 128;
  const page = (x0, x1) => x >= x0 && x <= x1 && y >= top && y <= bottom && !(x > 66 && x < 190 && y > 78 && y < 88) && !(x > 66 && x < 190 && y > 172 && y < 182);
  return y <= mid ? page(lx, spine - 2) || page(spine + 2, rx) : false;
};
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const i = (y * S + x) * 4;
  if (!inRound(x, y)) continue;
  let r = 51, g = 51, b = 51, a = 255; // --ek-accent #333 底
  if (inBook(x, y)) { r = g = b = 245; } // 白色书页
  if (Math.abs(x - 128) <= 2 && y >= 64 && y <= 196) { r = g = b = 51; } // 中缝镂空
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1); }
// 手写 CRC32
const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const mkChunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), mkChunk('IHDR', ihdr), mkChunk('IDAT', deflateSync(raw)), mkChunk('IEND', Buffer.alloc(0))]);
await writeFile(new URL('../assets/icon.png', import.meta.url), png);
console.log('icon.png 生成：', png.length, '字节，256x256');

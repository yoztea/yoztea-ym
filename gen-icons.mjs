// 生成柚子姨妈 PNG 图标,纯 Node 内置模块(zlib 手撸 CRC32 + PNG 编码)
// 仿 sakura-countdown/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rowLen = width * 4;
  const raw = Buffer.alloc((rowLen + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (rowLen + 1)] = 0; // filter: none
    rgba.copy(raw, y * (rowLen + 1) + 1, y * rowLen, (y + 1) * rowLen);
  }
  const idat = deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function drawIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  // 奶白底
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = 0xFF; buf[i * 4 + 1] = 0xF8; buf[i * 4 + 2] = 0xF5; buf[i * 4 + 3] = 0xFF;
  }
  const petalR = size * 0.18;
  const d = size * 0.20;
  const centerR = size * 0.10;
  const petalCenters = [];
  for (let k = 0; k < 5; k++) {
    const theta = (-90 + k * 72) * Math.PI / 180;
    petalCenters.push({ x: cx + d * Math.cos(theta), y: cy + d * Math.sin(theta) });
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      let drawn = false;
      for (const p of petalCenters) {
        if (Math.hypot(x - p.x, y - p.y) <= petalR) {
          buf[idx] = 0xFF; buf[idx + 1] = 0xB7; buf[idx + 2] = 0xC5; buf[idx + 3] = 0xFF;
          drawn = true; break;
        }
      }
      if (!drawn && Math.hypot(x - cx, y - cy) <= centerR) {
        buf[idx] = 0xFF; buf[idx + 1] = 0xD3; buf[idx + 2] = 0xDC; buf[idx + 3] = 0xFF;
      }
    }
  }
  return buf;
}

const buf192 = drawIcon(192);
writeFileSync('icon-192.png', makePNG(192, 192, buf192));
const buf512 = drawIcon(512);
writeFileSync('icon-512.png', makePNG(512, 512, buf512));
console.log('icons generated: icon-192.png icon-512.png');

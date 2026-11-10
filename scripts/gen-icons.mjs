// 生成 Tauri 需要的图标（PNG + ICO），零依赖，只用 node 内置 zlib。
// 用法: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'src-tauri', 'icons');
mkdirSync(outDir, { recursive: true });

/* ---------------- PNG 编码 ---------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = [];
  let offset = 6 + entries.length * 16;
  for (const e of entries) {
    const b = Buffer.alloc(16);
    b[0] = e.size >= 256 ? 0 : e.size;
    b[1] = e.size >= 256 ? 0 : e.size;
    b[2] = 0;
    b[3] = 0;
    b.writeUInt16LE(1, 4);
    b.writeUInt16LE(32, 6);
    b.writeUInt32LE(e.png.length, 8);
    b.writeUInt32LE(offset, 12);
    offset += e.png.length;
    dir.push(b);
  }
  return Buffer.concat([header, ...dir, ...entries.map((e) => e.png)]);
}

/* ---------------- 光栅化 ---------------- */
const BG_TOP = [0x23, 0x28, 0x35];
const BG_BOT = [0x14, 0x18, 0x22];
const LINE = [0x58, 0xa6, 0xff];
const NODE = [0x7e, 0xe7, 0x87];
const HOLE = [0x14, 0x18, 0x22];

function blend(px, size, x, y, rgb, a) {
  if (a <= 0) return;
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  const sa = Math.min(1, a);
  const da = px[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  for (let c = 0; c < 3; c++) {
    px[i + c] = Math.round((rgb[c] * sa + px[i + c] * da * (1 - sa)) / oa);
  }
  px[i + 3] = Math.round(oa * 255);
}

function roundRectSdf(x, y, l, t, r, b, radius) {
  const cx = Math.max(l + radius, Math.min(x, r - radius));
  const cy = Math.max(t + radius, Math.min(y, b - radius));
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.hypot(dx, dy);
  return dist - radius;
}

function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy || 1;
  let t = (wx * vx + wy * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

function draw(size) {
  const px = Buffer.alloc(size * size * 4, 0);
  const s = size;
  const inset = s * 0.035;
  const radius = s * 0.22;

  // 背景（带一点纵向渐变，视觉上更像"应用图标"）
  for (let y = 0; y < s; y++) {
    const t = y / Math.max(1, s - 1);
    const col = [
      Math.round(BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t),
      Math.round(BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t),
      Math.round(BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t),
    ];
    for (let x = 0; x < s; x++) {
      const d = roundRectSdf(x + 0.5, y + 0.5, inset, inset, s - inset, s - inset, radius);
      blend(px, s, x, y, col, Math.max(0, Math.min(1, 0.5 - d)));
    }
  }

  // 标志：泳道拐角（L 形）+ 三个节点
  // 竖向绿线从上折向横向蓝线，拐点/终点各一个节点 —— 直接对应提交图的"泳道"
  const A = [s * 0.34, s * 0.2];
  const B = [s * 0.34, s * 0.68];
  const C = [s * 0.72, s * 0.68];
  const lw = Math.max(1.2, s * 0.055);
  const nodeR = Math.max(1.4, s * 0.075);

  const stroke = (p, q, w, col) => {
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const d = segDist(x + 0.5, y + 0.5, p[0], p[1], q[0], q[1]);
        blend(px, s, x, y, col, Math.max(0, Math.min(1, w / 2 - d + 0.5)));
      }
    }
  };
  const circle = (p, r, col) => {
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const d = Math.hypot(x + 0.5 - p[0], y + 0.5 - p[1]);
        blend(px, s, x, y, col, Math.max(0, Math.min(1, r - d + 0.5)));
      }
    }
  };

  stroke(A, B, lw, NODE);
  stroke(B, C, lw, LINE);
  circle(A, nodeR, NODE);
  circle(B, nodeR, LINE);
  circle(C, nodeR, LINE);
  // 拐点和终点掏空成"节点"，起点实心
  circle(B, nodeR * 0.42, HOLE);
  circle(C, nodeR * 0.42, HOLE);

  return px;
}

/* ---------------- 输出 ---------------- */
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoEntries = icoSizes.map((size) => ({ size, png: encodePng(size, draw(size)) }));

const pngTargets = [
  [32, '32x32.png'],
  [128, '128x128.png'],
  [256, '128x128@2x.png'],
  [512, 'icon.png'],
];

for (const [size, name] of pngTargets) {
  writeFileSync(join(outDir, name), encodePng(size, draw(size)));
}
writeFileSync(join(outDir, 'icon.ico'), encodeIco(icoEntries));

console.log('icons ->', outDir);
console.log(icoSizes.join(', '), '(ico)');
console.log(pngTargets.map(([s, n]) => `${n} ${s}px`).join(', '));

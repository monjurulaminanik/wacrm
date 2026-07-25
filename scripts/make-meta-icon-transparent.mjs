import sharp from "sharp";
import fs from "fs";

const SRC =
  "C:\\Users\\User\\.cursor\\projects\\e-Wa-CRM\\assets\\c__Users_User_AppData_Roaming_Cursor_User_workspaceStorage_5a2c7afbb776197b5f484eb10c031fe0_images_rsz_ringoproperty-a884a1ad-4d85-4d90-8c40-49aae4cc58a2.png";
const OUT_T = "e:\\Wa CRM\\wacrm\\public\\meta-app-icon-1024-transparent.png";
const OUT_P = "e:\\Wa CRM\\wacrm\\public\\meta-app-icon-1024.png";

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({
  resolveWithObject: true,
});
const w = info.width;
const h = info.height;
const rgba = Buffer.from(data);
const N = w * h;

function bgScore(i) {
  const o = i * 4;
  const r = rgba[o];
  const g = rgba[o + 1];
  const b = rgba[o + 2];
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  const brightness = (r + g + b) / (3 * 255);
  const sat = max === 0 ? 0 : (max - min) / max;
  if (brightness < 0.85) return 0;
  if (sat > 0.12) return 0;
  const bScore = (brightness - 0.85) / 0.15;
  const sScore = 1 - sat / 0.12;
  return Math.min(1, bScore * 0.7 + sScore * 0.3);
}

const scores = new Float32Array(N);
for (let i = 0; i < N; i++) scores[i] = bgScore(i);

const THRESH = 0.35;
const visited = new Uint8Array(N);
const queue = [];

function trySeed(x, y) {
  const i = y * w + x;
  if (scores[i] >= THRESH && !visited[i]) {
    visited[i] = 1;
    queue.push(i);
  }
}

trySeed(0, 0);
trySeed(w - 1, 0);
trySeed(0, h - 1);
trySeed(w - 1, h - 1);
trySeed(Math.floor(w / 2), 0);
trySeed(Math.floor(w / 2), h - 1);
trySeed(0, Math.floor(h / 2));
trySeed(w - 1, Math.floor(h / 2));

while (queue.length) {
  const i = queue.pop();
  const x = i % w;
  const y = (i / w) | 0;
  const neigh = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ];
  for (const [nx, ny] of neigh) {
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const ni = ny * w + nx;
    if (visited[ni]) continue;
    if (scores[ni] >= THRESH) {
      visited[ni] = 1;
      queue.push(ni);
    }
  }
}

const softLow = 0.25;
const softHigh = 0.92;
for (let i = 0; i < N; i++) {
  if (!visited[i]) continue;
  const s = scores[i];
  let t;
  if (s <= softLow) t = 0;
  else if (s >= softHigh) t = 1;
  else {
    const u = (s - softLow) / (softHigh - softLow);
    t = u * u * (3 - 2 * u);
  }
  const a = Math.round(255 * (1 - t));
  const o = i * 4;
  rgba[o + 3] = Math.min(rgba[o + 3], a);
  if (a > 0 && a < 255) {
    const fa = a / 255;
    for (let c = 0; c < 3; c++) {
      const v = rgba[o + c];
      const fg = Math.max(
        0,
        Math.min(255, Math.round((v - 255 * (1 - fa)) / fa)),
      );
      rgba[o + c] = fg;
    }
  }
}

let minX = w;
let minY = h;
let maxX = -1;
let maxY = -1;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    if (rgba[(y * w + x) * 4 + 3] > 8) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
}
if (maxX < 0) throw new Error("No opaque content found");

const cw = maxX - minX + 1;
const ch = maxY - minY + 1;
const cropped = Buffer.alloc(cw * ch * 4);
for (let y = 0; y < ch; y++) {
  const srcOff = ((minY + y) * w + minX) * 4;
  rgba.copy(cropped, y * cw * 4, srcOff, srcOff + cw * 4);
}

const CANVAS = 1024;
const PAD = 0.1;
const maxDim = Math.round(CANVAS * (1 - 2 * PAD));
const scale = Math.min(maxDim / cw, maxDim / ch);
const nw = Math.max(1, Math.round(cw * scale));
const nh = Math.max(1, Math.round(ch * scale));

const scaled = await sharp(cropped, {
  raw: { width: cw, height: ch, channels: 4 },
})
  .resize(nw, nh, { kernel: sharp.kernel.lanczos3, fit: "fill" })
  .png()
  .toBuffer();

const left = Math.floor((CANVAS - nw) / 2);
const top = Math.floor((CANVAS - nh) / 2);

const final = await sharp({
  create: {
    width: CANVAS,
    height: CANVAS,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([{ input: scaled, left, top }])
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toBuffer();

fs.writeFileSync(OUT_T, final);
fs.writeFileSync(OUT_P, final);

const meta = await sharp(OUT_T).metadata();
const { data: vdata, info: vinfo } = await sharp(OUT_T)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const corners = [
  [0, 0],
  [1023, 0],
  [0, 1023],
  [1023, 1023],
];
const cornerInfo = corners.map(([x, y]) => {
  const o = (y * vinfo.width + x) * 4;
  return {
    x,
    y,
    r: vdata[o],
    g: vdata[o + 1],
    b: vdata[o + 2],
    a: vdata[o + 3],
  };
});

console.log(
  JSON.stringify(
    {
      size: meta.size,
      width: meta.width,
      height: meta.height,
      channels: meta.channels,
      hasAlpha: meta.hasAlpha,
      format: meta.format,
      fileBytes: fs.statSync(OUT_T).size,
      corners: cornerInfo,
      contentBBox: { minX, minY, maxX, maxY, cw, ch },
      placed: { nw, nh, left, top },
    },
    null,
    2,
  ),
);

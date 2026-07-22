const fs = require("fs");
const sharp = require("sharp");

const pngPath =
  "C:/Users/User/.cursor/projects/e-Wa-CRM/assets/favicon-source.png";

function makeIco(pngBuf, width, height) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(width >= 256 ? 0 : width, 0);
  entry.writeUInt8(height >= 256 ? 0 : height, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, pngBuf]);
}

(async () => {
  const outPng = await sharp(pngPath)
    .resize(32, 32)
    .ensureAlpha()
    .png()
    .toBuffer();
  const ico = makeIco(outPng, 32, 32);
  fs.writeFileSync("public/favicon.ico", ico);
  console.log("wrote public/favicon.ico", ico.length);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

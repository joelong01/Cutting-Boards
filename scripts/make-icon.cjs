// Regenerates assets/icon.ico, assets/icon.png and public/icon.png: a walnut and maple
// checkerboard cutting board.
// The drawing below is the source; never edit the .ico or .png by hand. Run with `npm run icon`.
//
// Electron does the drawing because it is already a dependency and has a canvas. Each size is
// drawn separately rather than scaled down, so the 16-pixel icon stays crisp.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const OUT = path.join(__dirname, '..', 'assets');

/** Runs in the page: draw the board at one size and return it as a PNG data URL. */
function drawIcon(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const inset = Math.max(1, Math.round(size * 0.06));
  const side = size - 2 * inset;
  const radius = size * 0.17;
  const line = Math.max(1, size * 0.04);

  /** Trace the board's rounded outline as the current path. */
  const outline = () => {
    ctx.beginPath();
    ctx.roundRect(inset, inset, side, side, radius);
  };

  if (size >= 48) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = size * 0.05;
    ctx.shadowOffsetY = size * 0.02;
  }
  outline();
  ctx.fillStyle = '#ecd8ad';
  ctx.fill();
  ctx.shadowColor = 'transparent';

  ctx.save();
  outline();
  ctx.clip();
  // Whole-pixel cell edges, so squares do not blur at small sizes.
  const cells = 4;
  const edge = (i) => inset + Math.round((side * i) / cells);
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      if ((row + col) % 2 === 0) continue;
      ctx.fillStyle = '#5c3a26';
      ctx.fillRect(edge(col), edge(row), edge(col + 1) - edge(col), edge(row + 1) - edge(row));
    }
  }
  if (size >= 48) {
    // A soft sheen from the top-left, like an oiled board under a shop light.
    const sheen = ctx.createLinearGradient(inset, inset, inset + side, inset + side);
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
    sheen.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
    sheen.addColorStop(1, 'rgba(0, 0, 0, 0.12)');
    ctx.fillStyle = sheen;
    ctx.fillRect(inset, inset, side, side);
  }
  ctx.restore();

  outline();
  ctx.lineWidth = line;
  ctx.strokeStyle = '#3a2315';
  ctx.stroke();
  return canvas.toDataURL('image/png');
}

/** Pack PNG images into one .ico file. Windows reads PNG-compressed entries directly. */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    // A width or height byte of 0 means 256.
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

/** Draw every size in a hidden page, then write the .ico and the two 256-pixel .png copies. */
async function main() {
  const win = new BrowserWindow({ show: false, width: 300, height: 300 });
  await win.loadURL('data:text/html,<html></html>');
  const images = [];
  for (const size of SIZES) {
    const url = await win.webContents.executeJavaScript(`(${drawIcon.toString()})(${size})`);
    images.push({ size, png: Buffer.from(url.split(',')[1], 'base64') });
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'icon.ico'), buildIco(images));
  fs.writeFileSync(path.join(OUT, 'icon.png'), images[images.length - 1].png);
  // The page's own tab icon; Vite serves and bundles whatever is in public/.
  const pub = path.join(__dirname, '..', 'public');
  fs.mkdirSync(pub, { recursive: true });
  fs.writeFileSync(path.join(pub, 'icon.png'), images[images.length - 1].png);
  console.log(`icon written: ${path.join(OUT, 'icon.ico')} (${SIZES.join(', ')} px), icon.png, public/icon.png`);
}

app.whenReady().then(main).then(() => app.quit(), (e) => {
  console.error(e);
  app.exit(1);
});

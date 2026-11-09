// Image helpers for the service worker: fetch the photo and make sure it is a JPEG.
// (Also loaded by tests/convert.html to test in a normal page.)
/* exported igdlFetchAsJpeg */

function igdlBytesToBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function igdlIsJpeg(bytes) {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Downloads `url` and returns a JPEG data: URL.
 * JPEGs are kept byte-for-byte (no quality loss); WebP/PNG/AVIF are re-encoded
 * at full resolution with JPEG quality 0.95.
 */
async function igdlFetchAsJpeg(url, quality = 0.95) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error('Image request failed: HTTP ' + res.status);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (igdlIsJpeg(bytes)) {
    return { dataUrl: 'data:image/jpeg;base64,' + igdlBytesToBase64(bytes), converted: false, from: 'jpeg' };
  }
  const type = (res.headers.get('content-type') || '').split(';')[0] || 'image/webp';
  const bmp = await createImageBitmap(new Blob([buf], { type }));
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // JPEG has no transparency
  ctx.fillRect(0, 0, bmp.width, bmp.height);
  ctx.drawImage(bmp, 0, 0);
  const width = bmp.width, height = bmp.height;
  if (bmp.close) bmp.close();
  const jpg = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  const out = new Uint8Array(await jpg.arrayBuffer());
  return { dataUrl: 'data:image/jpeg;base64,' + igdlBytesToBase64(out), converted: true, from: type, width, height };
}

if (typeof self !== 'undefined') self.igdlFetchAsJpeg = igdlFetchAsJpeg;

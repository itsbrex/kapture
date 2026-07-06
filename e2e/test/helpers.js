import { expect } from 'chai';
import zlib from 'zlib';

// Helper to validate common response properties
export function expectValidTabInfo(data) {
  expect(data).to.have.property('url').that.is.a('string');
  expect(data).to.have.property('title').that.is.a('string');
  expect(data).to.have.property('domSize').that.is.a('number');
  expect(data).to.have.property('fullPageDimensions').that.is.an('object');
  expect(data.fullPageDimensions).to.have.property('width').that.is.a('number');
  expect(data.fullPageDimensions).to.have.property('height').that.is.a('number');
  expect(data).to.have.property('viewportDimensions').that.is.an('object');
  expect(data.viewportDimensions).to.have.property('width').that.is.a('number');
  expect(data.viewportDimensions).to.have.property('height').that.is.a('number');
  expect(data).to.have.property('scrollPosition').that.is.an('object');
  expect(data.scrollPosition).to.have.property('x').that.is.a('number');
  expect(data.scrollPosition).to.have.property('y').that.is.a('number');
  expect(data).to.have.property('pageVisibility').that.is.an('object');
  expect(data.pageVisibility).to.have.property('visible').that.is.a('boolean');
  expect(data.pageVisibility).to.have.property('visibilityState').that.is.a('string');
}
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced — what CDP produces) so
// screenshot tests can assert on captured pixels without an image dependency.
export function decodePng(buffer) {
  let offset = 8; // skip signature
  let ihdr = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12]
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (!ihdr || ihdr.bitDepth !== 8 || (ihdr.colorType !== 2 && ihdr.colorType !== 6) || ihdr.interlace !== 0) {
    throw new Error('Unsupported PNG format');
  }
  const channels = ihdr.colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = ihdr.width * channels;
  const pixels = Buffer.alloc(ihdr.height * stride);
  for (let y = 0; y < ihdr.height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      let value;
      switch (filter) {
        case 0: value = row[i]; break;
        case 1: value = row[i] + a; break;
        case 2: value = row[i] + b; break;
        case 3: value = row[i] + Math.floor((a + b) / 2); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          value = row[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`Unknown PNG filter ${filter}`);
      }
      out[i] = value & 0xff;
    }
  }
  return { width: ihdr.width, height: ihdr.height, channels, pixels };
}

// Fraction of pixels dominated by one color channel. Captures go through the
// display's color profile, so exact RGB values shift (#ff0000 can come back as
// (234,51,35)) - channel dominance is stable where exact matching is not.
export function colorShare({ pixels, channels }, color, margin = 60) {
  const c = { red: 0, green: 1, blue: 2 }[color];
  let match = 0;
  for (let i = 0; i < pixels.length; i += channels) {
    const others = Math.max(pixels[i + ((c + 1) % 3)], pixels[i + ((c + 2) % 3)]);
    if (pixels[i + c] - others >= margin) match++;
  }
  return match / (pixels.length / channels);
}

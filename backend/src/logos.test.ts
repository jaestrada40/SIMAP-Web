import { expect, test } from 'vitest';
import { tipoReal } from './routes/logos.js';

test('tipoReal: reconoce PNG, JPG y WebP por su contenido y rechaza lo demás (SVG incluido)', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(4)]);
  expect(tipoReal(png)).toBe('image/png');
  expect(tipoReal(jpg)).toBe('image/jpeg');
  expect(tipoReal(webp)).toBe('image/webp');
  expect(tipoReal(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
  expect(tipoReal(Buffer.from('GIF89a......'))).toBeNull();
  expect(tipoReal(Buffer.alloc(0))).toBeNull();
});

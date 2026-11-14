import { afterAll, beforeAll, expect, it } from 'vitest';
import { startCloud, type Cloud } from '../cloud';

let cloud: Cloud;
beforeAll(async () => void (cloud = await startCloud()));
afterAll(() => cloud.close());

it('serves the Mansora logo and font used by emails and payment pages', async () => {
  const logo = await fetch(`${cloud.url}/brand/mansora-logo.png`);
  expect(logo.status).toBe(200); expect(logo.headers.get('content-type')).toBe('image/png');
  const bytes = new Uint8Array(await logo.arrayBuffer());
  expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  const font = await fetch(`${cloud.url}/brand/dm-sans-latin.woff2`);
  expect(font.status).toBe(200); expect(font.headers.get('content-type')).toBe('font/woff2');
});

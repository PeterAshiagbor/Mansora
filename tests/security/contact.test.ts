import { afterAll, beforeAll, expect, it } from 'vitest';
import { startCloud, type Cloud } from '../cloud';
let cloud: Cloud;
beforeAll(async () => { cloud = await startCloud(); });
afterAll(async () => { await cloud?.close(); });
const contact = { name: 'Mansora support', email: 'support@example.test', phone: '+233 200 000 000', whatsapp: '233200000000', hours: 'Weekdays 09:00–17:00', website: 'https://example.test/help' };
it('publishes only configured contact fields and requires a valid admin session for changes', async () => {
  expect((await cloud.api('GET', '/v1/public/contact', undefined, null)).body).toEqual({ name: 'Mansora', email: '', phone: '', whatsapp: '', hours: '', website: '' });
  expect((await cloud.api('PUT', '/v1/admin/contact-settings', contact, null)).status).toBe(401);
  expect((await cloud.api('PUT', '/v1/admin/contact-settings', contact, 'invalid-session')).status).toBe(401);
  expect((await cloud.api('PUT', '/v1/admin/contact-settings', contact)).status).toBe(200);
  const publicRead = await cloud.app.inject({ method: 'GET', url: '/v1/public/contact', headers: { origin: 'null' } });
  expect(publicRead.json()).toEqual(contact);
  expect(publicRead.headers['access-control-allow-origin']).toBe('*');
  expect(publicRead.headers['cache-control']).toBe('no-store');
  const audit = (await cloud.api('GET', '/v1/admin/audit')).body;
  expect(audit.some((r: any) => r.action === 'contact_settings.updated')).toBe(true);
});
it('rejects unsafe links, invalid contact addresses and undeclared fields without changing saved contact', async () => {
  for (const changes of [{ website: 'javascript:alert(1)' }, { website: 'http://example.test' }, { website: 'https://user:secret@example.test' }, { email: 'broken\nmail@example.test' }, { whatsapp: '+233-200000000' }, { privateNote: 'must not be published' }]) {
    expect((await cloud.api('PUT', '/v1/admin/contact-settings', { ...contact, ...changes })).status).toBe(400);
  }
  expect((await cloud.api('GET', '/v1/public/contact', undefined, null)).body).toEqual(contact);
});

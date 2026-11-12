import { expect, it } from 'vitest';
import { clientAddress, deploymentMode, gatewayPolicyFromEnv, trustedProxyMatcher } from '../../scripts/staging/gateway-policy';
const request = (peer: string, value?: string | string[]) => ({ socket: { remoteAddress: peer }, headers: { 'x-real-ip': value } });
it('requires an explicit, consistent mode and keeps reviewed resource bounds', () => {
  expect(() => deploymentMode({})).toThrow(/Explicit/);
  expect(deploymentMode({ MANSORA_STAGING_MODE: 'team-test' })).toBe('team-test');
  expect(deploymentMode({ MANSORA_DEPLOYMENT_MODE: 'client' })).toBe('client');
  expect(() => deploymentMode({ MANSORA_STAGING_MODE: 'team-test', MANSORA_DEPLOYMENT_MODE: 'client' })).toThrow(/disagree/);
  expect(gatewayPolicyFromEnv({ MANSORA_STAGING_MODE: 'team-test' })).toMatchObject({ maxConcurrentRequests: 16, maxConcurrentImports: 1, maxConcurrentPerWorkspace: 8, trustedProxies: [] });
  expect(gatewayPolicyFromEnv({ MANSORA_DEPLOYMENT_MODE: 'client', GATEWAY_MAX_CONCURRENT_REQUESTS: '1' })).toMatchObject({ maxConcurrentRequests: 1, maxConcurrentPerWorkspace: 1, maxConcurrentImports: 1 });
  for (const value of ['0', '-1', '65', '2.5', 'unlimited']) expect(() => gatewayPolicyFromEnv({ MANSORA_DEPLOYMENT_MODE: 'client', GATEWAY_MAX_CONCURRENT_REQUESTS: value })).toThrow();
  expect(() => gatewayPolicyFromEnv({ MANSORA_DEPLOYMENT_MODE: 'client', GATEWAY_MAX_CONCURRENT_IMPORTS: '5' })).toThrow();
});
it('trusts only explicit numeric proxy addresses/CIDRs and rejects universal or malformed trust', () => {
  const trust = trustedProxyMatcher(['127.0.0.1', '10.20.0.0/16', '2001:db8::/32']);
  expect(trust('127.0.0.1')).toBe(true); expect(trust('10.20.2.3')).toBe(true); expect(trust('2001:db8::1')).toBe(true);
  expect(trust('198.51.100.1')).toBe(false); expect(trustedProxyMatcher()('127.0.0.1')).toBe(false);
  for (const value of ['0.0.0.0/0', '::/0', 'hostname.example', '10.0.0.1/33', '2001:db8::/129', '127.0.0.1/abc', '10.0.0.1/24/32']) expect(() => trustedProxyMatcher([value])).toThrow();
});
it('ignores spoofed/multiple/malformed forwarded addresses and canonicalises a valid trusted address', () => {
  const trust = trustedProxyMatcher(['127.0.0.1']);
  expect(clientAddress(request('198.51.100.1', '203.0.113.1'), trust)).toMatchObject({ address: '198.51.100.1', source: 'socket' });
  for (const value of ['203.0.113.1, 203.0.113.2', 'unknown', '[::1]', 'fe80::1%eth0']) expect(clientAddress(request('127.0.0.1', value), trust).source).toBe('socket');
  expect(clientAddress(request('127.0.0.1', ['203.0.113.1', '203.0.113.2']), trust).source).toBe('socket');
  expect(clientAddress(request('127.0.0.1', '2001:0DB8:0000:0000:0000:0000:0000:0001'), trust)).toMatchObject({ address: '2001:db8::1', source: 'forwarded' });
  expect(clientAddress(request('::ffff:127.0.0.1'), () => false).address).toBe('127.0.0.1');
});

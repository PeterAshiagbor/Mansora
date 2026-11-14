import { BlockList, isIP } from 'node:net';
export type DeploymentMode = 'team-test' | 'client';
export function deploymentMode(env: NodeJS.ProcessEnv = process.env): DeploymentMode {
  const mode = env.MANSORA_DEPLOYMENT_MODE ?? env.MANSORA_STAGING_MODE;
  if (env.MANSORA_DEPLOYMENT_MODE && env.MANSORA_STAGING_MODE && env.MANSORA_DEPLOYMENT_MODE !== env.MANSORA_STAGING_MODE) throw new Error('Deployment mode settings disagree; preserve the current environment and review them.');
  if (mode !== 'team-test' && mode !== 'client') throw new Error('Explicit team-test or client deployment mode is required.');
  return mode;
}
export function trustedProxyMatcher(entries: string[] = []) {
  const allowed = new BlockList();
  for (const entry of entries) {
    const [ip, rawPrefix, extra] = entry.split('/'), family = isIP(ip), prefix = rawPrefix === undefined ? (family === 4 ? 32 : 128) : Number(rawPrefix);
    if (!family || ip.includes('%') || extra !== undefined || !Number.isInteger(prefix) || prefix < 1 || prefix > (family === 4 ? 32 : 128)) throw new Error('Gateway trusted proxies must be explicit numeric addresses/CIDRs, never all addresses.');
    allowed.addSubnet(ip, prefix, family === 4 ? 'ipv4' : 'ipv6');
  }
  return (ip: string) => { const family = isIP(ip); return !!family && allowed.check(ip, family === 4 ? 'ipv4' : 'ipv6'); };
}
function canonical(ip: string) {
  ip = ip.split('%')[0];
  if (isIP(ip) === 6) {
    if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(ip)) return ip.slice(7);
    return new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  }
  return ip;
}
/** Railway documents X-Real-IP. It is accepted only across an explicitly trusted peer boundary. */
export function clientAddress(req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }, trusted: (peer: string) => boolean) {
  const peer = req.socket.remoteAddress ?? '';
  const value = req.headers['x-real-ip'];
  if (trusted(peer) && typeof value === 'string' && !value.includes('%') && isIP(value.trim())) return { address: canonical(value.trim()), source: 'forwarded' as const, peer };
  return { address: canonical(peer), source: 'socket' as const, peer };
}
export function gatewayPolicyFromEnv(env: NodeJS.ProcessEnv = process.env, mode = deploymentMode(env)) {
  const number = (name: string, fallback: number, max: number) => {
    if (env[name] === undefined) return fallback;
    if (!/^\d+$/.test(env[name]!)) throw new Error(`${name} must be a bounded positive integer.`);
    const value = Number(env[name]);
    if (value < 1 || value > max) throw new Error(`${name} exceeds the reviewed resource bounds.`);
    return value;
  };
  const maxConcurrentRequests = number('GATEWAY_MAX_CONCURRENT_REQUESTS', 16, 64);
  const maxConcurrentPerWorkspace = number('GATEWAY_MAX_REQUESTS_PER_WORKSPACE', Math.min(8, maxConcurrentRequests), maxConcurrentRequests);
  const maxConcurrentImports = number('GATEWAY_MAX_CONCURRENT_IMPORTS', Math.min(mode === 'client' ? 2 : 1, maxConcurrentRequests), Math.min(4, maxConcurrentRequests));
  const trustedProxies = (env.GATEWAY_TRUSTED_PROXIES ?? '').split(',').map(value => value.trim()).filter(Boolean);
  trustedProxyMatcher(trustedProxies);
  return { mode, maxConcurrentRequests, maxConcurrentPerWorkspace, maxConcurrentImports, trustedProxies };
}

/**
 * Team testing never handles real money. A Paystack **test** secret key (sk_test_…) is allowed, because Paystack
 * test mode moves no money; a live key, any Hubtel secret, or a redirected Paystack address stops startup.
 */
export function assertTestPaymentKeysOnly(env: NodeJS.ProcessEnv): void {
  const key = env.PAYSTACK_SECRET_KEY;
  if (key && !/^sk_test_[A-Za-z0-9]{20,100}$/.test(key)) throw new Error('Only a Paystack test secret key (sk_test_…) is allowed in team testing; live payment credentials are forbidden.');
  if (env.PAYSTACK_BASE_URL) throw new Error('PAYSTACK_BASE_URL must not be set in team testing.');
  if (env.HUBTEL_CLIENT_SECRET) throw new Error('Live payment credentials are forbidden in team testing.');
}

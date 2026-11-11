import { railwayConfig } from './config';
import { smokeStaging } from '../staging/smoke';
const config = railwayConfig();
Object.assign(process.env, { STAGING_ORIGIN: config.origin, STAGING_DATA_DIR: '/data/staging', STAGING_DB_KEY_FILE: '/data/secrets/staging_db_key', STAGING_API_URL: 'http://127.0.0.1:4000' });
async function smokeRailway() {
  await smokeStaging();
  const base = process.env.STAGING_SMOKE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8080}`;
  const denied = await fetch(`${base}/api/metrics`);
  if (denied.status !== (process.env.METRICS_TOKEN ? 401 : 404)) throw new Error('Metrics access control failed');
  if (process.env.METRICS_TOKEN) {
    const accepted = await fetch(`${base}/api/metrics`, { headers: { authorization: `Bearer ${process.env.METRICS_TOKEN}` } });
    if (accepted.status !== 200 || !(await accepted.text()).includes('mansora_http_requests_total')) throw new Error('Configured metrics unavailable');
  }
  console.log('PASS Railway metrics configuration and access control');
}
void smokeRailway().catch(() => { console.error('Railway acceptance failed. No credentials or request payloads are logged.'); process.exitCode = 1; });

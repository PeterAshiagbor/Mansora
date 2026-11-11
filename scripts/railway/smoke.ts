import { railwayConfig } from './config';
import { smokeStaging } from '../staging/smoke';
const config = railwayConfig();
Object.assign(process.env, { STAGING_ORIGIN: config.origin, STAGING_DATA_DIR: '/data/staging', STAGING_DB_KEY_FILE: '/data/secrets/staging_db_key', STAGING_API_URL: 'http://127.0.0.1:4000' });
void smokeStaging().catch(() => { console.error('Railway acceptance failed. No credentials or request payloads are logged.'); process.exitCode = 1; });

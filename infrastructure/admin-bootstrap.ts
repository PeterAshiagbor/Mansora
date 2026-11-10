import { connectPostgres } from '../apps/api/src/db';
import { createAdmin } from '../apps/api/src/modules/admin';
const { DATABASE_URL, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD } = process.env;
if (!DATABASE_URL || !ADMIN_EMAIL || !ADMIN_NAME || !ADMIN_PASSWORD) throw new Error('Administrator bootstrap configuration is required');
const db = await connectPostgres(DATABASE_URL);
try {
  await db.platform(async (q) => {
    const existing = await q('SELECT id FROM admins WHERE email = $1', [ADMIN_EMAIL.trim().toLowerCase()]);
    if (!existing.length) await createAdmin(q, { email: ADMIN_EMAIL, name: ADMIN_NAME, password: ADMIN_PASSWORD });
  });
  console.log('Local administrator bootstrap completed; existing credentials were preserved.');
} finally { await db.close(); }

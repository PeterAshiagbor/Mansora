import { connectPostgres } from './db';
import { createAdmin } from './modules/admin';
import { ensureApprovedPlans } from './billing/plans';

/**
 *   npm run api:migrate
 *   ADMIN_EMAIL=.. ADMIN_NAME=.. ADMIN_PASSWORD=.. npm run api:create-admin
 * Credentials come from the environment so they never land in shell history files or source control.
 */
const [command] = process.argv.slice(2);
const url = command === 'migrate' ? process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL : process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const db = await connectPostgres(url);
try {
  if (command === 'migrate') {
    await db.migrate();
    const added = await db.platform((q) => ensureApprovedPlans(q));
    console.log(`Database is up to date.${added ? ` Service plans added: ${added}.` : ''}`);
  }
  else if (command === 'create-admin') {
    const { ADMIN_EMAIL: email, ADMIN_NAME: name, ADMIN_PASSWORD: password } = process.env;
    if (!email || !name || !password) throw new Error('Set ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD');
    await db.platform((q) => createAdmin(q, { email, name, password }));
    console.log(`Administrator ${email} created.`);
  } else throw new Error('Usage: cli.ts migrate | create-admin');
} finally {
  await db.close();
}

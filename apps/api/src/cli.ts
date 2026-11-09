import { connectPostgres } from './db';
import { createAdmin } from './modules/admin';

/**
 *   npm run api:migrate
 *   ADMIN_EMAIL=.. ADMIN_NAME=.. ADMIN_PASSWORD=.. npm run api:create-admin
 * Credentials come from the environment so they never land in shell history files or source control.
 */
const [command] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const db = await connectPostgres(url);
try {
  await db.migrate();
  if (command === 'migrate') console.log('Database is up to date.');
  else if (command === 'create-admin') {
    const { ADMIN_EMAIL: email, ADMIN_NAME: name, ADMIN_PASSWORD: password } = process.env;
    if (!email || !name || !password) throw new Error('Set ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD');
    await db.platform((q) => createAdmin(q, { email, name, password }));
    console.log(`Administrator ${email} created.`);
  } else throw new Error('Usage: cli.ts migrate | create-admin');
} finally {
  await db.close();
}

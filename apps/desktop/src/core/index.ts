import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { authCommands } from './commands/auth';
import { catalogCommands } from './commands/catalog';
import { peopleCommands } from './commands/people';
import { reportCommands } from './commands/reports';
import { salesCommands } from './commands/sales';
import { systemCommands } from './commands/system';
import { openDatabase } from './db';
import { Engine, type EngineOptions } from './engine';

export * from './engine';
export * from './db';
export * from './sync';
export * from './backup';
export { renderReceiptHtml } from './receipt';
export { runScheduledBackup } from './commands/system';

export const ALL_COMMANDS = { ...authCommands, ...catalogCommands, ...salesCommands, ...peopleCommands, ...reportCommands, ...systemCommands };
export type CommandName = keyof typeof ALL_COMMANDS;

export function createEngine(opts: EngineOptions & { dbKey?: string | null }): Engine {
  const engine = new Engine(opts).register(ALL_COMMANDS);
  (engine as any).dbKey = opts.dbKey ?? null;
  return engine;
}

/** Open the local store in `dataDir` and return a ready engine. */
export function openEngine(opts: Omit<EngineOptions, 'db'> & { dbKey?: string | null; dbFile?: string }): Engine {
  mkdirSync(opts.dataDir, { recursive: true });
  const db = openDatabase(opts.dbFile ?? join(opts.dataDir, 'mansora.db'), opts.dbKey);
  return createEngine({ ...opts, db });
}

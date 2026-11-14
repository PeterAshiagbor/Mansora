/**
 * One-time team-test operation (owner request, 2026-11-14): close every shift left open in the test shops.
 * Nobody counted those tills, so each shift closes with the counted cash equal to what the system expects (no
 * difference) and a note saying Mansora closed it at the owner's request. Runs once per operation id.
 */
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StagingWorkspace } from './gateway';

export const CLOSE_SHIFTS_OPERATION = '2026-11-14-close-open-shifts';

export async function closeOpenShifts(o: { id?: string; dataDir: string; workspaces: StagingWorkspace[] }) {
  const result = { closed: 0, disabled: false, failures: 0 };
  if (!o.id || o.id === 'off') return { ...result, disabled: true };
  const journalPath = join(o.dataDir, 'close-shifts.json');
  const journal: { id: string; done: string[] } = existsSync(journalPath) ? JSON.parse(readFileSync(journalPath, 'utf8')) : { id: o.id, done: [] };
  if (journal.id === o.id && journal.done.length && o.workspaces.every((w) => journal.done.includes(w.id))) return { ...result, disabled: true };
  if (journal.id !== o.id) { journal.id = o.id; journal.done = []; }
  for (const w of o.workspaces) {
    if (journal.done.includes(w.id)) continue;
    const open = w.engine.db.prepare(`SELECT id, cashier_id FROM shifts WHERE status = 'open'`).all() as { id: string; cashier_id: string }[];
    for (const s of open) {
      const token = w.engine.createSession(s.cashier_id);
      try {
        const current = await w.engine.execute(token, 'shift.current', {});
        if (!current) continue;
        await w.engine.execute(token, 'shift.close', { countedCash: current.totals.expectedCash, notes: 'Closed by Mansora at the owner\'s request; the till was not counted.' });
        result.closed++;
      } catch { result.failures++; }
      finally { try { w.engine.endSession(token); } catch { /* already ended */ } }
    }
    journal.done.push(w.id);
    writeFileSync(journalPath + '.pending', JSON.stringify(journal, null, 2) + '\n', { mode: 0o600 }); chmodSync(journalPath + '.pending', 0o600); renameSync(journalPath + '.pending', journalPath);
  }
  return result;
}

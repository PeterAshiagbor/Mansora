import type { StagingWorkspace } from './gateway';

export const normaliseLogin = (value: string) => value.trim().toLowerCase();
/** A qualified login is injective even for legacy/offline usernames shared by different shops. */
export const publicLogin = (workspace: string, username: string) => `${normaliseLogin(username)}@${workspace}`;
export interface LoginAccount { workspace: StagingWorkspace; id: string; username: string }

export function loginAccounts(workspaces: Iterable<StagingWorkspace>): LoginAccount[] {
  return [...workspaces].flatMap(workspace => workspace.engine.db.prepare('SELECT id, username FROM users').all()
    .map((row: any) => ({ workspace, id: row.id, username: row.username })));
}

export function findLoginAccounts(workspaces: Iterable<StagingWorkspace>, aliases: Record<string, Record<string, string>> | undefined, value: string): LoginAccount[] {
  const name = normaliseLogin(value);
  return loginAccounts(workspaces).filter(account => {
    if (publicLogin(account.workspace.id, account.username) === name || normaliseLogin(account.username) === name) return true;
    const map = aliases?.[account.workspace.id];
    return map && Object.hasOwn(map, name) && normaliseLogin(map[name]) === normaliseLogin(account.username);
  });
}

/** Called only after staff.manage authorisation. Never exposes the other account or shop. */
export function usernameTaken(workspaces: Iterable<StagingWorkspace>, workspaceId: string, userId: unknown, username: string) {
  return loginAccounts(workspaces).some(account => !(account.workspace.id === workspaceId && account.id === userId)
    && normaliseLogin(account.username) === normaliseLogin(username));
}

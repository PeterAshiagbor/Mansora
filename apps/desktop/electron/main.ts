import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, session, shell, type IpcMainInvokeEvent } from 'electron';
import { DomainError } from '@mansora/domain';
import { openEngine, restoreBackupFile, runScheduledBackup, syncNow, type Engine } from '../src/core';

const dataDir = join(app.getPath('userData'), 'data');
const dbFile = join(dataDir, 'mansora.db');
const indexFile = join(__dirname, '..', 'renderer', 'index.html');
const indexUrl = pathToFileURL(indexFile).toString();

let engine: Engine;
let win: BrowserWindow | null = null;
/** Session tokens stay in the main process; the user interface never holds them. */
const tokens = new Map<number, string>();

/**
 * The database key is random, generated on first run and stored encrypted by
 * the operating system (Windows DPAPI via Electron safeStorage), so the
 * database file is useless if copied off the laptop.
 */
function databaseKey(): string {
  mkdirSync(dataDir, { recursive: true });
  const keyFile = join(dataDir, 'db.key');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure key storage is not available on this computer, so the local database cannot be protected.');
  if (existsSync(keyFile)) return safeStorage.decryptString(readFileSync(keyFile));
  if (existsSync(dbFile)) throw new Error('The database key file is missing. Restore from a backup or contact Mansora support.');
  const key = randomBytes(32).toString('hex');
  writeFileSync(keyFile, safeStorage.encryptString(key), { mode: 0o600 });
  return key;
}

function startEngine(): void {
  engine = openEngine({ dataDir, dbFile, dbKey: databaseKey(), appVersion: app.getVersion() });
}

function assertTrusted(event: IpcMainInvokeEvent): void {
  if (event.senderFrame?.url !== indexUrl || event.sender !== win?.webContents) throw new Error('Untrusted caller');
}

function handle(channel: string, fn: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrusted(event);
    return fn(event, ...args);
  });
}

/** Render trusted, script-free HTML (receipts, reports) in a throwaway hidden window. */
async function withPrintWindow<T>(html: string, fn: (w: BrowserWindow) => Promise<T>): Promise<T> {
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
  try {
    await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await fn(w);
  } finally {
    w.destroy();
  }
}

function registerIpc(): void {
  handle('mansora:invoke', async (event, command: unknown, input: unknown) => {
    if (typeof command !== 'string') return { ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid command' } };
    const id = event.sender.id;
    try {
      if (command === 'auth.logout') {
        engine.endSession(tokens.get(id) ?? null);
        tokens.delete(id);
        return { ok: true, data: { ok: true } };
      }
      const data = await engine.execute(tokens.get(id) ?? null, command, input);
      if (command === 'auth.login') {
        tokens.set(id, data.token);
        return { ok: true, data: { user: data.user } };
      }
      return { ok: true, data };
    } catch (e) {
      if (e instanceof DomainError) {
        if (e.code === 'SESSION_LOCKED') tokens.delete(id);
        return { ok: false, error: { code: e.code, message: e.message, details: e.details } };
      }
      console.error(`Command ${command} failed`, e);
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Nothing was saved.' } };
    }
  });

  // Printing goes through the Windows print queue, so any installed receipt printer works. A failed print never affects the saved sale.
  handle('mansora:print', (_e, html: string) =>
    withPrintWindow(String(html), (w) => new Promise((resolve) => w.webContents.print({ silent: false, printBackground: true }, (ok, reason) => resolve({ ok, message: ok ? undefined : reason === 'cancelled' ? undefined : `Printing failed: ${reason}` })))),
  );
  handle('mansora:savePdf', async (_e, html: string, fileName: string) => {
    const target = await dialog.showSaveDialog(win!, { defaultPath: basename(String(fileName)), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (target.canceled || !target.filePath) return { ok: false };
    const pdf = await withPrintWindow(String(html), (w) => w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true }));
    await writeFile(target.filePath, pdf);
    return { ok: true };
  });
  handle('mansora:saveFile', async (_e, file: { fileName: string; contentBase64: string }) => {
    const target = await dialog.showSaveDialog(win!, { defaultPath: basename(String(file.fileName)) });
    if (target.canceled || !target.filePath) return { ok: false };
    await writeFile(target.filePath, Buffer.from(String(file.contentBase64), 'base64'));
    return { ok: true };
  });
  /** Restore a backup onto a laptop that has not been activated yet (never over live data). */
  // Payment pages open in the client's own browser. Only https (or a local test server) is allowed, never file: or custom schemes.
  handle('mansora:openExternal', async (_e, url: unknown) => {
    let u: URL;
    try { u = new URL(String(url)); } catch { return { ok: false, message: 'That link is not valid' }; }
    const local = u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.protocol !== 'https:' && !local) return { ok: false, message: 'Only secure links can be opened' };
    await shell.openExternal(u.toString());
    return { ok: true };
  });
  handle('mansora:restore', async (_e, passphrase: string) => {
    if (engine.activated) return { ok: false, message: 'This laptop already holds a business. Restore is only possible on a fresh installation.' };
    const pick = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'Mansora backup', extensions: ['mbk'] }] });
    if (pick.canceled || !pick.filePaths[0]) return { ok: false };
    const staged = `${dbFile}.restoring`;
    try {
      for (const f of [staged, `${staged}-wal`, `${staged}-shm`]) if (existsSync(f)) renameSync(f, `${f}.old-${Date.now()}`);
      const summary = restoreBackupFile(pick.filePaths[0], String(passphrase), staged, databaseKey());
      engine.db.close();
      for (const suffix of ['', '-wal', '-shm']) if (existsSync(dbFile + suffix)) renameSync(dbFile + suffix, `${dbFile}${suffix}.empty-${Date.now()}`);
      renameSync(staged, dbFile);
      startEngine();
      tokens.clear();
      return { ok: true, summary };
    } catch (e) {
      if (!engine.db.open) startEngine();
      return { ok: false, message: e instanceof DomainError ? e.message : 'The backup could not be restored.' };
    }
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1100,
    minHeight: 640,
    backgroundColor: '#fffaf1',
    icon: join(__dirname, '..', 'renderer', 'mansora-icon.png'),
    title: 'Mansora Sales & Stock',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: !app.isPackaged, spellcheck: false },
  });
  win.maximize();
  // The window only ever shows the bundled application: no navigation, no pop-ups, no remote content.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => (win = null));
  void win.loadFile(indexFile);
}

/** Background sync with back-off: quick when healthy, patient when offline. */
function startSyncLoop(): void {
  let delay = 30_000;
  const tick = async () => {
    try {
      const r = await syncNow(engine);
      delay = r.ok ? 30_000 : Math.min(delay * 2, 5 * 60_000);
    } catch (e) {
      console.error('sync failed', e);
      delay = Math.min(delay * 2, 5 * 60_000);
    }
    setTimeout(tick, delay).unref();
  };
  setTimeout(tick, 5_000).unref();
  // Daily automatic backup (if the owner switched it on): checked at start-up and every hour.
  const backup = () => void runScheduledBackup(engine);
  setTimeout(backup, 60_000).unref();
  setInterval(backup, 3_600_000).unref();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => (win?.isMinimized() && win.restore(), win?.focus()));
  app.enableSandbox();
  app.whenReady().then(() => {
    try {
      startEngine();
    } catch (e) {
      dialog.showErrorBox('Mansora Sales & Stock cannot start', (e as Error).message);
      return app.quit();
    }
    // Only the camera is allowed, only for the app's own pages, and only video (barcode scanning, C57). Everything else is refused.
    const ownPage = (url: string) => url.startsWith('file://');
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) =>
      cb(permission === 'media' && ownPage(details.requestingUrl ?? '') && ((details as any).mediaTypes ?? []).every((t: string) => t === 'video')));
    session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => permission === 'media' && ownPage(origin ?? ''));
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'File', submenu: [{ role: 'quit' }] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'View', submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'togglefullscreen' }] },
      { label: 'Help', submenu: [{ label: 'Open data folder', click: () => void shell.openPath(dataDir) }] },
    ]));
    registerIpc();
    createWindow();
    startSyncLoop();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    try {
      engine?.db.close();
    } catch {
      /* already closed */
    }
  });
}

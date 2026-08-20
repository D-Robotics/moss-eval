import { app, BrowserWindow, dialog, ipcMain, utilityProcess } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateIpcRequest } from './ipc-contract.mjs';
import { EventStore } from './event-store.mjs';
import { WorkerClient } from './worker-client.mjs';

let mainWindow;
let worker;
let paths;
let events;

function projectRoot() { return app.isPackaged ? path.join(process.resourcesPath, 'project') : path.resolve(import.meta.dirname, '..', '..'); }
function coreModule(relativePath) { return import(pathToFileURL(path.join(projectRoot(), relativePath)).href); }
function publicError(error) { return { ok: false, error: { code: error.code || 'DESKTOP_ERROR', message: error.message } }; }

async function settings(operation, payload) {
  const file = path.join(paths.config, 'settings.json');
  let current = {};
  try { current = JSON.parse(await fsp.readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (operation === 'settings:get') return current;
  const next = { ...current, ...payload };
  await fsp.writeFile(file, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

async function dispatch(operation, rawPayload) {
  const payload = validateIpcRequest(operation, rawPayload);
  if (operation.startsWith('settings:')) return settings(operation, payload);
  if (operation === 'dialog:selectDirectory') return dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (operation === 'doctor') { const { desktopDoctor } = await coreModule('src/core/doctor.mjs'); return desktopDoctor(); }
  if (operation === 'run:export') {
    const format = payload.format || 'json';
    const extension = format === 'markdown' ? 'md' : 'json';
    const selected = await dialog.showSaveDialog(mainWindow, { defaultPath: `moss-eval-${payload.run_id}.${extension}`, filters: [{ name: format === 'markdown' ? 'Human-readable Markdown' : 'Redacted JSON', extensions: [extension] }] });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    return worker.request('exportRun', payload.run_id, selected.filePath, format);
  }
  const mapping = {
    'source:addGithub': ['addGithubSource', payload], 'source:addLocal': ['addLocalSource', payload],
    inspect: ['inspect', payload.source_record], prepare: ['prepare', payload], 'prepare:cancel': ['cancelPreparation', payload.preparation_id],
    'run:start': ['start', payload], 'run:cancel': ['cancel', payload.run_id],
    'run:list': ['listRuns'], 'run:get': ['queryRun', payload.run_id], 'tasks:list': ['listTasks'],
  };
  const [method, ...args] = mapping[operation] || [];
  if (!method) throw new Error('Operation is not implemented');
  return worker.request(method, ...args);
}

async function createWindow() {
  const { resolveStoragePaths, ensureStoragePaths } = await coreModule('src/core/storage-paths.mjs');
  paths = await ensureStoragePaths(resolveStoragePaths({ userDataRoot: app.getPath('userData'), packaged: app.isPackaged, resourcesPath: process.resourcesPath, projectRoot: projectRoot() }));
  events = new EventStore(paths.logs);
  worker = new WorkerClient(utilityProcess, { userDataRoot: paths.root, packaged: app.isPackaged, resourcesPath: process.resourcesPath, projectRoot: projectRoot() });
  worker.on('event', async (event) => { await events.append(event); if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('moss-eval:event', event); });
  await worker.start();
  if (process.env.MOSS_EVAL_PACKAGED_SMOKE === '1') {
    if (process.env.MOSS_EVAL_SMOKE_MARKER) await fsp.writeFile(process.env.MOSS_EVAL_SMOKE_MARKER, 'worker handshake passed\n', 'utf8');
    process.stdout.write('worker handshake passed\n');
    app.quit();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1100, minHeight: 700, show: false,
    webPreferences: { preload: path.join(import.meta.dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (url !== mainWindow.webContents.getURL()) event.preventDefault(); });
  await mainWindow.loadFile(path.join(import.meta.dirname, '..', 'renderer', 'index.html'));
  if (process.env.MOSS_EVAL_PACKAGED_RENDERER_SMOKE === '1') {
    const result = await mainWindow.webContents.executeJavaScript(`({
      api: typeof window.mossEval,
      tab_count: document.querySelectorAll('#tabs button').length,
      source_heading: document.querySelector('#source h2')?.textContent || null
    })`);
    if (result.api !== 'object' || result.tab_count !== 5 || result.source_heading !== 'GitHub 仓库') {
      throw new Error(`Packaged renderer smoke failed: ${JSON.stringify(result)}`);
    }
    if (process.env.MOSS_EVAL_SMOKE_MARKER) {
      await fsp.writeFile(process.env.MOSS_EVAL_SMOKE_MARKER, JSON.stringify(result) + '\n', 'utf8');
    }
    process.stdout.write('packaged renderer preload passed\n');
    app.quit();
    return;
  }
  mainWindow.show();
}

ipcMain.handle('moss-eval:request', async (_event, operation, payload) => {
  try { return { ok: true, result: await dispatch(operation, payload) }; } catch (error) { return publicError(error); }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

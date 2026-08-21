import { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess } from 'electron';
import { spawn } from 'node:child_process';
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

async function remediatePrerequisite(action) {
  const { findDockerDesktop, prerequisiteAction } = await coreModule('src/core/desktop-runtime.mjs');
  const descriptor = prerequisiteAction(action);
  if (!descriptor) throw new Error('Unsupported prerequisite action');
  if (descriptor.url) {
    await shell.openExternal(descriptor.url);
    return { action, opened: true, label: descriptor.label };
  }
  if (action === 'start-docker') {
    const executable = findDockerDesktop();
    if (!executable) {
      const error = new Error('Docker Desktop is not installed in a supported location');
      error.code = 'DOCKER_DESKTOP_NOT_FOUND';
      throw error;
    }
    const child = spawn(executable, [], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return { action, started: true };
  }
  throw new Error('Prerequisite action is not implemented');
}

async function dispatch(operation, rawPayload) {
  const payload = validateIpcRequest(operation, rawPayload);
  if (operation.startsWith('settings:')) return settings(operation, payload);
  if (operation === 'dialog:selectDirectory') return dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (operation === 'doctor') {
    const { desktopDoctor } = await coreModule('src/core/doctor.mjs');
    const result = await desktopDoctor({ diskRoot: paths.root });
    if (result.runtime?.docker_command) await worker.request('configureRuntime', { docker_command: result.runtime.docker_command });
    return result;
  }
  if (operation === 'prerequisite:remediate') return remediatePrerequisite(payload.action);
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
    'model:testConnection': ['testModelConnection', payload],
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
    const result = await mainWindow.webContents.executeJavaScript(`(() => {
      const key = document.querySelector('#model-api-key');
      key.value = 'packaged-secret-must-not-persist';
      key.dispatchEvent(new Event('input', { bubbles: true }));
      const revisionIsAdvanced = document.querySelector('#source details.advanced')?.open === false;
      document.querySelector('[data-tab="configure"]').click();
      const guardedMessage = document.querySelector('#workflow-feedback')?.textContent || null;
      const stayedOnSource = document.querySelector('#source')?.hidden === false;
      document.querySelectorAll('.source-mode')[1].click();
      document.querySelector('#analyze-source').click();
      return {
        api: typeof window.mossEval,
        tab_count: document.querySelectorAll('#tabs button').length,
        primary_step_count: document.querySelectorAll('.step-tab').length,
        primary_step_labels: [...document.querySelectorAll('.step-tab strong')].map((item) => item.textContent),
        source_heading: document.querySelector('#source h2')?.textContent || null,
        source_mode_count: document.querySelectorAll('.source-mode').length,
        source_safety_visible: document.querySelector('.safety-note')?.textContent.includes('原项目不会被修改') === true,
        revision_is_advanced: revisionIsAdvanced,
        guarded_message: guardedMessage,
        stayed_on_source: stayedOnSource,
        missing_local_message: document.querySelector('#source-local-error')?.textContent || null,
        prerequisite_panel: Boolean(document.querySelector('#prerequisite-panel')),
        pending_storage_key: localStorage.getItem('moss-eval.pending-preparation.v1'),
        model_provider_present: Boolean(document.querySelector('#model-provider')),
        model_protocol_count: document.querySelectorAll('#model-protocol option').length,
        model_protocol_is_advanced: document.querySelector('#model-protocol')?.closest('details')?.open === false,
        model_api_key_type: key?.type || null,
        model_base_url_editable: document.querySelector('#model-base-url')?.readOnly === false,
        generic_secrets_hidden: document.querySelector('#generic-runtime-secrets')?.hidden === true && getComputedStyle(document.querySelector('#generic-runtime-secrets')).display === 'none',
        api_key_persisted: JSON.stringify({ ...localStorage }).includes('packaged-secret-must-not-persist')
      };
    })()`);
    if (result.api !== 'object' || result.tab_count !== 5 || result.primary_step_count !== 3 || result.source_heading !== '你想评测哪个 Agent？' || result.guarded_message !== '请先选择并分析要评测的 Agent' || !result.stayed_on_source || result.missing_local_message !== '请先选择电脑上的 Agent 项目文件夹' || !result.prerequisite_panel || result.pending_storage_key !== null || result.model_provider_present || result.model_protocol_count !== 3 || !result.model_protocol_is_advanced || result.model_api_key_type !== 'password' || !result.model_base_url_editable || !result.generic_secrets_hidden || result.api_key_persisted) {
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

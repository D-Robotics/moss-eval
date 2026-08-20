const { contextBridge, ipcRenderer } = require('electron');

const request = async (operation, payload = {}) => {
  const response = await ipcRenderer.invoke('moss-eval:request', operation, payload);
  if (!response.ok) throw Object.assign(new Error(response.error.message), { code: response.error.code });
  return response.result;
};

contextBridge.exposeInMainWorld('mossEval', Object.freeze({
  doctor: () => request('doctor'),
  addGithubSource: (url, ref) => request('source:addGithub', { url, ref }),
  addLocalSource: (directory) => request('source:addLocal', { directory }),
  selectDirectory: () => request('dialog:selectDirectory'),
  inspect: (sourceRecord) => request('inspect', { source_record: sourceRecord }),
  prepare: (reviewedConfiguration) => request('prepare', reviewedConfiguration),
  cancelPreparation: (preparationId) => request('prepare:cancel', { preparation_id: preparationId }),
  startRun: (configuration) => request('run:start', configuration),
  cancelRun: (runId) => request('run:cancel', { run_id: runId }),
  listRuns: () => request('run:list'),
  getRun: (runId) => request('run:get', { run_id: runId }),
  exportRun: (runId, format = 'json') => request('run:export', { run_id: runId, format }),
  listTasks: () => request('tasks:list'),
  getSettings: () => request('settings:get'),
  updateSettings: (settings) => request('settings:update', settings),
  onEvent: (listener) => {
    const handler = (_event, data) => listener(data);
    ipcRenderer.on('moss-eval:event', handler);
    return () => ipcRenderer.removeListener('moss-eval:event', handler);
  },
}));

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const executable = path.resolve(process.argv[2] || 'dist/win-unpacked/MOSS Eval.exe');
const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-renderer-smoke-'));
const marker = path.join(directory, 'renderer.json');

try {
  const child = spawn(executable, [`--user-data-dir=${path.join(directory, 'user-data')}`], {
    env: {
      ...process.env,
      MOSS_EVAL_PACKAGED_RENDERER_SMOKE: '1',
      MOSS_EVAL_SMOKE_MARKER: marker,
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('packaged renderer smoke timed out'));
    }, 15_000);
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
  assert.equal(exitCode, 0);
  const result = JSON.parse(await fsp.readFile(marker, 'utf8'));
  assert.deepEqual(result, {
    api: 'object',
    tab_count: 5,
    primary_step_count: 3,
    primary_step_labels: ['选择 Agent','配置评测','运行与结果'],
    source_heading: '你想评测哪个 Agent？',
    source_mode_count: 2,
    source_safety_visible: true,
    revision_is_advanced: true,
    guarded_message: '请先选择并分析要评测的 Agent',
    stayed_on_source: true,
    missing_local_message: '请先选择电脑上的 Agent 项目文件夹',
    prerequisite_panel: true,
    pending_storage_key: null,
    model_provider_present: false,
    model_protocol_count: 3,
    model_protocol_is_advanced: true,
    model_api_key_type: 'password',
    model_base_url_editable: true,
    generic_secrets_hidden: true,
    agent_actions_authorization_visible: true,
    default_trials: '1',
    api_key_persisted: false,
  });
  process.stdout.write('packaged renderer preload passed\n');
} finally {
  await fsp.rm(directory, { recursive: true, force: true });
}

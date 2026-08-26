import fsp from 'node:fs/promises';
import path from 'node:path';
import { readJson } from '../lib/json.mjs';
import { resolveRelative } from '../lib/paths.mjs';
import { validateTask } from './task-validator.mjs';
import { normalizeTaskRequirements } from './capabilities.mjs';

async function discover(directory, output) {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await discover(absolute, output);
    else if (entry.isFile() && entry.name.endsWith('.task.json')) output.push(absolute);
  }
}

function normalizeDocument(document, file) {
  if (Array.isArray(document)) return { defaults: {}, tasks: document };
  if (document && Array.isArray(document.tasks)) {
    return { defaults: document.defaults || {}, tasks: document.tasks };
  }
  if (document && typeof document === 'object') return { defaults: {}, tasks: [document] };
  throw new Error('Task file must contain an object, array, or tasks array: ' + file);
}

function applyDefaults(defaults, task) {
  const merged = { ...structuredClone(defaults), ...structuredClone(task) };
  for (const key of ['environment', 'budget']) {
    merged[key] = { ...(defaults[key] || {}), ...(task[key] || {}) };
  }
  if (defaults.instruction_suffix) {
    merged.instruction = String(task.instruction || '') + '\n\n' + defaults.instruction_suffix;
  }
  delete merged.instruction_suffix;
  return merged;
}

function resolveTaskPaths(task, file) {
  const directory = path.dirname(file);
  const copy = structuredClone(task);
  copy.enabled = copy.enabled !== false;
  copy.suites = Array.isArray(copy.suites) ? copy.suites : [copy.suite || 'default'];
  copy.environment.network = copy.environment.network || 'disabled';
  copy.environment.fixture = resolveRelative(directory, copy.environment.fixture);
  copy.quality_tier = copy.quality_tier || 'experimental';
  copy.capability_requirements = normalizeTaskRequirements(copy);
  copy._meta = {
    file,
    directory,
    oracleRoot: copy.professional_dataset?.oracle_bundle_path
      ? resolveRelative(directory, copy.professional_dataset.oracle_bundle_path)
      : null,
  };
  return copy;
}

export async function loadTasks(taskRoots) {
  const files = [];
  for (const root of taskRoots) {
    const stat = await fsp.stat(root);
    if (stat.isDirectory()) await discover(root, files);
    else if (stat.isFile()) files.push(root);
  }

  const tasks = [];
  const identifiers = new Map();
  for (const file of files) {
    const document = await readJson(file);
    const normalized = normalizeDocument(document, file);
    for (const rawTask of normalized.tasks) {
      const task = resolveTaskPaths(applyDefaults(normalized.defaults, rawTask), file);
      validateTask(task, file);
      const key = task.id + '@' + task.version;
      if (identifiers.has(key)) {
        throw new Error('Duplicate task ' + key + ' in ' + identifiers.get(key) + ' and ' + file);
      }
      identifiers.set(key, file);
      tasks.push(task);
    }
  }
  return tasks;
}

export function selectTasks(tasks, selector = {}) {
  const ids = selector.ids ? new Set(selector.ids) : null;
  const categories = selector.categories ? new Set(selector.categories) : null;
  const priorities = selector.priorities ? new Set(selector.priorities) : null;
  const suite = selector.suite || null;
  return tasks.filter((task) => {
    if (!task.enabled && !selector.includeDisabled) return false;
    if (ids && !ids.has(task.id)) return false;
    if (categories && !categories.has(task.category)) return false;
    if (priorities && !priorities.has(task.priority)) return false;
    if (suite && !task.suites.includes(suite)) return false;
    return true;
  });
}

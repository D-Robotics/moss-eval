import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertWithin } from '../lib/paths.mjs';
import { graderResult } from './result.mjs';

function getJsonPath(value, expression) {
  const parts = String(expression)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (current === null || current === undefined || !(part in Object(current))) return undefined;
    current = current[part];
  }
  return current;
}

async function evaluateAssertion(assertion, workspace) {
  const target = assertWithin(workspace, path.resolve(workspace, assertion.path), 'file assertion');
  let content;
  let exists = true;
  try {
    content = await fsp.readFile(target);
  } catch (error) {
    if (error.code === 'ENOENT') exists = false;
    else throw error;
  }
  if (assertion.exists === true && !exists) return 'missing file ' + assertion.path;
  if (assertion.exists === false && exists) return 'file should not exist ' + assertion.path;
  if (!exists) return null;
  const text = content.toString(assertion.encoding || 'utf8');
  if (assertion.equals !== undefined && text !== assertion.equals) {
    return 'file content did not equal expected value for ' + assertion.path;
  }
  if (assertion.contains !== undefined && !text.includes(assertion.contains)) {
    return 'file did not contain expected text for ' + assertion.path;
  }
  if (assertion.not_contains !== undefined && text.includes(assertion.not_contains)) {
    return 'file contained forbidden text for ' + assertion.path;
  }
  if (assertion.matches !== undefined && !new RegExp(assertion.matches, assertion.flags || 'm').test(text)) {
    return 'file did not match expected pattern for ' + assertion.path;
  }
  if (assertion.sha256 !== undefined) {
    const digest = createHash('sha256').update(content).digest('hex');
    if (digest !== assertion.sha256) return 'file hash mismatch for ' + assertion.path;
  }
  if (assertion.json_path !== undefined) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return 'file was not valid JSON for ' + assertion.path;
    }
    const actual = getJsonPath(parsed, assertion.json_path);
    if (assertion.json_equals !== undefined && JSON.stringify(actual) !== JSON.stringify(assertion.json_equals)) {
      return 'JSON value mismatch at ' + assertion.json_path + ' in ' + assertion.path;
    }
  }
  return null;
}

export async function runFileVerifier(grader, context) {
  const started = Date.now();
  try {
    const assertions = grader.assertions || [];
    if (assertions.length === 0) throw new Error('File grader requires assertions');
    const failures = [];
    for (const assertion of assertions) {
      const failure = await evaluateAssertion(assertion, context.workspace);
      if (failure) failures.push(failure);
    }
    return graderResult(grader, failures.length ? 'failed' : 'passed', {
      reason: failures.length ? failures.join('; ') : 'All file assertions passed',
      details: { assertion_count: assertions.length, failures },
      durationMs: Date.now() - started,
    });
  } catch (error) {
    return graderResult(grader, 'error', {
      reason: error.message,
      durationMs: Date.now() - started,
    });
  }
}

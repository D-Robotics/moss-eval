import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const appRoot = path.resolve(import.meta.dirname, '..');
const projectRoot = path.resolve(appRoot, '..');
const pkg = JSON.parse(await fsp.readFile(path.join(appRoot, 'package.json'), 'utf8'));
let commit = null;
let dirty = null;
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim(); dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: projectRoot, encoding: 'utf8' }).trim()); } catch {}
await fsp.writeFile(path.join(appRoot, 'build-provenance.json'), JSON.stringify({ schema_version:'1.0', application_version:pkg.version, core_version:JSON.parse(await fsp.readFile(path.join(projectRoot,'package.json'),'utf8')).version, git_commit:commit, git_dirty:dirty, node:process.version, platform:process.platform, arch:process.arch, generated_at:new Date().toISOString() }, null, 2) + '\n', 'utf8');

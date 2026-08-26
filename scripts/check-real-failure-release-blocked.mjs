import path from 'node:path';

import { loadProfessionalDataset } from '../src/dataset/contract.mjs';
import { buildProfessionalRelease } from '../src/dataset/release.mjs';
import fsp from 'node:fs/promises';

const root = path.resolve(import.meta.dirname, '..');
const datasetRoot = path.join(root, 'datasets', 'real-failure-pilot');
const dataset = await loadProfessionalDataset(datasetRoot);
const calibrationFile = path.join(root, '.moss-eval', 'datasets', `${dataset.manifest.id}-${dataset.manifest.version}`, 'calibration', 'calibration.json');
const calibration = JSON.parse(await fsp.readFile(calibrationFile, 'utf8'));
const released = await buildProfessionalRelease(datasetRoot, { calibration });
if (released.result.release_eligible) throw new Error('Public development dataset unexpectedly became release eligible');
process.stdout.write(JSON.stringify(released.result, null, 2) + '\n');

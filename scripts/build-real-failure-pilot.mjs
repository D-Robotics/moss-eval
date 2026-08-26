import path from 'node:path';
import process from 'node:process';

import { buildScaledRealFailureCorpus } from '../src/dataset/real-failure-builder.mjs';

const args = process.argv.slice(2);
const sourceIndex = args.indexOf('--source');
const sourceCheckout = sourceIndex >= 0 ? path.resolve(args[sourceIndex + 1]) : null;
const result = await buildScaledRealFailureCorpus({
  projectRoot: path.resolve(import.meta.dirname, '..'),
  reproduce: args.includes('--reproduce'),
  sourceCheckout,
});
process.stdout.write(JSON.stringify(result, null, 2) + '\n');

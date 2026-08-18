import test from 'node:test';
import assert from 'node:assert/strict';

import { createSourceConfig } from '../../src/core/source-track.mjs';

test('source track pins image and records source provenance separately from release', () => {
  const base = {
    execution: { environment_overrides: { network: 'public' } },
    agents: {
      moss: { adapter: 'moss', command: 'moss', args: ['{instruction}'] },
      reference: { adapter: 'command', command: 'node' },
    },
  };
  const config = createSourceConfig(base, {
    evaluationRoot: 'D:\\moss-eval',
    repository: 'https://github.com/D-Robotics/moss.git',
    ref: 'main',
    commit: 'a'.repeat(40),
    checkout: 'D:\\source',
    image: 'moss-eval-source:aaaaaaaaaaaa',
    version: '0.6.0',
  });

  assert.equal(config.execution.environment_overrides.image, 'moss-eval-source:aaaaaaaaaaaa');
  assert.deepEqual(Object.keys(config.agents), ['moss', 'reference']);
  assert.equal(config.agents.moss.track, 'source');
  assert.equal(config.agents.moss.source_commit, 'a'.repeat(40));
  assert.equal(config.agents.moss.source_dirty, false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { verify } from '../bin/verify-private-mirror.mjs';

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

test('exact-tree private CI evidence only passes pinned blobs and subtree', () => {
  const repo = mkdtempSync(join(tmpdir(), 'mirror-proof-'));
  try {
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.name', 'CI Mirror Test');
    git(repo, 'config', 'user.email', 'ci@example.invalid');
    mkdirSync(join(repo, 'source'));
    writeFileSync(join(repo, 'source', 'main.ores'), 'fnc foo(): int { return 42; }\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'test private source mirror');
    const expectedTree = git(repo, 'rev-parse', 'HEAD:source');
    const sha = git(repo, 'rev-parse', 'HEAD:source/main.ores');
    const params = {
      repo, subtreePath: 'source', expectedTree,
      blobs: [{ path: 'main.ores', sha }]
    };
    assert.deepEqual(verify(params), {
      status: 'EXACT_TREE', sourceTree: expectedTree, verifiedBlobs: 1
    });
    assert.throws(() => verify({ ...params, expectedTree: '0'.repeat(40) }), /mismatch/);
    assert.throws(() => verify({ ...params, blobs: [{ path: 'main.ores', sha: '0'.repeat(40) }] }), /mismatch/);
    assert.throws(() => verify({ ...params, subtreePath: '../source' }), /invalid/);
    assert.throws(() => verify({ ...params, blobs: [{ path: '../secrets', sha }] }), /invalid/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

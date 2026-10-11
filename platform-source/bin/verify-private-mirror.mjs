#!/usr/bin/env node
// Evidence-only Git tree verifier. Never fetches or modifies private source.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function safePath(path) {
  return typeof path === 'string'
    && /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(path)
    && path.split('/').every(p => p !== '.' && p !== '..');
}

export function verify({ repo, subtreePath, expectedTree, blobs = [] }) {
  if (!/^[0-9a-f]{40}$/.test(expectedTree) || !safePath(subtreePath)) {
    throw Error('invalid source tree pin or subtree path');
  }
  if (!Array.isArray(blobs)) throw Error('invalid blobs');
  const actual = git(repo, 'rev-parse', 'HEAD:' + subtreePath);
  if (actual !== expectedTree || git(repo, 'cat-file', '-t', actual) !== 'tree') {
    throw Error('exact Git subtree mismatch');
  }
  for (const entry of blobs) {
    if (!entry || !safePath(entry.path) || !/^[0-9a-f]{40}$/.test(entry.sha)) {
      throw Error('invalid blob pin');
    }
    const oid = git(repo, 'rev-parse', 'HEAD:' + subtreePath + '/' + entry.path);
    if (oid !== entry.sha || git(repo, 'cat-file', '-t', oid) !== 'blob') {
      throw Error('exact Git blob mismatch at ' + entry.path);
    }
  }
  return { status: 'EXACT_TREE', sourceTree: actual, verifiedBlobs: blobs.length };
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  try {
    if (process.argv.length !== 3) throw Error('pass one manifest JSON file');
    const input = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
    console.log(JSON.stringify(verify({ ...input, repo: resolve(input.repository) })));
  } catch (error) {
    console.error('MIRROR_UNVERIFIED: ' + error.message);
    process.exitCode = 1;
  }
}

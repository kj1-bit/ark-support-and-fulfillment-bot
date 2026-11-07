'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const root = path.resolve(__dirname, '../..');

function git(...args) {
  return cp.execFileSync(
    'git',
    args,
    {
      cwd: root,
      encoding: 'utf8'
    }
  ).trim();
}

test('V1 production entrypoints remain unchanged from rollback baseline', () => {
  const changed = git(
    'diff',
    '--name-only',
    'a005b8c',
    '--',
    'index.js',
    'deploy-commands.js',
    'database.sqlite'
  );

  assert.equal(changed, '');
});

test('Git tracks no real environment secret or runtime database files', () => {
  const tracked = git('ls-files')
    .split(/\r?\n/)
    .filter(Boolean);

  const forbidden = tracked.filter(file => {
    const normalized = file.replaceAll('\\', '/');

    if (normalized === '.env.example') {
      return false;
    }

    return (
      /(^|\/)\.env($|\.)/i.test(normalized) ||
      /database\.sqlite($|-)/i.test(normalized) ||
      /\.sqlite-(wal|shm)$/i.test(normalized) ||
      /\.sqlite-backup$/i.test(normalized)
    );
  });

  assert.deepEqual(forbidden, []);
});

test('Discord composition exposes neither database nor raw transport', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/composition/start-v2.js'),
    'utf8'
  );

  const start = source.indexOf('services:Object.freeze({');
  const end = source.indexOf('})});if(!discord', start);

  assert(
    start >= 0 && end > start,
    'services boundary was not found'
  );

  const services = source.slice(start, end);

  assert(!/\bdatabase\s*:/.test(services));
  assert(!/\btransport\s*:/.test(services));
});

test('application source contains no process execution API', () => {
  const sourceRoot = path.join(root, 'src');
  const stack = [sourceRoot];
  const hits = [];

  while (stack.length) {
    const current = stack.pop();

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.endsWith('.js')) {
        const text = fs.readFileSync(full, 'utf8');

        if (
          /child_process|execFile|execSync|spawn\s*\(|fork\s*\(/.test(text)
        ) {
          hits.push(path.relative(root, full));
        }
      }
    }
  }

  assert.deepEqual(hits, []);
});

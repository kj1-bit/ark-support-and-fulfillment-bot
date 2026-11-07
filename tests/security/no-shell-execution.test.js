'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const runtimeRoots = ['index.js', 'deploy-commands.js', 'config', 'features', 'services', 'src'];
const processExecutionPatterns = [
  /require\s*\(\s*['"](?:node:)?child_process['"]\s*\)/,
  /from\s+['"](?:node:)?child_process['"]/,
  /\b(?:exec|execFile|spawn|fork)\s*\(/
];

function collectJavaScript(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return [];
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) return absolutePath.endsWith('.js') ? [absolutePath] : [];
  return fs.readdirSync(absolutePath, { withFileTypes: true }).flatMap(entry =>
    collectJavaScript(path.join(relativePath, entry.name))
  );
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('application runtime contains no operating-system process execution API', () => {
  const files = runtimeRoots.flatMap(collectJavaScript);
  assert(files.length > 0, 'expected runtime JavaScript files');
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of processExecutionPatterns) {
      assert(!pattern.test(source), `${path.relative(root, file)} contains prohibited process execution: ${pattern}`);
    }
  }
});

test('updatebot is absent from command registration and runtime handling', () => {
  assert(!/updatebot/i.test(read('deploy-commands.js')));
  assert(!/updatebot/i.test(read('index.js')));
});

test('UPDATE_SCRIPT_PATH is absent from public and runtime configuration', () => {
  assert(!/UPDATE_SCRIPT_PATH/.test(read('.env.example')));
  assert(!/UPDATE_SCRIPT_PATH/.test(read('index.js')));
});

test('operator deployment documentation requires an out-of-band boundary', () => {
  const documentation = read('docs/V2_DEPLOYMENT.md');
  assert.match(documentation, /operator-controlled/i);
  assert.match(documentation, /outside the Discord process/i);
  assert.match(documentation, /Rollback/i);
  assert.match(documentation, /private operations repository/i);
});

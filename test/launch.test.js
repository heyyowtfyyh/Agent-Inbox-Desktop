import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { launchElectron } from '../scripts/start.js';
import { npmCommand } from '../scripts/npm-command.js';

test('Electron launch removes inherited Node mode while preserving arguments and local overrides', () => {
  const env = { ELECTRON_RUN_AS_NODE: '1', AGENT_INBOX_CODEX_HOME: 'local home', PATH: 'tools' };
  const args = ['C:\\App # 中文 空間', '--sample'];
  const child = {};
  assert.equal(launchElectron(args, { env, spawnProcess: (executable, actual, options) => {
    assert.ok(executable.endsWith(process.platform === 'win32' ? 'electron.exe' : 'Electron') || executable.endsWith('/electron'));
    assert.deepEqual(actual, args);
    assert.deepEqual(options.env, { AGENT_INBOX_CODEX_HOME: 'local home', PATH: 'tools' });
    assert.equal(options.stdio, 'inherit');
    return child;
  } }), child);
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
});

test('npm discovery supports installations separate from Node, lifecycle paths and PATH fallback', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'agent-inbox-npm-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('agent-inbox-npm-test-'));
    rmSync(root, { recursive: true, force: true });
  });
  const node = path.join(root, 'node', 'node.exe');
  const tools = path.join(root, 'npm # 中文 空間');
  const cli = path.join(tools, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  mkdirSync(path.dirname(cli), { recursive: true }); writeFileSync(cli, '// fixture\n');
  const expected = { command: node, args: [cli] };
  assert.deepEqual(npmCommand({ node, platform: 'win32', env: { npm_execpath: cli } }), expected);
  assert.deepEqual(npmCommand({ node, platform: 'win32', env: { npm_execpath: path.join(root, 'missing.js'), PATH: `"${tools}"` } }), expected);
  assert.throws(() => npmCommand({ node, platform: 'win32', env: {} }), /npm CLI could not be found/);
});

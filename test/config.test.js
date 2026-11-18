import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { defaultCodexPipe, readConfig } from '../src/config.js';

function fixture(t, contents) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'agent-inbox-config-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const envFile = path.join(directory, '.env');
  if (contents !== undefined) writeFileSync(envFile, contents);
  return { directory, envFile };
}

test('missing and blank local settings preserve automatic defaults', t => {
  const { envFile } = fixture(t);
  const expected = {
    codexHome: path.join(os.homedir(), '.codex'), vsCodePath: undefined,
    codexPipe: defaultCodexPipe, codexDeepLinksEnabled: true, avatarTheme: 'auto',
  };
  assert.deepEqual(readConfig({ env: {}, envFile }), expected);
  writeFileSync(envFile, 'AGENT_INBOX_CODEX_HOME=\nAGENT_INBOX_VSCODE_PATH=\nAGENT_INBOX_CODEX_PIPE=\nAGENT_INBOX_VERIFIED_CODEX_LINKS=\n');
  assert.deepEqual(readConfig({ env: { AGENT_INBOX_CODEX_HOME: '  ' }, envFile }), expected);
});

test('local quoted paths and pipe overrides are read without modifying the environment', t => {
  const { directory, envFile } = fixture(t);
  const home = path.join(directory, 'Codex # local');
  const editor = path.join(directory, 'VS Code', 'Code.exe');
  const pipe = String.raw`\\.\pipe\agent-inbox-config-test`;
  writeFileSync(envFile, `AGENT_INBOX_CODEX_HOME='${home}'\nAGENT_INBOX_VSCODE_PATH='${editor}'\nAGENT_INBOX_CODEX_PIPE='${pipe}'\nAGENT_INBOX_VERIFIED_CODEX_LINKS=0\nUNRELATED_SETTING=ignored\n`);
  const env = {};
  assert.deepEqual(readConfig({ env, envFile }), {
    codexHome: home, vsCodePath: editor, codexPipe: pipe, codexDeepLinksEnabled: false, avatarTheme: 'auto',
  });
  assert.deepEqual(env, {});
});

test('process overrides win, while CODEX_HOME remains a compatible fallback', t => {
  const { directory, envFile } = fixture(t);
  const local = path.join(directory, 'local');
  const inherited = path.join(directory, 'inherited');
  writeFileSync(envFile, `AGENT_INBOX_CODEX_HOME='${local}'\nAGENT_INBOX_VERIFIED_CODEX_LINKS=0\n`);
  assert.equal(readConfig({ env: { CODEX_HOME: inherited }, envFile }).codexHome, local);
  const config = readConfig({ env: { AGENT_INBOX_CODEX_HOME: inherited, AGENT_INBOX_VERIFIED_CODEX_LINKS: '1' }, envFile });
  assert.equal(config.codexHome, inherited);
  assert.equal(config.codexDeepLinksEnabled, true);
  writeFileSync(envFile, '');
  assert.equal(readConfig({ env: { CODEX_HOME: inherited }, envFile }).codexHome, inherited);
});

test('invalid paths, remote pipes and invalid toggle values fail clearly', t => {
  const { envFile } = fixture(t, '');
  for (const [name, value] of [
    ['AGENT_INBOX_CODEX_HOME', 'relative'], ['AGENT_INBOX_VSCODE_PATH', 'Code.exe'],
    ['AGENT_INBOX_CODEX_PIPE', String.raw`\\remote\pipe\codex-ipc`],
    ['AGENT_INBOX_VERIFIED_CODEX_LINKS', 'false'],
    ['AVATAR_THEME', 'personal'],
  ]) assert.throws(() => readConfig({ env: { [name]: value }, envFile }), new RegExp(name));
});

test('the public example keeps automatic detection enabled', () => {
  assert.equal(readConfig({ env: {}, envFile: new URL('../.env.example', import.meta.url) }).codexPipe, defaultCodexPipe);
});

test('Windows backslashes are preserved with single quotes and corrupted quoted paths are rejected', t => {
  const { envFile } = fixture(t);
  const home = String.raw`C:\new\Codex # 中文 空間`;
  writeFileSync(envFile, `AGENT_INBOX_CODEX_HOME='${home}'\n`);
  assert.equal(readConfig({ env: {}, envFile }).codexHome, home);
  writeFileSync(envFile, `AGENT_INBOX_CODEX_HOME="${home}"\n`);
  assert.throws(() => readConfig({ env: {}, envFile }), /AGENT_INBOX_CODEX_HOME contains control characters.*single quotes/);
  // Validate before trimming: a trailing newline must not silently select a different folder.
  writeFileSync(envFile, String.raw`AGENT_INBOX_VSCODE_PATH="C:\Tools\n"`);
  assert.throws(() => readConfig({ env: {}, envFile }), /AGENT_INBOX_VSCODE_PATH contains control characters/);
  writeFileSync(envFile, '');
  assert.throws(() => readConfig({ env: { CODEX_HOME: `${home}\n` }, envFile }), /CODEX_HOME contains control characters/);
});

test('avatar theme defaults to auto and process override wins over local settings', t => {
  const { envFile } = fixture(t, 'AVATAR_THEME=open-source\n');
  assert.equal(readConfig({ env: {}, envFile }).avatarTheme, 'open-source');
  assert.equal(readConfig({ env: { AVATAR_THEME: 'auto' }, envFile }).avatarTheme, 'auto');
});

test('launching from another directory does not load that directory\'s .env', t => {
  const { directory } = fixture(t, 'AGENT_INBOX_CODEX_HOME=invalid-relative-path\n');
  const moduleUrl = new URL('../src/config.js', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { readConfig } from ${JSON.stringify(moduleUrl)}; readConfig({ env: {} });`,
  ], { cwd: directory, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
});

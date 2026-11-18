import assert from 'node:assert/strict';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAvatarTheme } from '../src/avatar/theme.js';
import { npmCommand } from './npm-command.js';
import { launchElectron } from './start.js';

const root = mkdtempSync(path.join(os.tmpdir(), 'agent-inbox-avatar-ui-'));
const output = fileURLToPath(new URL('../.local/avatar-qa/', import.meta.url));
mkdirSync(output, { recursive: true });
const personal = resolveAvatarTheme();
try {
  const publicRoot = path.join(root, 'public-only');
  const project = fileURLToPath(new URL('../', import.meta.url));
  cpSync(path.join(project, 'src'), path.join(publicRoot, 'src'), { recursive: true });
  mkdirSync(path.join(publicRoot, 'scripts', 'fixtures'), { recursive: true });
  copyFileSync(new URL('./fixtures/avatar-ui.mjs', import.meta.url), path.join(publicRoot, 'scripts', 'fixtures', 'avatar-ui.mjs'));
  writeFileSync(path.join(publicRoot, 'package.json'), '{"type":"module"}');
  for (const [family, weights] of [['sans', [400, 500, 600]], ['mono', [500]]]) {
    const relative = `node_modules/@fontsource/ibm-plex-${family}/files`;
    mkdirSync(path.join(publicRoot, relative), { recursive: true });
    for (const weight of weights) {
      const file = `ibm-plex-${family}-latin-${weight}-normal.woff2`;
      copyFileSync(path.join(project, relative, file), path.join(publicRoot, relative, file));
    }
  }
  const scenarios = [
    { key: 'auto', preference: 'auto', expected: personal.theme.id },
    ...(personal.theme.id === 'personal' ? [{ key: 'saved', preference: 'auto', expected: 'open-source', profile: 'auto', verifySaved: true }] : []),
    { key: 'open-source', preference: 'open-source', expected: 'open-source' },
    { key: 'public-only', preference: 'auto', expected: 'open-source', fixture: path.join(publicRoot, 'scripts', 'fixtures', 'avatar-ui.mjs') },
  ];
  for (const scenario of scenarios) {
    const { preference } = scenario;
    const profile = path.join(root, scenario.profile ?? scenario.key);
    mkdirSync(profile, { recursive: true });
    const env = { ...process.env, AVATAR_THEME: preference, AGENT_INBOX_TEST_PROFILE: profile,
      AGENT_INBOX_AVATAR_QA_OUTPUT: output,
      AGENT_INBOX_AVATAR_QA_SCENARIO: scenario.key,
      AGENT_INBOX_VERIFY_SAVED: scenario.verifySaved ? '1' : '0',
      AGENT_INBOX_EXPECTED_THEME: scenario.expected };
    // Exercise the production launcher with the inherited agent-environment flag.
    env.ELECTRON_RUN_AS_NODE = '1';
    const code = await new Promise((resolve, reject) => {
      const child = launchElectron([scenario.fixture ?? fileURLToPath(new URL('./fixtures/avatar-ui.mjs', import.meta.url)), '--sample'], {
        env, windowsHide: true,
      });
      const timeout = setTimeout(() => child.kill(), 25_000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); resolve(code ?? 1); });
    });
    assert.equal(code, 0, `${scenario.key} UI check failed`);
  }
  // npm pack is a local dry run: no archive, publication or Git changes.
  const { spawnSync } = await import('node:child_process');
  const npm = npmCommand();
  const packed = spawnSync(npm.command, [...npm.args, 'pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', windowsHide: true,
  });
  assert.equal(packed.status, 0, packed.stderr);
  const files = JSON.parse(packed.stdout)[0].files.map(file => file.path);
  assert.equal(files.filter(file => /^src\/avatar\/open-source\/.*\.svg$/.test(file)).length, 21);
  assert.ok(!files.some(file => /^src\/avatar\/open-source\/robot-/.test(file)));
  assert.ok(!files.some(file => /(^|\/)\.local\/|(^|\/)\.env$|(^|\/)\.git\/|^src\/assets\/(face|shape)-|^src\/assets\/(app-icon\.png|agent-inbox-purple\.ico)$/.test(file)));
  console.log(JSON.stringify({ distribution: 'dry-run passed', privateAssetsExcluded: true, svgVariants: 21 }));
} finally {
  const resolved = path.resolve(root);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('agent-inbox-avatar-ui-')) {
    throw new Error('Unexpected test directory.');
  }
  rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

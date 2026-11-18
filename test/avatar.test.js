import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { avatarColors, avatarFor } from '../src/avatar/index.js';
import { resolveAvatarTheme } from '../src/avatar/theme.js';
import { createAvatarPreferences } from '../src/avatar/preferences.js';

function personalFixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'agent-inbox-avatar-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const manifest = { version: 1, render: 'layered', shapes: ['circle'], neutralFaces: { circle: 'neutral' } };
  const files = ['shape-circle.svg', 'face-neutral.svg', 'face-working.svg', 'face-waiting.svg'];
  writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(path.join(directory, 'theme.css'), '.avatar-personal { display: block; }');
  for (const file of ['app-icon.png', 'app-icon.ico']) {
    copyFileSync(new URL(`../src/avatar/open-source/${file}`, import.meta.url), path.join(directory, file));
  }
  for (const file of files) writeFileSync(path.join(directory, file), '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>');
  return { directory, personalDirectory: pathToFileURL(`${directory}${path.sep}`) };
}

test('auto selects a complete local theme; explicit open-source excludes every personal file', t => {
  const { personalDirectory } = personalFixture(t);
  assert.equal(resolveAvatarTheme({ personalDirectory }).theme.id, 'personal');
  const selected = resolveAvatarTheme({ preference: 'open-source', personalDirectory });
  assert.equal(selected.theme.id, 'open-source');
  assert.equal(selected.files.size, 24);
  assert.ok([...selected.files.values()].every(url => url.pathname.includes('/src/avatar/open-source/')));
});

test('absent, incomplete or invalid local themes fall back as a whole with a diagnostic', t => {
  const { directory, personalDirectory } = personalFixture(t);
  const absent = pathToFileURL(`${path.join(directory, 'absent')}${path.sep}`);
  for (const url of [absent, personalDirectory]) {
    if (url === personalDirectory) rmSync(path.join(directory, 'face-working.svg'));
    const selected = resolveAvatarTheme({ personalDirectory: url });
    assert.equal(selected.theme.id, 'open-source');
    assert.ok(selected.diagnostic);
    assert.ok([...selected.files.values()].every(file => !file.href.startsWith(personalDirectory.href)));
  }
  writeFileSync(path.join(directory, 'manifest.json'), '{broken');
  assert.equal(resolveAvatarTheme({ personalDirectory }).theme.id, 'open-source');
  writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({
    version: 1, render: 'layered', shapes: ['../outside'], neutralFaces: {},
  }));
  assert.equal(resolveAvatarTheme({ personalDirectory }).theme.id, 'open-source');
});

test('seven paired shapes have matching body crops, tintable silhouettes and no status decorations', () => {
  const selected = resolveAvatarTheme({ preference: 'open-source' });
  assert.equal(selected.theme.shapes.length, 7);
  assert.ok(!selected.theme.shapes.includes('robot'));
  for (const shape of selected.theme.shapes) {
    const variants = ['idle', 'running', 'waiting'].map(expression =>
      readFileSync(selected.files.get(`avatar/${shape}-${expression}.svg`), 'utf8'));
    const crop = variants[0].match(/viewBox="([^"]+)"/)[1];
    const body = variants[0].match(/<path[^>]*id="body"[^>]*\/>/)[0];
    for (const svg of variants) {
      assert.equal(svg.match(/viewBox="([^"]+)"/)[1], crop);
      assert.ok(svg.includes(body));
      assert.equal((svg.match(/fill="currentColor"/g) ?? []).length, 1);
      assert.doesNotMatch(svg, /<image\b|https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
      const colored = svg.match(/(?:fill|stroke)="#[0-9a-f]{6}"/gi) ?? [];
      assert.ok(colored.every(value => value.endsWith('#141414"')));
    }
    assert.deepEqual(variants.map(svg => (svg.match(/<path\b/g) ?? []).length), [4, 3, 4]);
  }
});

test('every shape can use every color while session identity remains deterministic', () => {
  const { theme } = resolveAvatarTheme({ preference: 'open-source' });
  const pairs = new Set();
  const colorsByShape = new Map(theme.shapes.map(shape => [shape, new Set()]));
  for (let i = 0; i < 4096; i++) {
    const session = { id: `combination-${i}`, runtime: 'idle' };
    const result = avatarFor(session, theme);
    assert.deepEqual(avatarFor(session, theme), result);
    pairs.add(`${result.shape}/${result.color}`);
    colorsByShape.get(result.shape).add(result.color);
  }
  assert.equal(pairs.size, 56);
  for (const colors of colorsByShape.values()) assert.deepEqual([...colors].sort(), [...avatarColors].sort());
});

test('state and unread changes preserve identity; Error and Unknown use Idle', () => {
  const { theme } = resolveAvatarTheme({ preference: 'open-source' });
  const expressions = { running: 'running', approval: 'waiting', input: 'waiting', idle: 'idle', error: 'idle', unknown: 'idle' };
  const initial = avatarFor({ id: 'stable-session', runtime: 'idle' }, theme);
  for (const [runtime, expression] of Object.entries(expressions)) for (const unread of [false, true]) {
    const result = avatarFor({ id: 'stable-session', runtime, unread }, theme);
    assert.equal(result.expression, expression);
    assert.equal(result.shape, initial.shape);
    assert.equal(result.color, initial.color);
  }
});

test('saved UI choice overrides the startup default and serialized changes survive restart', async t => {
  const { directory, personalDirectory } = personalFixture(t);
  const preferenceFile = path.join(directory, 'settings', 'avatar-preference.json');
  const options = { preferenceFile, personalDirectory };
  const settings = createAvatarPreferences(options);
  assert.equal(settings.state().id, 'personal');
  assert.equal(settings.state().personalAvailable, true);
  assert.ok(settings.asset('avatar/personal/face-neutral.svg'));
  assert.ok(settings.asset('avatar/open-source/pebble-idle.svg'));
  await settings.setPreference('open-source');
  const restarted = createAvatarPreferences(options);
  assert.equal(restarted.state().id, 'open-source');
  assert.equal(restarted.state().preference, 'open-source');
  await Promise.all([restarted.setPreference('open-source'), restarted.setPreference('auto')]);
  assert.equal(createAvatarPreferences({ ...options, defaultPreference: 'open-source' }).state().id, 'personal');
  assert.deepEqual(JSON.parse(readFileSync(preferenceFile)), { avatarTheme: 'auto' });
});

test('public-only installation keeps saved auto but reports no personal choice or files', async t => {
  const { directory } = personalFixture(t);
  const preferenceFile = path.join(directory, 'avatar-preference.json');
  writeFileSync(preferenceFile, '{"avatarTheme":"auto"}');
  const settings = createAvatarPreferences({ preferenceFile,
    personalDirectory: pathToFileURL(`${path.join(directory, 'absent')}${path.sep}`) });
  assert.equal(settings.state().id, 'open-source');
  assert.equal(settings.state().personalAvailable, false);
  assert.equal(settings.asset('avatar/personal/app-icon.png'), undefined);
  assert.equal(settings.asset('avatar/open-source/../../personal/manifest.json'), undefined);
  assert.equal((await settings.setPreference('open-source')).id, 'open-source');
});

test('invalid saved settings recover to default; invalid input and failed writes keep current theme', async t => {
  const { directory, personalDirectory } = personalFixture(t);
  const preferenceFile = path.join(directory, 'settings.json');
  writeFileSync(preferenceFile, '{broken');
  const diagnostics = [];
  const recovered = createAvatarPreferences({ preferenceFile, personalDirectory,
    onDiagnostic: message => diagnostics.push(message) });
  assert.equal(recovered.state().id, 'personal');
  assert.ok(diagnostics.length);
  for (const invalid of ['personal', '../outside', null, {}]) {
    await assert.rejects(recovered.setPreference(invalid));
  }
  assert.equal(readFileSync(preferenceFile, 'utf8'), '{broken');
  // Parent is a file: a deterministic write failure without changing OS permissions.
  const unwritable = createAvatarPreferences({ personalDirectory, preferenceFile: path.join(preferenceFile, 'child.json') });
  await assert.rejects(unwritable.setPreference('open-source'));
  assert.equal(unwritable.state().id, 'personal');
  assert.equal(unwritable.state().preference, 'auto');
});

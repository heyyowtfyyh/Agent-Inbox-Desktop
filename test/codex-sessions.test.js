import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createSessionReader } from '../src/providers/codex/sessions.js';

function fixture(t) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'agent-inbox-discovery-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(home)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(home).startsWith('agent-inbox-discovery-test-'));
    rmSync(home, { recursive: true, force: true });
  });
  const diagnostics = [];
  const read = createSessionReader(home, { onDiagnostic: value => diagnostics.push(value) });
  const file = path.join(home, 'state_5.sqlite');
  function database({ schema = true, source = 'vscode' } = {}) {
    const db = new DatabaseSync(file);
    try {
      db.exec('DROP TABLE IF EXISTS threads');
      db.exec(`CREATE TABLE threads (id TEXT, cwd TEXT, originator TEXT, source TEXT, archived INTEGER${schema ? ', attached_thread_parent_id TEXT' : ''})`);
      db.prepare('INSERT INTO threads (id,cwd,originator,source,archived) VALUES (?,?,?,?,0)')
        .run('00000000-0000-4000-8000-000000000001', home, 'Codex Desktop', source);
    } finally { db.close(); }
  }
  return { home, file, diagnostics, read, database };
}

test('missing discovery reports an actionable diagnostic once and recovers without touching the source', async t => {
  const f = fixture(t);
  const missing = await f.read();
  assert.equal(missing.source, 'unavailable');
  assert.equal(missing.diagnostic, 'DATABASE_NOT_FOUND');
  await f.read();
  assert.deepEqual(f.diagnostics.map(d => d.code), ['DATABASE_NOT_FOUND']);
  assert.ok(!JSON.stringify(f.diagnostics).includes(f.home));
  f.database();
  const before = readdirSync(f.home);
  const snapshot = await f.read();
  assert.equal(snapshot.source, 'ready'); assert.equal(snapshot.sessions.length, 1);
  assert.equal(snapshot.diagnostic, null);
  assert.deepEqual(readdirSync(f.home), before);
  rmSync(f.file);
  const stale = await f.read();
  assert.equal(stale.source, 'stale'); assert.equal(stale.sessions.length, 1);
  // A repeated failure remains visible even though console diagnostics are deduplicated.
  assert.equal(stale.diagnostic, 'DATABASE_NOT_FOUND');
  assert.equal(stale.runtimeAvailable, false); assert.equal(stale.unreadAvailable, false);
});

test('unsupported schemas and valid but unmatched sources have distinct diagnostics', async t => {
  const f = fixture(t);
  f.database({ schema: false });
  assert.equal((await f.read()).source, 'unavailable');
  assert.equal(f.diagnostics.at(-1).code, 'UNSUPPORTED_SCHEMA');
  f.database({ source: 'future-desktop' });
  const snapshot = await f.read();
  assert.equal(snapshot.source, 'ready'); assert.equal(snapshot.sessions.length, 0);
  assert.equal(f.diagnostics.at(-1).code, 'NO_MATCHING_SESSIONS');
  assert.ok(!JSON.stringify(f.diagnostics).includes('future-desktop'));
});

test('only explicit receipts in the desktop rollout are read, including changes in the WAL', async t => {
  const f = fixture(t);
  f.database();
  const db = new DatabaseSync(f.file);
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      ALTER TABLE threads ADD COLUMN created_at INTEGER;
      CREATE TABLE thread_read_receipts (thread_id TEXT PRIMARY KEY, first_unread_turn TEXT, revision TEXT);
    `);
    const missing = '00000000-0000-4000-8000-000000000001';
    const unread = '00000000-0000-4000-8000-000000000002';
    const read = '00000000-0000-4000-8000-000000000003';
    const old = '00000000-0000-4000-8000-000000000004';
    const invalid = '00000000-0000-4000-8000-000000000005';
    const current = Date.parse('2026-11-10T08:45:10Z') / 1000;
    db.prepare('UPDATE threads SET created_at = ? WHERE id = ?').run(current, missing);
    const insert = db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, 0, NULL, ?)');
    for (const [id, time] of [[unread, current], [read, current], [old, current - 1], [invalid, current]]) {
      insert.run(id, f.home, 'Codex Desktop', 'vscode', time);
    }
    const receipt = db.prepare('INSERT INTO thread_read_receipts VALUES (?, ?, ?)');
    receipt.run(unread, 'first-turn', 'revision');
    receipt.run(read, null, 'revision');
    receipt.run(old, 'first-turn', 'revision');
    receipt.run(invalid, 'first-turn', '');
    const snapshot = await f.read();
    assert.equal(snapshot.sessions.length, 5);
    assert.deepEqual(snapshot.savedUnread, new Map([[unread, true], [read, false]]));
    assert.ok(snapshot.sessions.every(session => session.unread === null));

    db.prepare('UPDATE thread_read_receipts SET first_unread_turn = NULL WHERE thread_id = ?').run(unread);
    assert.equal((await f.read()).savedUnread.get(unread), false);
  } finally {
    db.close();
  }
});

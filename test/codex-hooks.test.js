import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createHookMonitor, readHookStatuses, recordHookEvent } from '../src/providers/codex/hooks.js';
import { asyncQuestionId } from '../src/providers/codex/input.js';
import { createCodexProvider } from '../src/providers/codex/index.js';
import { monitoringView, viewOf } from '../src/model.js';

test('hooks reach Inbox snapshots and preserve saved unread independently', async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), 'inbox-hooks-test-'));
  const id = '00000000-0000-4000-8000-000000000001';
  let unread = false;
  const session = { id, cwd: path.toNamespacedPath(project), runtime: 'unknown', unread: null, lastActivity: 1 };
  const outside = { ...session, id: 'outside', cwd: path.dirname(project) };
  let native = false;
  const runtime = {
    track() {}, stop() {},
    status: key => native && key === id ? 'idle' : 'unknown',
    unread: key => native && key === id ? false : null,
    attentionAvailable: () => false,
    monitoring: () => native ? { status: 'connected', code: null } : { status: 'unavailable', code: 'PIPE_UNAVAILABLE' },
  };
  const provider = createCodexProvider({
    hookDirectory: project,
    platform: 'win32',
    createReader: () => async () => ({
      source: 'ready', diagnostic: null, sessions: [session, outside], savedUnread: new Map([[id, unread]]),
    }),
    createRuntime: () => runtime,
  });
  const push = (hook_event_name, extra = {}) => recordHookEvent(project, {
    cwd: project, session_id: id, turn_id: 'turn-1', hook_event_name,
    prompt: 'not stored', last_assistant_message: 'not stored', ...extra,
  });
  const snapshot = async (runtime) => {
    const result = await provider.readSnapshot();
    assert.equal(result.monitoring.status, runtime === 'unknown' ? 'limited' : 'hooks');
    assert.deepEqual(result.sessions.map(item => [item.id, item.runtime, item.unread]), [
      [id, runtime, unread], ['outside', 'unknown', null],
    ]);
    assert.equal(monitoringView(result.monitoring).label, runtime === 'unknown' ? 'Unread only' : 'Monitoring via Hooks');
    return viewOf(result, 'inbox', 'all');
  };
  try {
    assert.equal(push('UserPromptSubmit', { session_id: '../invalid' }), false);
    assert.equal(push('UserPromptSubmit', { agent_id: 'subagent' }), false);
    await snapshot('unknown');
    assert.ok(push('UserPromptSubmit'));
    assert.equal((await snapshot('running')).running, 1);
    assert.ok(push('PermissionRequest'));
    assert.equal((await snapshot('approval')).attention, 1);
    assert.ok(push('PreModelRequest'));
    await snapshot('running');

    const input = { tool_name: 'request_user_input', tool_use_id: 'choice-1' };
    assert.ok(push('PreToolUse', input));
    await snapshot('input');
    assert.ok(push('PostToolUse', { ...input, tool_use_id: 'different-choice' }));
    await snapshot('input');
    assert.ok(push('PostToolUse', input));
    await snapshot('running');
    const asyncInput = { ...input, tool_name: 'request_user_input_async', tool_input: { questions: [{}, {}] } };
    assert.ok(push('PreToolUse', asyncInput));
    await snapshot('running');
    assert.ok(push('PostToolUse', { ...asyncInput, tool_response: '{"accepted":false}' }));
    await snapshot('running');
    assert.ok(push('PostToolUse', { ...asyncInput, tool_response: '{"accepted":true}' }));
    await snapshot('input');
    assert.ok(push('PreModelRequest'));
    assert.ok(push('UserPromptSubmit', { prompt: 'An ordinary follow-up' }));
    await snapshot('input');
    const answer = (call, index) => push('UserPromptSubmit', {
      prompt: `<send_user_message_question_reply>${JSON.stringify([{
        questionItemId: asyncQuestionId(call, index), question: 'test question', answer: 'test answer',
      }])}</send_user_message_question_reply>`,
    });
    assert.ok(answer('another-call', 0));
    assert.ok(answer('choice-1', 1));
    await snapshot('input');
    assert.ok(answer('choice-1', 0));
    await snapshot('running');
    assert.ok(answer('out-of-order', 0));
    assert.ok(push('PostToolUse', { ...asyncInput, tool_use_id: 'out-of-order',
      tool_input: { questions: [{}] }, tool_response: { accepted: true },
    }));
    await snapshot('running');

    assert.ok(push('Stop'));
    assert.equal((await snapshot('idle')).unread, 0);
    assert.ok(push('PreModelRequest'));
    await snapshot('idle');
    unread = true;
    assert.equal((await snapshot('idle')).unread, 1);
    assert.ok(push('UserPromptSubmit', { turn_id: 'turn-2' }));
    assert.ok(push('Stop', { turn_id: 'turn-1' }));
    await snapshot('running');
    assert.equal(readHookStatuses(project, Date.now() + 301_000).has(id), false);
    native = true;
    const recovered = await provider.readSnapshot();
    assert.equal(recovered.monitoring.status, 'connected');
    assert.equal(recovered.sessions[0].runtime, 'idle');
    assert.equal(recovered.sessions[0].unread, false);
    native = false;
    assert.ok(push('Interrupt', { turn_id: 'turn-2' }));
    await snapshot('idle');
    assert.ok(push('SessionEnd', { turn_id: undefined }));
    await snapshot('unknown');
    assert.ok(push('UserPromptSubmit', { session_id: 'undiscovered' }));
    await snapshot('unknown');
    assert.equal(await provider.hasSession(outside.id), true);
    assert.equal(await provider.hasSession('undiscovered'), false);
    const db = new DatabaseSync(path.join(project, 'hook-events.sqlite'), { readOnly: true });
    try {
      const rows = db.prepare('SELECT * FROM hook_events').all();
      assert.ok(rows.length > 0);
      assert.doesNotMatch(JSON.stringify(rows), /not stored|test question|test answer/);
      assert.deepEqual(Object.keys(rows[0]), ['seq', 'session_id', 'turn_id', 'event', 'tool_call', 'observed_ms']);
    } finally {
      db.close();
    }
  } finally {
    provider.stop();
    assert.equal(path.dirname(project), os.tmpdir());
    assert.match(path.basename(project), /^inbox-hooks-test-/);
    rmSync(project, { recursive: true, force: true });
  }
});

test('hook monitor starts watching after its journal directory appears', { timeout: 5_000 }, async t => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'inbox-hooks-watch-'));
  const directory = path.join(home, 'new journal');
  let notify;
  const notification = new Promise(resolve => { notify = resolve; });
  const monitor = createHookMonitor(directory, notify);
  t.after(() => {
    monitor.stop();
    rmSync(directory, { force: true, recursive: true });
    rmSync(home, { force: true, recursive: true });
  });
  assert.equal(monitor.read().size, 0);
  mkdirSync(directory);
  assert.equal(monitor.read().size, 0);
  recordHookEvent(directory, { session_id: 'session-1', turn_id: 'turn-1', hook_event_name: 'UserPromptSubmit' });
  const timer = setTimeout(() => notify(false), 3_000);
  try {
    assert.notEqual(await notification, false);
    assert.equal(monitor.read().get('session-1'), 'running');
  } finally {
    clearTimeout(timer);
  }
});

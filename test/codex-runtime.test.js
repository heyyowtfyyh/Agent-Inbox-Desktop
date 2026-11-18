import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { test } from 'node:test';
import { createCodexRuntime } from '../src/providers/codex/runtime.js';
import { viewOf } from '../src/model.js';

const id = '00000000-0000-4000-8000-000000000001';

async function fixture(t, options = {}) {
  const { streamVersion = 11, ...runtimeOptions } = options;
  const socket = new EventEmitter();
  socket.writable = true;
  let follows = 0;
  const deliver = message => {
    const payload = Buffer.from(JSON.stringify(message));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length);
    // Exercise the production frame parser across a split header.
    socket.emit('data', header.subarray(0, 2));
    socket.emit('data', Buffer.concat([header.subarray(2), payload]));
  };
  socket.write = frame => {
    const message = JSON.parse(frame.subarray(4));
    if (message.method === 'initialize') queueMicrotask(() => deliver({
      type: 'response', requestId: message.requestId, resultType: 'success', result: { clientId: 'test-observer' },
    }));
    if (message.method === 'thread-stream-following-changed') {
      if (message.params.following) follows++;
      socket.emit('following', message.params.following);
    }
  };
  socket.destroy = socket.end = () => {
    if (!socket.writable) return;
    socket.writable = false;
    socket.emit('close');
  };
  let changes = 0;
  const runtime = createCodexRuntime({ onChange: () => changes++, connect: () => socket, retryMs: 60_000, ...runtimeOptions });
  t.after(() => runtime.stop());
  const following = once(socket, 'following');
  runtime.track([id]);
  socket.emit('connect');
  await following;
  let revision = 0;
  const send = change => deliver({
    type: 'broadcast', method: 'thread-stream-state-changed', version: streamVersion,
    sourceClientId: 'test-owner', params: { hostId: 'local', conversationId: id, change },
  });
  return {
    runtime, socket, deliver, send, changes: () => changes, follows: () => follows,
    readState(unread) {
      deliver({ type: 'broadcast', method: 'thread-read-state-changed', version: 3,
        sourceClientId: 'test-owner', params: { hostId: 'local', conversationId: id, hasUnreadTurn: unread } });
    },
    unreadPatch(unread) {
      send({ type: 'patches', baseRevision: revision, revision: ++revision,
        patches: [{ op: 'replace', path: ['hasUnreadTurn'], value: unread }] });
    },
    snapshot(type, unread = false, extra = {}) {
      send({ type: 'snapshot', revision: ++revision, conversationState: {
        threadRuntimeStatus: { type, activeFlags: [] }, hasUnreadTurn: unread, requests: [], turns: [], ...extra,
      } });
    },
    patch(type, whole = false) {
      send({ type: 'patches', baseRevision: revision, revision: ++revision, patches: [{
        op: 'replace', path: whole ? ['threadRuntimeStatus'] : ['threadRuntimeStatus', 'type'],
        value: whole ? { type, activeFlags: [] } : type,
      }] });
    },
  };
}

for (const streamVersion of [11, 13]) test(`v${streamVersion} snapshots and patches preserve runtime, input, approval and unread semantics`, async t => {
  const diagnostics = [];
  const f = await fixture(t, { streamVersion, onDiagnostic: value => diagnostics.push(value) });
  const questionId = JSON.stringify(['request_user_input_async', 'question', 0]);
  f.snapshot('active', true, { turnHistory: { kind: 'canonical', history: {
    entitiesByKey: { turn: { turnId: 'turn', status: 'inProgress', items: [
      { type: 'agentMessage', id: 'question', questions: [{}] },
    ] } }, islands: [{ entries: [{ value: 'turn' }] }],
  } } });
  assert.equal(f.runtime.status(id), 'input');
  assert.equal(f.runtime.attentionAvailable(id), true);
  assert.equal(f.runtime.unread(id), true);
  f.send({ type: 'patches', baseRevision: 1, revision: 2, acceptedTextChanges: [], patches: [
    { op: 'add', path: ['requests', 0], value: { method: 'item/commandExecution/requestApproval' } },
  ] });
  assert.equal(f.runtime.status(id), 'approval');
  f.send({ type: 'patches', baseRevision: 2, revision: 3, patches: [
    { op: 'remove', path: ['requests', 0] },
  ] });
  assert.equal(f.runtime.status(id), 'input');
  f.send({ type: 'patches', baseRevision: 3, revision: 4, patches: [
    { op: 'add', path: ['turnHistory', 'history', 'entitiesByKey', 'turn', 'items', 1], value: {
      type: 'steeringUserMessage', status: 'accepted', input: [{ type: 'text',
        text: `<send_user_message_question_reply>${JSON.stringify({ questionItemId: questionId, question: 'Example?', answer: 'Yes' })}</send_user_message_question_reply>` }],
    } },
  ] });
  assert.equal(f.runtime.status(id), 'running');
  assert.equal(f.runtime.unread(id), true);
  f.send({ type: 'patches', baseRevision: 4, revision: 5, patches: [
    { op: 'replace', path: ['threadRuntimeStatus'], value: { type: 'idle' } },
    { op: 'replace', path: ['hasUnreadTurn'], value: false },
  ] });
  assert.equal(f.runtime.status(id), 'idle');
  assert.equal(f.runtime.unread(id), false);
  assert.equal(model(f.runtime).visible.length, 0);
  f.readState(true);
  assert.equal(f.runtime.unread(id), true);
  f.readState(false);
  assert.equal(f.runtime.unread(id), false);
  f.send({ type: 'patches', baseRevision: 5, revision: 6, patches: [
    { op: 'replace', path: ['threadRuntimeStatus', 'type'], value: 'systemError' },
  ] });
  assert.equal(f.runtime.status(id), 'error');
  assert.deepEqual(diagnostics, []);
  f.socket.destroy();
  assert.equal(f.runtime.status(id), 'unknown');
  assert.equal(f.runtime.unread(id), null);
});

test('v13 patches require a matching base revision and recover through a new snapshot', async t => {
  const f = await fixture(t, { streamVersion: 13 });
  f.snapshot('active', true);
  f.send({ type: 'patches', baseRevision: 0, revision: 2, patches: [
    { op: 'replace', path: ['threadRuntimeStatus'], value: { type: 'idle' } },
  ] });
  assert.equal(f.runtime.status(id), 'unknown');
  assert.equal(f.runtime.unread(id), null);
  assert.equal(f.follows(), 2);
  f.snapshot('idle', false);
  assert.equal(f.runtime.status(id), 'idle');
  assert.equal(f.runtime.unread(id), false);
});

test('v13 does not infer Running or unread from missing or unfamiliar fields', async t => {
  const f = await fixture(t, { streamVersion: 13 });
  for (const threadRuntimeStatus of [null, { type: 'future-status' }, { type: 'active' }, { type: 'active', activeFlags: ['future-flag'] }]) {
    f.snapshot('active', false, { threadRuntimeStatus, hasUnreadTurn: undefined });
    assert.equal(f.runtime.status(id), 'unknown');
    assert.equal(f.runtime.unread(id), null);
  }
  f.snapshot('active', false);
  assert.equal(f.runtime.status(id), 'running');
});

test('an unverified version clears v13 evidence and a verified snapshot recovers it', async t => {
  const diagnostics = [];
  const f = await fixture(t, { streamVersion: 13, onDiagnostic: value => diagnostics.push(value) });
  f.snapshot('active', true);
  f.deliver({ type: 'broadcast', method: 'thread-stream-state-changed', version: 14,
    sourceClientId: 'test-owner', params: { hostId: 'local', conversationId: id,
      change: { type: 'snapshot', revision: 2, conversationState: {
        threadRuntimeStatus: { type: 'idle' }, hasUnreadTurn: false,
      } } } });
  assert.equal(f.runtime.status(id), 'unknown');
  assert.equal(f.runtime.unread(id), null);
  assert.deepEqual(diagnostics.map(d => d.code), ['STREAM_VERSION_UNSUPPORTED']);
  f.snapshot('idle', false);
  assert.equal(f.runtime.status(id), 'idle');
  assert.equal(f.runtime.unread(id), false);
});

test('unsupported protocol versions report safely, preserve conservative states and allow recovery', async t => {
  const diagnostics = [];
  const f = await fixture(t, { onDiagnostic: value => diagnostics.push(value) });
  f.snapshot('active', false);
  const message = { type: 'broadcast', method: 'thread-stream-state-changed', version: 12,
    sourceClientId: 'private-owner', params: { hostId: 'local', conversationId: id } };
  f.deliver(message); f.deliver(message);
  assert.equal(f.runtime.status(id), 'unknown'); assert.equal(f.runtime.unread(id), null);
  assert.deepEqual(diagnostics.map(d => d.code), ['STREAM_VERSION_UNSUPPORTED']);
  f.snapshot('idle', false);
  assert.equal(f.runtime.status(id), 'idle');
  f.deliver({ type: 'broadcast', method: 'thread-read-state-changed', version: 4,
    sourceClientId: 'test-owner', params: { hostId: 'local', conversationId: id, hasUnreadTurn: true } });
  assert.equal(f.runtime.unread(id), false);
  assert.equal(diagnostics.at(-1).code, 'READ_VERSION_UNSUPPORTED');
  assert.ok(!JSON.stringify(diagnostics).includes(id));
  assert.ok(!JSON.stringify(diagnostics).includes('private-owner'));
});

test('pipe permission failures are diagnosed and clear native evidence', async t => {
  const diagnostics = [];
  const f = await fixture(t, { onDiagnostic: value => diagnostics.push(value) });
  f.snapshot('active', true);
  f.socket.emit('error', Object.assign(new Error('private path'), { code: 'EACCES' }));
  assert.equal(f.runtime.status(id), 'unknown'); assert.equal(f.runtime.unread(id), null);
  assert.deepEqual(diagnostics.map(d => d.code), ['PIPE_ACCESS_DENIED']);
  assert.ok(!JSON.stringify(diagnostics).includes('private path'));
});

for (const connected of [false, true]) test(`a ${connected ? 'handshake' : 'pipe connect'} timeout retries even when destroy never emits close`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const sockets = [];
  const diagnostics = [];
  const runtime = createCodexRuntime({ onChange: () => {}, onDiagnostic: d => diagnostics.push(d.code), retryMs: 2_000,
    connect: () => {
      const socket = new EventEmitter();
      socket.connecting = true;
      socket.writable = true;
      socket.sent = [];
      socket.write = data => socket.sent.push(JSON.parse(data.subarray(4)));
      socket.destroy = socket.end = () => { socket.writable = false; };
      socket.deliver = message => {
        const payload = Buffer.from(JSON.stringify(message));
        const header = Buffer.alloc(4); header.writeUInt32LE(payload.length);
        socket.emit('data', Buffer.concat([header, payload]));
      };
      sockets.push(socket);
      return socket;
    } });
  t.after(() => runtime.stop());
  runtime.track([id]);
  const first = sockets[0];
  if (connected) { first.connecting = false; first.emit('connect'); }
  t.mock.timers.tick(5_000);
  assert.equal(first.writable, false);
  assert.deepEqual(diagnostics, [connected ? 'HANDSHAKE_TIMEOUT' : 'PIPE_CONNECT_TIMEOUT']);
  t.mock.timers.tick(2_000);
  assert.equal(sockets.length, 2);
  const second = sockets[1];
  second.connecting = false; second.emit('connect');
  const request = second.sent.find(m => m.method === 'initialize');
  second.deliver({ type: 'response', requestId: request.requestId, resultType: 'success', result: { clientId: 'new-observer' } });
  second.deliver({ type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner',
    params: { hostId: 'local', conversationId: id, change: { type: 'snapshot', revision: 1,
      conversationState: { threadRuntimeStatus: { type: 'idle', activeFlags: [] }, hasUnreadTurn: true, requests: [], turns: [] } } } });
  assert.equal(runtime.status(id), 'idle'); assert.equal(runtime.unread(id), true);
  // Late completion/close from the timed-out socket must not initialize or clear its replacement.
  first.emit('connect'); first.emit('close'); first.emit('error', Object.assign(new Error('late'), { code: 'EPIPE' }));
  assert.equal(second.sent.filter(m => m.method === 'initialize').length, 1);
  assert.equal(runtime.status(id), 'idle'); assert.equal(runtime.unread(id), true);
  t.mock.timers.tick(5_000);
  assert.equal(sockets.length, 2);
  runtime.stop(); t.mock.timers.tick(30_000);
  assert.equal(sockets.length, 2);
});

function model(runtime, filter = 'all') {
  return viewOf({
    runtimeAvailable: true, unreadAvailable: true,
    sessions: [{ id, lastActivity: 1, runtime: runtime.status(id), unread: runtime.unread(id) }],
  }, 'inbox', filter);
}

test('a systemError snapshot notifies the UI and enters Inbox and the Error filter', async t => {
  const f = await fixture(t);
  f.snapshot('systemError', true);
  assert.equal(f.runtime.status(id), 'error');
  assert.equal(f.changes(), 1);
  assert.equal(model(f.runtime).visible.length, 1);
  assert.equal(model(f.runtime, 'error').visible.length, 1);
  assert.equal(model(f.runtime).unread, 1);
});

for (const whole of [false, true]) test(`error and recovery through ${whole ? 'whole-status' : 'type-field'} patches`, async t => {
  const f = await fixture(t);
  f.snapshot('active');
  f.patch('systemError', whole);
  assert.equal(f.runtime.status(id), 'error');
  assert.equal(model(f.runtime, 'error').visible.length, 1);
  f.patch('active', whole);
  assert.equal(f.runtime.status(id), 'running');
  assert.equal(model(f.runtime, 'error').visible.length, 0);
  f.patch('systemError', whole);
  f.patch('idle', whole);
  assert.equal(f.runtime.status(id), 'idle');
  assert.equal(model(f.runtime).visible.length, 0);
  assert.equal(f.changes(), 5);
});

test('disconnect clears an error and native unread evidence to Unknown', async t => {
  const f = await fixture(t);
  f.snapshot('systemError', true);
  f.socket.destroy();
  assert.equal(f.runtime.status(id), 'unknown');
  assert.equal(f.runtime.unread(id), null);
  assert.equal(f.changes(), 2);
});

test('missing state, notLoaded and unknown types remain Unknown', async t => {
  const f = await fixture(t);
  assert.equal(f.runtime.status(id), 'unknown');
  for (const type of ['notLoaded', 'future-status']) {
    f.snapshot(type);
    assert.equal(f.runtime.status(id), 'unknown');
  }
});

test('a failed command item alone does not turn an active session into Error', async t => {
  const f = await fixture(t);
  f.snapshot('active', false, { turns: [{ turnId: 'test-turn', status: 'inProgress', items: [
    { type: 'commandExecution', status: 'completed', exitCode: 1 },
  ] }] });
  assert.equal(f.runtime.status(id), 'running');
});

test('reading an active session requests a snapshot and recovers a missed Idle update', async t => {
  const f = await fixture(t);
  f.snapshot('active', true);
  f.readState(false);
  assert.equal(f.follows(), 2);
  assert.equal(f.runtime.status(id), 'running');
  assert.equal(model(f.runtime).running, 1);
  f.snapshot('idle', false);
  assert.equal(f.runtime.status(id), 'idle');
  assert.equal(model(f.runtime).running, 0);
  assert.equal(model(f.runtime).visible.length, 0);
});

test('an unread patch rechecks active runtime but does not infer completion from unread', async t => {
  const f = await fixture(t);
  f.snapshot('active');
  f.unreadPatch(true);
  assert.equal(f.follows(), 2);
  assert.equal(f.runtime.status(id), 'running');
  f.snapshot('idle', true);
  assert.equal(model(f.runtime).running, 0);
  assert.equal(model(f.runtime).unread, 1);
  assert.equal(model(f.runtime).visible.length, 1);
});

test('active sessions are periodically resynchronized even without read events', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = await fixture(t);
  f.snapshot('active');
  t.mock.timers.tick(10_000);
  assert.equal(f.follows(), 2);
  f.snapshot('idle', true);
  t.mock.timers.tick(10_000);
  assert.equal(f.follows(), 2);
  assert.equal(model(f.runtime).running, 0);
});

test('a connected observer retries when every initial snapshot was missed', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = await fixture(t);
  assert.equal(f.follows(), 1);
  assert.equal(f.runtime.status(id), 'unknown');
  assert.equal(f.runtime.unread(id), null);
  // The pipe remains open, so reconnect logic cannot recover the lost initial reply.
  t.mock.timers.tick(10_000);
  assert.equal(f.follows(), 2);
  t.mock.timers.tick(10_000);
  assert.equal(f.follows(), 3);
  f.snapshot('idle', true);
  assert.equal(f.runtime.status(id), 'idle');
  assert.equal(f.runtime.unread(id), true);
  t.mock.timers.tick(10_000);
  assert.equal(f.follows(), 3);
});

test('an explicit notLoaded snapshot does not trigger all-missing retries', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = await fixture(t);
  f.snapshot('notLoaded');
  t.mock.timers.tick(30_000);
  assert.equal(f.follows(), 1);
  assert.equal(f.runtime.status(id), 'unknown');
  assert.equal(f.runtime.unread(id), false);
});

test('a fresh active snapshot preserves legitimate Running plus Unread', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = await fixture(t);
  f.snapshot('active', true);
  t.mock.timers.tick(10_000);
  t.mock.timers.tick(4_000);
  f.snapshot('active', true);
  t.mock.timers.tick(2_000);
  assert.equal(f.runtime.status(id), 'running');
  assert.equal(model(f.runtime).running, 1);
  assert.equal(model(f.runtime).unread, 1);
});

test('an unanswered resync expires cached Running to Unknown and retries for recovery', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = await fixture(t);
  f.snapshot('active', true);
  t.mock.timers.tick(10_000);
  t.mock.timers.tick(5_000);
  assert.equal(f.runtime.status(id), 'unknown');
  assert.equal(f.runtime.unread(id), null);
  assert.equal(model(f.runtime).running, 0);
  t.mock.timers.tick(5_000);
  assert.equal(f.follows(), 3);
  f.snapshot('idle', true);
  assert.equal(f.runtime.status(id), 'idle');
  assert.equal(model(f.runtime).unread, 1);
});

test('untracking and stopping cancel pending snapshot requests and future resyncs', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = await fixture(t);
  f.snapshot('active');
  f.readState(true);
  f.runtime.track([]);
  const notifications = f.changes();
  const follows = f.follows();
  t.mock.timers.tick(30_000);
  assert.equal(f.changes(), notifications);
  assert.equal(f.follows(), follows);
  f.runtime.stop();
  t.mock.timers.tick(30_000);
  assert.equal(f.follows(), follows);
});

test('monitoring waits for native evidence and individual Unknown/Error sessions are not source errors', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.runtime.monitoring(), {status:'connecting',code:null});
  for (const type of ['notLoaded','systemError','idle']) {
    f.snapshot(type);
    assert.deepEqual(f.runtime.monitoring(), {status:'connected',code:null});
  }
  f.runtime.track([]);
  assert.deepEqual(f.runtime.monitoring(), {status:'idle',code:null});
});

test('incompatible streams stay visible until that session receives a supported snapshot', async t => {
  let notifications = 0;
  const f = await fixture(t, {onMonitoringChange:()=>notifications++});
  const otherId = '00000000-0000-4000-8000-000000000002';
  f.runtime.track([id,otherId]);
  f.snapshot('idle');
  const unsupported = {type:'broadcast',method:'thread-stream-state-changed',version:99,
    sourceClientId:'private-owner',params:{hostId:'local',conversationId:otherId}};
  f.deliver(unsupported);
  assert.deepEqual(f.runtime.monitoring(), {status:'unavailable',code:'STREAM_VERSION_UNSUPPORTED'});
  const previous = notifications;
  f.snapshot('active');
  assert.equal(notifications,previous);
  assert.equal(f.runtime.monitoring().status,'unavailable');
  f.deliver({...unsupported,version:13,params:{...unsupported.params,change:{type:'snapshot',revision:1,
    conversationState:{threadRuntimeStatus:{type:'notLoaded'},hasUnreadTurn:false}}}});
  assert.deepEqual(f.runtime.monitoring(), {status:'connected',code:null});
  f.deliver(unsupported);
  assert.equal(f.runtime.monitoring().status,'unavailable');
  f.runtime.track([id]);
  assert.deepEqual(f.runtime.monitoring(), {status:'connected',code:null});
  assert.ok(!JSON.stringify(f.runtime.monitoring()).includes('private-owner'));
});

test('unread protocol failures recover through verified unread evidence', async t => {
  const f = await fixture(t);
  f.snapshot('idle');
  f.deliver({type:'broadcast',method:'thread-read-state-changed',version:99,
    sourceClientId:'test-owner',params:{hostId:'local',conversationId:id,hasUnreadTurn:true}});
  assert.deepEqual(f.runtime.monitoring(),{status:'unavailable',code:'READ_VERSION_UNSUPPORTED'});
  f.readState(false);
  assert.deepEqual(f.runtime.monitoring(),{status:'connected',code:null});
});

test('silent initial state and expired snapshots show recovery status without inferring runtime', async t => {
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const f = await fixture(t);
  t.mock.timers.tick(10_000);
  assert.deepEqual(f.runtime.monitoring(),{status:'reconnecting',code:'SNAPSHOT_UNAVAILABLE'});
  f.snapshot('active');
  assert.deepEqual(f.runtime.monitoring(),{status:'connected',code:null});
  t.mock.timers.tick(10_000);
  t.mock.timers.tick(5_000);
  assert.deepEqual(f.runtime.monitoring(),{status:'reconnecting',code:'SNAPSHOT_UNAVAILABLE'});
  assert.equal(f.runtime.status(id),'unknown');
  f.snapshot('idle');
  assert.deepEqual(f.runtime.monitoring(),{status:'connected',code:null});
});

test('permission errors publish monitoring changes even with no session state', async t => {
  let changes = 0;
  const f = await fixture(t,{onMonitoringChange:()=>changes++});
  const before = changes;
  f.socket.emit('error',Object.assign(new Error('private path'),{code:'EACCES'}));
  assert.deepEqual(f.runtime.monitoring(),{status:'unavailable',code:'PIPE_ACCESS_DENIED'});
  assert.ok(changes > before);
  assert.equal(f.runtime.unread(id),null);
});

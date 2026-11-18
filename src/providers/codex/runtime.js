import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { hasPendingInput, patchInputHistory, projectInputHistory } from './input.js';
import { defaultCodexPipe } from '../../config.js';
import { createDiagnosticReporter } from './diagnostics.js';

const threadIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
// v13 preserves the runtime, unread, requests and input-history fields read here.
// Keep an explicit allowlist: an unfamiliar version must not imply valid state.
const streamVersions = new Set([11, 13]);
const maxFrameSize = 64 * 1024 * 1024;
const commandApprovalMethod = 'item/commandExecution/requestApproval';

function readFrames(socket, onFrame) {
  let frame = Buffer.alloc(4);
  let offset = 0;
  let readingLength = true;

  socket.on('data', chunk => {
    for (let cursor = 0; cursor < chunk.length;) {
      const count = Math.min(frame.length - offset, chunk.length - cursor);
      chunk.copy(frame, offset, cursor, cursor + count);
      cursor += count;
      offset += count;
      if (offset < frame.length) continue;

      if (readingLength) {
        const size = frame.readUInt32LE();
        if (!size || size > maxFrameSize) return socket.destroy();
        frame = Buffer.allocUnsafe(size);
      } else {
        let message;
        try {
          message = JSON.parse(frame);
        } catch {
          return socket.destroy();
        }
        onFrame(message);
        frame = Buffer.alloc(4);
      }
      offset = 0;
      readingLength = !readingLength;
    }
  });
}

function projectRuntime(value) {
  if (!['active', 'idle', 'notLoaded', 'systemError'].includes(value?.type)) return null;
  const flags = value.activeFlags;
  return {
    type: value.type,
    activeFlags: Array.isArray(flags) && flags.length <= 16 && flags.every(flag => typeof flag === 'string')
      ? [...flags] : null,
  };
}

function patchRuntime(runtime, patch) {
  const { path, op, value } = patch;
  if (!['add', 'replace', 'remove'].includes(op)) return null;
  if (path.length === 1) return op === 'remove' ? null : projectRuntime(value);
  if (!runtime) return null;
  if (path.length === 2) {
    if (path[1] === 'type') return projectRuntime({ ...runtime, type: op === 'remove' ? null : value });
    if (path[1] === 'activeFlags') return projectRuntime({ ...runtime, activeFlags: op === 'remove' ? null : value });
  }
  const index = path[2];
  if (path.length !== 3 || path[1] !== 'activeFlags' || !runtime.activeFlags || !Number.isInteger(index)
    || index < 0 || index > runtime.activeFlags.length
    || (op !== 'add' && index === runtime.activeFlags.length)) return null;
  const flags = [...runtime.activeFlags];
  if (op === 'remove') flags.splice(index, 1);
  else flags.splice(index, op === 'replace' ? 1 : 0, value);
  return projectRuntime({ ...runtime, activeFlags: flags });
}

function projectApprovalRequests(value) {
  // Preserve request positions for patches without keeping request IDs or parameters.
  return Array.isArray(value) ? value.map(request => request?.method === commandApprovalMethod) : null;
}

function patchApprovalRequests(requests, { path, op, value }) {
  if (!['add', 'replace', 'remove'].includes(op)) return null;
  if (path.length === 1) return op === 'remove' ? null : projectApprovalRequests(value);
  const methodOnly = path.length === 3 && path[2] === 'method';
  if (path.length !== 2 && !methodOnly) return requests;
  const index = path[1];
  if (!requests || !Number.isSafeInteger(index) || index < 0 || index > requests.length
    || (index === requests.length && (op !== 'add' || methodOnly))) return null;
  const next = [...requests];
  if (methodOnly) next[index] = op !== 'remove' && value === commandApprovalMethod;
  else if (op === 'remove') next.splice(index, 1);
  else next.splice(index, op === 'replace' ? 1 : 0, value?.method === commandApprovalMethod);
  return next;
}

function visibleStatus(state) {
  const runtime = state?.runtime;
  if (runtime?.type === 'systemError') return 'error';
  if (runtime?.type === 'idle') return 'idle';
  if (runtime?.type !== 'active') return 'unknown';
  if (state.approvalRequests?.includes(true)) return 'approval';
  if (state.inputPending === true) return 'input';
  if (runtime.activeFlags?.length === 0) return 'running';
  return 'unknown';
}

function attentionAvailable(state) {
  return ['active', 'idle'].includes(state?.runtime?.type)
    && (state.inputPending != null || state.approvalRequests != null);
}

function projectUnread(value) {
  return typeof value === 'boolean' ? value : null;
}

export function createCodexRuntime({ onChange, onDiagnostic, onMonitoringChange = () => {}, pipe = defaultCodexPipe, connect = () => createConnection(pipe),
  retryMs = 2_000, resyncMs = 10_000, snapshotTimeoutMs = 5_000 }) {
  let wanted = new Set();
  const states = new Map();
  const pendingSnapshots = new Map();
  const staleSessions = new Set();
  let socket;
  let clientId;
  let retry;
  let resync;
  let stopped = false;
  let connectionDiagnostic = null;
  let receivedSnapshot = false;
  let waitingForState = false;
  const streamIssues = new Set();
  const readIssues = new Set();
  let monitoringSignature;
  const report = createDiagnosticReporter(onDiagnostic);

  function monitoring() {
    if (stopped || wanted.size === 0) return { status: 'idle', code: null };
    if (streamIssues.size) return { status: 'unavailable', code: 'STREAM_VERSION_UNSUPPORTED' };
    if (readIssues.size) return { status: 'unavailable', code: 'READ_VERSION_UNSUPPORTED' };
    if (connectionDiagnostic) return {
      status: ['PIPE_ACCESS_DENIED', 'HANDSHAKE_REJECTED'].includes(connectionDiagnostic) ? 'unavailable' : 'reconnecting',
      code: connectionDiagnostic,
    };
    if (waitingForState || staleSessions.size > 0 && states.size === 0) {
      return { status: 'reconnecting', code: 'SNAPSHOT_UNAVAILABLE' };
    }
    return { status: clientId && receivedSnapshot ? 'connected' : 'connecting', code: null };
  }

  function notifyMonitoring() {
    const signature = JSON.stringify(monitoring());
    if (signature === monitoringSignature) return;
    monitoringSignature = signature;
    onMonitoringChange();
  }

  function send(message) {
    if (!socket?.writable) return;
    const payload = Buffer.from(JSON.stringify(message));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length);
    socket.write(Buffer.concat([header, payload]));
  }

  function follow(id, following) {
    if (!clientId) return;
    send({
      type: 'broadcast', method: 'thread-stream-following-changed', version: 1, sourceClientId: clientId,
      params: { conversationId: id, hostId: 'local', following },
    });
  }

  function clearSnapshotRequest(id) {
    clearTimeout(pendingSnapshots.get(id));
    pendingSnapshots.delete(id);
    staleSessions.delete(id);
  }

  function requestSnapshot(id) {
    if (!clientId || pendingSnapshots.has(id)) return;
    pendingSnapshots.set(id, setTimeout(() => {
      pendingSnapshots.delete(id);
      staleSessions.add(id);
      setState(id, null);
    }, snapshotTimeoutMs));
    // Repeating following=true asks the owner for a complete current snapshot.
    follow(id, true);
  }

  function clearResync() {
    clearInterval(resync);
    resync = undefined;
    for (const id of pendingSnapshots.keys()) clearSnapshotRequest(id);
    staleSessions.clear();
  }

  function setState(id, next) {
    if (next && next.runtime?.type !== 'active') clearSnapshotRequest(id);
    const previous = states.get(id);
    if (next) states.set(id, next);
    else states.delete(id);
    if (visibleStatus(previous) !== visibleStatus(next)
      || attentionAvailable(previous) !== attentionAvailable(next)
      || (previous?.unread ?? null) !== (next?.unread ?? null)) onChange();
    notifyMonitoring();
  }

  function receive(message) {
    if (message?.type !== 'broadcast') return;
    const { method, params, sourceClientId: owner } = message;
    if (method === 'client-status-changed' && params?.status === 'disconnected') {
      for (const [id, state] of states) if (state.owner === params.clientId) {
        clearSnapshotRequest(id);
        setState(id, null);
      }
      return;
    }
    const id = params?.conversationId;
    if (params?.hostId !== 'local' || !wanted.has(id)) return;
    if (method === 'thread-stream-following-status-requested' && message.version === 1) {
      follow(id, true);
      return;
    }
    if (method === 'thread-read-state-changed') {
      if (message.version !== 3) {
        readIssues.add(id);
        report('READ_VERSION_UNSUPPORTED');
        notifyMonitoring();
        return;
      }
      const state = states.get(id);
      if (!state || typeof params.hasUnreadTurn !== 'boolean') return;
      if (state.owner === owner) {
        readIssues.delete(id);
        setState(id, { ...state, unread: params.hasUnreadTurn });
        if (state.runtime?.type === 'active') requestSnapshot(id);
      } else requestSnapshot(id);
      return;
    }
    if (method !== 'thread-stream-state-changed') return;
    if (!streamVersions.has(message.version)) {
      streamIssues.add(id);
      report('STREAM_VERSION_UNSUPPORTED');
      setState(id, null);
      return;
    }
    if (typeof owner !== 'string' || !owner) return;
    const change = params.change;
    const previous = states.get(id);
    if (!Number.isSafeInteger(change?.revision) || change.revision < 0
      || !['snapshot', 'patches'].includes(change.type)) {
      if (previous?.owner === owner) setState(id, null);
      return;
    }
    if (change.type === 'snapshot') {
      if (previous?.owner === owner && change.revision < previous.revision) return;
      clearSnapshotRequest(id);
      streamIssues.delete(id);
      if (typeof change.conversationState?.hasUnreadTurn === 'boolean') readIssues.delete(id);
      if (projectRuntime(change.conversationState?.threadRuntimeStatus)
        || typeof change.conversationState?.hasUnreadTurn === 'boolean') {
        receivedSnapshot = true;
        waitingForState = false;
      }
      const inputHistory = projectInputHistory(change.conversationState);
      setState(id, {
        owner,
        revision: change.revision,
        runtime: projectRuntime(change.conversationState?.threadRuntimeStatus),
        unread: projectUnread(change.conversationState?.hasUnreadTurn),
        approvalRequests: projectApprovalRequests(change.conversationState?.requests),
        inputHistory,
        inputPending: hasPendingInput(inputHistory),
      });
      return;
    }
    if (!previous || previous.owner !== owner || change.revision <= previous.revision) return;
    if (change.baseRevision !== previous.revision || !Array.isArray(change.patches)) {
      setState(id, null);
      follow(id, true);
      return;
    }
    let { runtime, unread, approvalRequests, inputHistory, inputPending } = previous;
    let inputChanged = false;
    let needsSnapshot = false;
    for (const patch of change.patches) {
      if (!Array.isArray(patch?.path)) continue;
      if (patch.path[0] === 'threadRuntimeStatus') runtime = patchRuntime(runtime, patch);
      if (patch.path[0] === 'hasUnreadTurn' && patch.path.length === 1) {
        unread = projectUnread(patch.op === 'add' || patch.op === 'replace' ? patch.value : null);
      }
      if (patch.path[0] === 'requests') {
        const next = patchApprovalRequests(approvalRequests, patch);
        if (approvalRequests !== null && next === null && !(patch.path.length === 1 && patch.op === 'remove')) {
          needsSnapshot = true;
        }
        approvalRequests = next;
      }
      const applied = inputHistory ? patchInputHistory(inputHistory, patch) : null;
      if (applied === false) {
        inputHistory = null;
        needsSnapshot = true;
      }
      if (applied !== null) inputChanged = true;
    }
    if (inputChanged) inputPending = hasPendingInput(inputHistory);
    setState(id, { owner, revision: change.revision, runtime, unread, approvalRequests, inputHistory, inputPending });
    if (needsSnapshot || runtime?.type === 'active' && unread !== previous.unread) requestSnapshot(id);
  }

  function ensureConnection() {
    if (stopped || socket || retry || wanted.size === 0) return;
    const requestId = randomUUID();
    const connection = socket = connect();
    let connected = false;
    let connectionIssue = false;
    const problem = code => {
      connectionIssue = true;
      connectionDiagnostic = code;
      report(code);
      notifyMonitoring();
    };
    const release = () => {
      if (socket !== connection) return;
      clearTimeout(handshake);
      clearResync();
      socket = undefined;
      clientId = undefined;
      receivedSnapshot = false;
      waitingForState = false;
      streamIssues.clear();
      readIssues.clear();
      for (const id of states.keys()) setState(id, null);
      notifyMonitoring();
      if (stopped || wanted.size === 0) return;
      retry = setTimeout(() => {
        retry = undefined;
        ensureConnection();
      }, retryMs);
    };
    const handshake = setTimeout(() => {
      problem(connected ? 'HANDSHAKE_TIMEOUT' : 'PIPE_CONNECT_TIMEOUT');
      connection.destroy();
      // A Windows pipe connect can remain pending without emitting close after
      // destroy. Release our reference now instead of waiting forever to retry.
      release();
    }, 5_000);
    connection.once('connect', () => {
      if (stopped || socket !== connection) { connection.destroy(); return; }
      connected = true;
      send({
        type: 'request', method: 'initialize', version: 1, requestId,
        sourceClientId: 'initializing-client', params: { clientType: 'agent-inbox-observer' },
      });
    });
    readFrames(connection, message => {
      if (stopped || socket !== connection) return;
      if (clientId) {
        receive(message);
      } else if (message?.type === 'response' && message.requestId === requestId) {
        const id = message.result?.clientId;
        if (message.resultType !== 'success' || typeof id !== 'string' || !id) {
          problem('HANDSHAKE_REJECTED');
          return connection.destroy();
        }
        clearTimeout(handshake);
        clientId = id;
        connectionDiagnostic = null;
        notifyMonitoring();
        for (const threadId of wanted) follow(threadId, true);
        resync = setInterval(() => {
          // An open pipe does not guarantee that owners answered the initial
          // subscription. Retry while no snapshot has arrived at all, without
          // repeatedly polling unloaded sessions after any owner has answered.
          if (!receivedSnapshot || states.size === 0) {
            waitingForState = true;
            notifyMonitoring();
            for (const id of wanted) follow(id, true);
            return;
          }
          const ids = new Set(staleSessions);
          for (const [id, state] of states) if (state.runtime?.type === 'active') ids.add(id);
          for (const id of ids) requestSnapshot(id);
        }, resyncMs).unref();
      }
    });
    connection.on('error', error => {
      if (stopped || socket !== connection) { connection.destroy(); return; }
      problem(['EACCES', 'EPERM'].includes(error.code) ? 'PIPE_ACCESS_DENIED' : 'PIPE_UNAVAILABLE');
      connection.destroy();
    });
    connection.once('close', () => {
      clearTimeout(handshake);
      if (socket !== connection) return;
      if (!stopped && !connectionIssue) problem('PIPE_DISCONNECTED');
      release();
    });
  }

  return {
    track(ids) {
      if (stopped) return;
      const next = new Set(ids.filter(id => typeof id === 'string' && threadIdPattern.test(id)));
      for (const id of wanted) {
        if (next.has(id)) continue;
        follow(id, false);
        clearSnapshotRequest(id);
        setState(id, null);
        streamIssues.delete(id);
        readIssues.delete(id);
      }
      for (const id of next) if (!wanted.has(id)) follow(id, true);
      wanted = next;
      ensureConnection();
      notifyMonitoring();
    },
    monitoring,
    status(id) {
      return visibleStatus(states.get(id));
    },
    attentionAvailable(id) {
      return attentionAvailable(states.get(id));
    },
    unread(id) {
      return states.get(id)?.unread ?? null;
    },
    stop() {
      stopped = true;
      clearTimeout(retry);
      clearResync();
      for (const id of wanted) follow(id, false);
      states.clear();
      if (socket?.connecting) socket.destroy();
      else socket?.end();
    },
  };
}

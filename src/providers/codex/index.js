import { createSessionReader, sampleSnapshot } from './sessions.js';
import { createCodexRuntime } from './runtime.js';
import { createHookMonitor, defaultHookDirectory } from './hooks.js';

// Source-specific discovery, state projection and lifecycle live behind this boundary.
// Keep raw session IDs unchanged: pins, avatar identity and existing navigation use them.
export function createCodexProvider({ codexHome, pipe, deepLinksEnabled = true,
  sample = false, onChange = () => {}, onDiagnostic = () => {}, platform = process.platform,
  createReader = createSessionReader, createRuntime = createCodexRuntime, hookDirectory } = {}) {
  const demo = sample ? { ...sampleSnapshot(), monitoring: { status: 'sample', code: null } } : null;
  const readSessions = demo ? async () => demo : createReader(codexHome, { onDiagnostic });
  const runtime = sample || platform !== 'win32' ? null
    : createRuntime({ pipe, onChange, onMonitoringChange: onChange, onDiagnostic });
  const hooks = runtime ? createHookMonitor(hookDirectory ?? defaultHookDirectory(), onChange) : null;
  let stopped = false;

  return {
    id: 'codex',
    async readSnapshot() {
      if (demo) return demo;
      const { savedUnread, ...snapshot } = await readSessions();
      if (!runtime) return { ...snapshot, monitoring: { status: 'unavailable', code: 'PLATFORM_UNSUPPORTED' } };
      runtime.track(snapshot.source === 'ready' ? snapshot.sessions.map(session => session.id) : []);
      if (snapshot.source !== 'ready') return { ...snapshot, monitoring: {
        status: snapshot.diagnostic === 'DATABASE_BUSY' ? 'reconnecting' : 'unavailable',
        code: snapshot.diagnostic ?? 'SOURCE_UNAVAILABLE',
      } };
      const hookStatuses = hooks.read();
      let hasHookRuntime = false;
      let hasSavedUnread = false;
      const sessions = snapshot.sessions.map(session => {
        const status = runtime.status(session.id);
        const hookStatus = status === 'unknown' ? hookStatuses.get(session.id) : undefined;
        const unread = runtime.unread(session.id);
        const saved = unread === null ? savedUnread?.get(session.id) : undefined;
        hasHookRuntime ||= hookStatus !== undefined;
        hasSavedUnread ||= saved !== undefined;
        return { ...session, runtime: hookStatus ?? status, unread: unread ?? saved ?? null };
      });
      let monitoring = snapshot.sessions.length ? runtime.monitoring() : { status: 'idle', code: null };
      if (monitoring.status !== 'connected') {
        if (hasHookRuntime) monitoring = { status: 'hooks', code: null };
        else if (hasSavedUnread && monitoring.code === 'PIPE_UNAVAILABLE') {
          monitoring = { status: 'limited', code: 'PIPE_UNAVAILABLE' };
        }
      }
      return {
        ...snapshot, sessions,
        monitoring,
        runtimeAvailable: sessions.some(session => session.runtime !== 'unknown'),
        attentionAvailable: sessions.some(session => session.runtime === 'approval' || session.runtime === 'input'
          || runtime.attentionAvailable(session.id)),
        unreadAvailable: sessions.some(session => session.unread !== null),
      };
    },
    async hasSession(sessionId) {
      // Pin membership uses discovery metadata, as before, without starting stream tracking.
      return (await readSessions()).sessions.some(session => session.id === sessionId);
    },
    conversationTarget(snapshot, sessionId) {
      if (sample || snapshot.source !== 'ready' || !deepLinksEnabled
        || typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(sessionId)
        || !snapshot.sessions.some(session => session.id === sessionId)) return null;
      return `codex://threads/${sessionId}`;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      hooks?.stop();
      runtime?.stop();
    },
  };
}

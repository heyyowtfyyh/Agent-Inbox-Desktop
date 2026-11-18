import { createSessionReader, sampleSnapshot } from './sessions.js';
import { createCodexRuntime } from './runtime.js';

// Source-specific discovery, state projection and lifecycle live behind this boundary.
// Keep raw session IDs unchanged: pins, avatar identity and existing navigation use them.
export function createCodexProvider({ codexHome, pipe, deepLinksEnabled = true,
  sample = false, onChange = () => {}, onDiagnostic = () => {}, platform = process.platform,
  createReader = createSessionReader, createRuntime = createCodexRuntime } = {}) {
  const demo = sample ? { ...sampleSnapshot(), monitoring: { status: 'sample', code: null } } : null;
  const readSessions = demo ? async () => demo : createReader(codexHome, { onDiagnostic });
  const runtime = sample || platform !== 'win32' ? null
    : createRuntime({ pipe, onChange, onMonitoringChange: onChange, onDiagnostic });
  let stopped = false;

  return {
    id: 'codex',
    async readSnapshot() {
      const snapshot = await readSessions();
      if (demo) return snapshot;
      if (!runtime) return { ...snapshot, monitoring: { status: 'unavailable', code: 'PLATFORM_UNSUPPORTED' } };
      runtime.track(snapshot.source === 'ready' ? snapshot.sessions.map(session => session.id) : []);
      if (snapshot.source !== 'ready') return { ...snapshot, monitoring: {
        status: snapshot.diagnostic === 'DATABASE_BUSY' ? 'reconnecting' : 'unavailable',
        code: snapshot.diagnostic ?? 'SOURCE_UNAVAILABLE',
      } };
      const sessions = snapshot.sessions.map(session => ({
        ...session, runtime: runtime.status(session.id), unread: runtime.unread(session.id),
      }));
      return {
        ...snapshot, sessions,
        monitoring: snapshot.sessions.length ? runtime.monitoring() : { status: 'idle', code: null },
        runtimeAvailable: sessions.some(session => session.runtime !== 'unknown'),
        attentionAvailable: sessions.some(session => runtime.attentionAvailable(session.id)),
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
      runtime?.stop();
    },
  };
}

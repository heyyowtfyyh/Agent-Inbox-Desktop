const messages = {
  DATABASE_NOT_FOUND: 'state_5.sqlite was not found. Check AGENT_INBOX_CODEX_HOME in .env and open Codex Desktop. Other database versions require provider compatibility work.',
  DATABASE_ACCESS_DENIED: 'Cannot read the Codex database or write its temporary snapshot. Check folder permissions and the temporary directory.',
  UNSUPPORTED_SCHEMA: 'The Codex database schema is unsupported. Report the Codex version; changing a path will not fix a schema mismatch.',
  DATABASE_BUSY: 'The Codex database kept changing while being copied. Agent Inbox will retry automatically.',
  DATABASE_UNREADABLE: 'The Codex database snapshot could not be read. Check the data directory, temporary directory and Codex version.',
  NO_MATCHING_SESSIONS: 'No supported local Codex Desktop sessions matched. Open a local conversation; if it is still missing, report the Codex version.',
  PIPE_ACCESS_DENIED: 'Access to the Codex monitoring pipe was denied. Run both apps as the same Windows user and check sandbox or permission restrictions.',
  PIPE_UNAVAILABLE: 'The Codex monitoring pipe could not be reached. Open Codex Desktop and check AGENT_INBOX_CODEX_PIPE in .env.',
  PIPE_CONNECT_TIMEOUT: 'The Codex monitoring pipe did not accept a connection in time. Agent Inbox will retry automatically; check Codex Desktop and its local IPC router if this persists.',
  PIPE_DISCONNECTED: 'The Codex monitoring pipe disconnected. Native state is unavailable until reconnection.',
  HANDSHAKE_TIMEOUT: 'The Codex monitoring handshake timed out. Check Codex Desktop and the configured pipe.',
  HANDSHAKE_REJECTED: 'Codex rejected the monitoring handshake. Check the configured pipe and report the Codex version.',
  STREAM_VERSION_UNSUPPORTED: 'The Codex state stream version is unsupported (expected 11 or 13). Report the Codex version; states remain Unknown without compatible evidence.',
  READ_VERSION_UNSUPPORTED: 'The Codex unread event version is unsupported (expected 3). Report the Codex version; unread events with this version are ignored.',
};

// Never forward raw exceptions, paths, session IDs or conversation content.
// Emit each condition once per instance so polling and reconnects do not flood logs.
export function createDiagnosticReporter(onDiagnostic = () => {}) {
  const reported = new Set();
  return code => {
    if (!messages[code] || reported.has(code)) return;
    reported.add(code);
    onDiagnostic({ code, message: messages[code] });
  };
}

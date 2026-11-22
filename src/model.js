const inboxStates = new Set(['running', 'approval', 'input', 'error']);

export const statusLabels = {
  running: 'Running', approval: 'Waiting for approval', input: 'Waiting for user input',
  idle: 'Idle', error: 'Error', unknown: 'Unknown',
};

const monitoringDetails = {
  STREAM_VERSION_UNSUPPORTED: 'This Codex version is not supported. Ask your coding agent to update Agent Inbox.',
  READ_VERSION_UNSUPPORTED: 'Codex unread updates are not supported by this version of Agent Inbox. Ask your coding agent to check compatibility.',
  PIPE_ACCESS_DENIED: 'Access to Codex monitoring was denied. Run both apps as the same Windows user and check permission or sandbox restrictions.',
  PIPE_UNAVAILABLE: 'Cannot connect to Codex. Check that Codex Desktop is open. Agent Inbox will retry automatically.',
  PIPE_CONNECT_TIMEOUT: 'Codex did not accept the monitoring connection in time. Retrying automatically.',
  PIPE_DISCONNECTED: 'The connection to Codex was lost. Retrying automatically.',
  HANDSHAKE_TIMEOUT: 'Codex did not finish setting up monitoring in time. Retrying automatically.',
  HANDSHAKE_REJECTED: 'Codex rejected the monitoring connection. Ask your coding agent to check compatibility.',
  SNAPSHOT_UNAVAILABLE: 'Connected to Codex, but no current session state is available. Open a local conversation. Retrying automatically.',
  DATABASE_NOT_FOUND: 'Local Codex session data was not found. Open Codex Desktop or ask your coding agent to check the data location.',
  DATABASE_ACCESS_DENIED: 'Local Codex session data could not be read. Ask your coding agent to check folder permissions.',
  UNSUPPORTED_SCHEMA: 'The Codex session data format is not supported. Ask your coding agent to update Agent Inbox.',
  DATABASE_BUSY: 'Codex session data is being updated. Retrying automatically.',
  DATABASE_UNREADABLE: 'Local Codex session data could not be read. Ask your coding agent to check the data source.',
  PLATFORM_UNSUPPORTED: 'Live Codex monitoring is currently supported on Windows only.',
  SOURCE_UNAVAILABLE: 'The session source is unavailable. Agent Inbox will try again automatically.',
};

export function monitoringView(monitoring) {
  const labels = {
    connected: 'Monitoring', connecting: 'Connecting…', reconnecting: 'Reconnecting…',
    hooks: 'Monitoring via Hooks', limited: 'Unread only',
    unavailable: 'Monitoring unavailable', idle: 'No local sessions', sample: 'Sample data',
  };
  const status = Object.hasOwn(labels, monitoring?.status) ? monitoring.status : 'connecting';
  if (status === 'limited') return {
    status, label: labels[status],
    detail: 'Showing saved unread status where available. To restore live status, see Codex Hooks setup in the README.',
  };
  const detail = ['reconnecting', 'unavailable'].includes(status)
    ? (Object.hasOwn(monitoringDetails, monitoring?.code) ? monitoringDetails[monitoring.code]
      : 'Monitoring is unavailable. Agent Inbox will try again automatically.') : '';
  return { status, label: labels[status], detail };
}

export function viewOf(snapshot, view, filter) {
  const all = [...snapshot.sessions].sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0) || a.id.localeCompare(b.id));
  const eligible = all.filter(session => session.pinned === true || inboxStates.has(session.runtime) || session.unread === true);
  const recent = view === 'inbox' && eligible.length === 0 && all.length > 0
    && !snapshot.runtimeAvailable && !snapshot.unreadAvailable;
  const candidates = view === 'all' ? all : recent ? all.filter(session => session.lastActivity !== null).slice(0, 3) : eligible;
  const visible = filter === 'all' || recent ? candidates : candidates.filter(session => {
    if (filter === 'unread') return session.unread === true;
    if (filter === 'attention') return session.runtime === 'approval' || session.runtime === 'input';
    return session.runtime === filter;
  });
  return {
    recent, visible,
    running: snapshot.runtimeAvailable ? all.filter(s => s.runtime === 'running').length : null,
    attention: snapshot.sample || snapshot.attentionAvailable
      ? all.filter(s => s.runtime === 'approval' || s.runtime === 'input').length : null,
    unread: snapshot.unreadAvailable ? all.filter(s => s.unread === true).length : null,
  };
}

export function groupByProject(sessions, projectOrder = new Map()) {
  // Reuse the order across snapshots, retaining temporarily absent projects.
  const projects = new Map();
  for (const session of sessions) {
    if (!projectOrder.has(session.projectId)) projectOrder.set(session.projectId, projectOrder.size);
    if (!projects.has(session.projectId)) projects.set(session.projectId, { name: session.project, sessions: [] });
    projects.get(session.projectId).sessions.push(session);
  }
  return new Map([...projects].sort(([a], [b]) => projectOrder.get(a) - projectOrder.get(b)));
}

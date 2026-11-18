import { setTimeout } from 'node:timers/promises';
import { readConfig } from '../src/config.js';
import { createCodexProvider } from '../src/providers/codex/index.js';

if (process.platform !== 'win32') throw new Error('Live monitoring requires Windows.');
const config = readConfig();
let changes = 0;
const provider = createCodexProvider({ codexHome: config.codexHome, pipe: config.codexPipe, onChange: () => changes++,
  onDiagnostic: ({ code, message }) => console.error(`[codex:${code}] ${message}`) });
try {
  const initial = await provider.readSnapshot();
  if (initial.source !== 'ready') throw new Error('The local Codex session database is unavailable or incompatible.');
  if (!initial.sessions.length) throw new Error('No local desktop sessions are available to verify monitoring.');
  // Stay connected briefly to collect native state, including any live changes.
  await setTimeout(8_000);
  const snapshot = await provider.readSnapshot();
  if (snapshot.source !== 'ready') throw new Error('The local Codex session source became unavailable.');
  const statuses = {};
  let nativeUnread = 0;
  for (const session of snapshot.sessions) {
    const status = session.runtime;
    statuses[status] = (statuses[status] ?? 0) + 1;
    if (session.unread !== null) nativeUnread++;
  }
  console.log(JSON.stringify({ sessions: snapshot.sessions.length, statuses, nativeUnread, changes }, null, 2));
  if (!nativeUnread && snapshot.sessions.every(session => session.runtime === 'unknown')) {
    throw new Error('No verifiable native state received. Check Codex Desktop and the configured pipe.');
  }
} finally {
  provider.stop();
}

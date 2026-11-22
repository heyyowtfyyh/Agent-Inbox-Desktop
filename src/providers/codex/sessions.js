import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createDiagnosticReporter } from './diagnostics.js';

const requiredColumns = ['id', 'cwd', 'originator', 'source', 'archived', 'attached_thread_parent_id'];
const unavailable = { runtimeAvailable: false, unreadAvailable: false, sample: false, diagnostic: null };
// Codex Desktop 26.1117 uses durable receipts for chats created from this rollout onward.
const readReceiptCutoffSeconds = Date.parse('2026-11-10T08:45:10Z') / 1000;

async function readOptional(file, reader) {
  try {
    return await reader(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function sameBytes(first, second) {
  return first === null ? second === null : second !== null && first.equals(second);
}

function savedUnreadProjection(database, threadColumns) {
  if (!threadColumns.has('created_at')) return 'NULL';
  const columns = new Map(database.prepare('PRAGMA table_info(thread_read_receipts)').all()
    .map(row => [row.name, row.pk]));
  if (columns.get('thread_id') !== 1 || [...columns.values()].some(position => position > 1)
    || !columns.has('first_unread_turn') || !columns.has('revision')) return 'NULL';
  return `(
    SELECT CASE
      WHEN first_unread_turn IS NULL THEN 0
      WHEN typeof(first_unread_turn) = 'text' AND length(first_unread_turn) > 0 THEN 1
    END
    FROM thread_read_receipts
    WHERE thread_id = threads.id AND typeof(revision) = 'text' AND length(revision) > 0
      AND typeof(threads.created_at) = 'integer' AND threads.created_at >= ${readReceiptCutoffSeconds}
  )`;
}

function readThreads(database) {
  const columns = new Set(database.prepare('PRAGMA table_info(threads)').all().map(row => row.name));
  if (requiredColumns.some(column => !columns.has(column))) {
    throw Object.assign(new Error('Unsupported session schema'), { code: 'UNSUPPORTED_SCHEMA' });
  }

  const names = ['name', 'title'].filter(column => columns.has(column)).map(column => `NULLIF(${column}, '')`);
  const times = ['updated_at_ms', 'updated_at * 1000', 'recency_at_ms']
    .filter(expression => columns.has(expression.split(' ')[0]));
  const title = names.length ? `COALESCE(${[...names, "'Untitled session'"].join(', ')})` : "'Untitled session'";
  const time = times.length ? `COALESCE(${[...times, 'NULL'].join(', ')})` : 'NULL';
  const savedUnread = new Map();
  const rows = database.prepare(`
    SELECT id, cwd, ${title} AS title, ${time} AS lastActivity,
      ${savedUnreadProjection(database, columns)} AS savedUnread
    FROM threads
    WHERE originator = 'Codex Desktop' AND source = 'vscode'
      AND archived = 0 AND attached_thread_parent_id IS NULL
    ORDER BY lastActivity DESC, id
  `).all();

  const sessions = rows.filter(row => typeof row.id === 'string' && row.id.length > 0).map(row => {
    if (row.savedUnread === 0 || row.savedUnread === 1) savedUnread.set(row.id, row.savedUnread === 1);
    const cwd = typeof row.cwd === 'string' && row.cwd.trim() ? row.cwd : null;
    const normalized = cwd ? path.win32.normalize(cwd) : null;
    return {
      id: row.id,
      title: String(row.title),
      cwd,
      projectId: normalized ? normalized.toLowerCase() : null,
      project: normalized ? path.win32.basename(normalized) || normalized : 'Unassigned',
      lastActivity: Number.isFinite(row.lastActivity) && row.lastActivity > 0 && row.lastActivity <= 8.64e15
        ? row.lastActivity : null,
      runtime: 'unknown',
      unread: null,
    };
  });
  return { sessions, savedUnread };
}

export function createSessionReader(codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), { onDiagnostic } = {}) {
  const report = createDiagnosticReporter(onDiagnostic);
  const source = path.join(codexHome, 'state_5.sqlite');
  const wal = `${source}-wal`;
  let cache = { ...unavailable, source: 'unavailable', sessions: [] };
  let revision;
  let pending;

  async function read() {
    try {
      const [dbStat, walStat] = await Promise.all([
        stat(source, { bigint: true }), readOptional(wal, file => stat(file, { bigint: true })),
      ]);
      const fingerprint = [dbStat, walStat].map(entry => entry && `${entry.ino}:${entry.size}:${entry.mtimeNs}`).join('|');
      if (cache.source === 'ready' && fingerprint === revision) return cache;

      // SQLite may write a shared-memory sidecar when opening a WAL database.
      // Open a private snapshot so the original Codex directory is only read.
      const files = () => Promise.all([readFile(source), readOptional(wal, readFile)]);
      let snapshot;
      for (let attempt = 0; attempt < 3 && !snapshot; attempt++) {
        const first = await files();
        const second = await files();
        if (first.every((bytes, index) => sameBytes(bytes, second[index]))) snapshot = second;
      }
      if (!snapshot) throw Object.assign(new Error('Session database is changing'), { code: 'DATABASE_BUSY' });

      const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-inbox-'));
      try {
        const copy = path.join(directory, 'sessions.sqlite');
        await writeFile(copy, snapshot[0]);
        if (snapshot[1]) await writeFile(`${copy}-wal`, snapshot[1]);
        const database = new DatabaseSync(copy, { readOnly: true });
        try {
          database.exec('PRAGMA query_only = ON');
          cache = { ...unavailable, source: 'ready', ...readThreads(database) };
          if (!cache.sessions.length) report('NO_MATCHING_SESSIONS');
          revision = fingerprint;
        } finally {
          database.close();
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    } catch (error) {
      const diagnostic = error.code === 'ENOENT' && error.path === source ? 'DATABASE_NOT_FOUND'
        : ['EACCES', 'EPERM'].includes(error.code) ? 'DATABASE_ACCESS_DENIED'
        : ['UNSUPPORTED_SCHEMA', 'DATABASE_BUSY'].includes(error.code) ? error.code : 'DATABASE_UNREADABLE';
      report(diagnostic);
      cache = { ...unavailable, diagnostic, source: cache.sessions.length ? 'stale' : 'unavailable', sessions: cache.sessions };
    }
    return cache;
  }

  return () => (pending ??= read().finally(() => { pending = undefined; }));
}

export function sampleSnapshot() {
  const now = Date.now();
  const data = [
    ['Session discovery', 'running', 0],
    ['Codex deep links', 'approval', 2],
    ['Windows launch', 'idle', 18, true],
    ['Installer logs', 'error', 31],
    ['Workspace sync', 'input', 42],
    ['Review formatting', 'idle', 1440],
    ['Previous investigation', 'unknown', 4320],
  ];
  return {
    source: 'ready', runtimeAvailable: true, unreadAvailable: true, sample: true,
    sessions: data.map(([title, runtime, minutes, unread = false], index) => ({
      id: `sample-${index + 1}`, title, runtime, unread, cwd: null,
      project: 'agent-inbox', projectId: 'sample-project', lastActivity: now - minutes * 60_000,
    })),
  };
}

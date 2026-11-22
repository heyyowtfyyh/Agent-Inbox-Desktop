import { mkdirSync, watch } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { asyncQuestionId, replyIds } from './input.js';

const eventFile = 'hook-events.sqlite';
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const activeStatusLifetimeMs = 5 * 60_000;
const retentionMs = 7 * 24 * 60 * 60_000;
const ordinaryEvents = new Set([
  'SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'PreModelRequest', 'Stop', 'Interrupt', 'SessionEnd',
]);
const mappedEvents = new Set([...ordinaryEvents, 'InputRequested', 'InputReturned', 'AsyncInputCalled', 'AsyncInputReturned',
  'AsyncInputAccepted', 'AsyncInputAnswered']);

function validId(value) {
  return typeof value === 'string' && idPattern.test(value);
}

function normalizedQuestionId(value) {
  if (typeof value !== 'string' || value.length > 256) return null;
  try {
    const id = JSON.parse(value);
    if (!Array.isArray(id) || id.length !== 3) return null;
    const [tool, call, index] = id;
    return tool === 'request_user_input_async' && validId(call) && Number.isSafeInteger(index) && index >= 0
      ? asyncQuestionId(call, index) : null;
  } catch {
    return null;
  }
}

function asyncInputAccepted(response) {
  if (response?.accepted === true) return true;
  const content = Array.isArray(response) ? response : response?.content;
  const text = typeof response === 'string' ? response
    : content?.length === 1 && content[0]?.type === 'text' ? content[0].text : null;
  if (typeof text !== 'string' || text.length > 256) return false;
  try {
    return JSON.parse(text)?.accepted === true;
  } catch {
    return false;
  }
}

export function defaultHookDirectory() {
  const localData = process.env.LOCALAPPDATA;
  return path.join(localData && path.isAbsolute(localData) ? localData : path.join(os.homedir(), 'AppData', 'Local'),
    'Agent Inbox', 'codex-hooks');
}

export function recordHookEvent(directory, input) {
  if (!input || input.agent_id != null || !validId(input.session_id)) return false;
  const name = input.hook_event_name;
  let event = name;
  let toolCall = null;
  if (name === 'PreToolUse' || name === 'PostToolUse') {
    const tool = input.tool_name;
    if (!['request_user_input', 'request_user_input_async'].includes(tool) || !validId(input.tool_use_id)) return false;
    event = tool === 'request_user_input'
      ? (name === 'PreToolUse' ? 'InputRequested' : 'InputReturned')
      : (name === 'PreToolUse' ? 'AsyncInputCalled' : 'AsyncInputReturned');
    toolCall = input.tool_use_id;
  } else if (!ordinaryEvents.has(name)) return false;
  const turn = input.turn_id;
  if (!validId(turn) && name !== 'SessionStart' && name !== 'SessionEnd') return false;
  const events = [[event, toolCall]];
  if (event === 'AsyncInputReturned' && asyncInputAccepted(input.tool_response)) {
    const questions = input.tool_input?.questions;
    if (Array.isArray(questions) && questions.length <= 128) {
      for (let index = 0; index < questions.length; index++) {
        events.push(['AsyncInputAccepted', asyncQuestionId(toolCall, index)]);
      }
    }
  }
  if (event === 'UserPromptSubmit') {
    for (const value of replyIds(input.prompt)) {
      const id = normalizedQuestionId(value);
      if (id) events.push(['AsyncInputAnswered', id]);
    }
  }

  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, eventFile), { timeout: 300 });
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS hook_events (
      seq INTEGER PRIMARY KEY, session_id TEXT NOT NULL, turn_id TEXT, event TEXT NOT NULL,
      tool_call TEXT, observed_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS hook_events_observed_ms ON hook_events (observed_ms)`);
    const now = Date.now();
    db.prepare(`INSERT INTO hook_events (session_id, turn_id, event, tool_call, observed_ms)
      SELECT ?, ?, json_extract(value, '$[0]'), json_extract(value, '$[1]'), ? FROM json_each(?) ORDER BY key`)
      .run(input.session_id, validId(turn) ? turn : null, now, JSON.stringify(events));
    db.prepare('DELETE FROM hook_events WHERE observed_ms < ?').run(now - retentionMs);
  } finally {
    db.close();
  }
  return true;
}

export function createHookMonitor(directory, onChange) {
  let pending;
  let watcher;
  let stopped = false;
  return {
    read() {
      if (stopped) return new Map();
      if (!watcher) {
        try {
          const current = watch(directory, { persistent: false }, (_, name) => {
            if (name != null && name !== eventFile && name !== `${eventFile}-journal`) return;
            clearTimeout(pending);
            pending = setTimeout(onChange, 80).unref();
          });
          watcher = current;
          current.on('error', () => current.close());
          current.on('close', () => { if (watcher === current) watcher = undefined; });
        } catch {
          // The recorder creates the directory on the first event. Retry on the next refresh.
        }
      }
      return readHookStatuses(directory);
    },
    stop() {
      stopped = true;
      clearTimeout(pending);
      watcher?.close();
    },
  };
}

export function readHookStatuses(directory, now = Date.now()) {
  let db;
  let rows;
  try {
    db = new DatabaseSync(path.join(directory, eventFile), { readOnly: true, timeout: 100 });
    rows = db.prepare(`SELECT session_id, turn_id, event, tool_call, observed_ms FROM hook_events
      WHERE observed_ms >= ? ORDER BY seq`).all(now - retentionMs);
  } catch {
    return new Map();
  } finally {
    db?.close();
  }
  const states = new Map();
  const seenTurns = new Set();
  for (const { session_id: id, turn_id: turn, event, tool_call: call, observed_ms: time } of rows) {
    if (!validId(id) || !mappedEvents.has(event) || !Number.isSafeInteger(time) || time > now) continue;
    const state = states.get(id);
    if (event === 'SessionStart' || event === 'SessionEnd') {
      if (event === 'SessionEnd') states.delete(id);
      continue;
    }
    if (!validId(turn)) continue;
    if (event === 'UserPromptSubmit') {
      const key = `${id}:${turn}`;
      if (seenTurns.has(key)) continue;
      seenTurns.add(key);
      states.set(id, { turn, status: 'running', time, pendingInput: new Set(), pendingApproval: false,
        pendingAsync: new Set(), answeredAsync: new Set() });
      continue;
    }
    if (!state || state.turn !== turn || state.status === 'idle') continue;
    if (event === 'Stop' || event === 'Interrupt') {
      state.status = 'idle';
    } else {
      if (event === 'PermissionRequest') state.pendingApproval = true;
      if (event === 'PreModelRequest') state.pendingApproval = false;
      if (event === 'InputRequested' && validId(call)) state.pendingInput.add(call);
      if (event === 'InputReturned') state.pendingInput.delete(call);
      if (event === 'AsyncInputCalled' || event === 'AsyncInputReturned') continue;
      if (event === 'AsyncInputAccepted' && normalizedQuestionId(call) && !state.answeredAsync.has(call)) {
        state.pendingAsync.add(call);
      }
      if (event === 'AsyncInputAnswered' && normalizedQuestionId(call)) {
        state.answeredAsync.add(call);
        state.pendingAsync.delete(call);
      }
      const waitingForInput = state.pendingInput.size > 0 || state.pendingAsync.size > 0;
      state.status = state.pendingApproval ? 'approval' : waitingForInput ? 'input' : 'running';
    }
    state.time = time;
  }
  const statuses = new Map();
  for (const [id, { status, time }] of states) {
    if (status === 'idle' || now - time <= activeStatusLifetimeMs) statuses.set(id, status);
  }
  return statuses;
}

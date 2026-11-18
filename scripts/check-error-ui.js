import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

if (process.platform !== 'win32') throw new Error('The Error UI check requires Windows.');
const root = mkdtempSync(path.join(os.tmpdir(), 'agent-inbox-error-ui-'));
const profile = path.join(root, 'profile');
mkdirSync(profile);
const output = fileURLToPath(new URL('../.local/monitoring-qa/', import.meta.url));
mkdirSync(output, { recursive: true });
const database = new DatabaseSync(path.join(root, 'state_5.sqlite'));
database.exec(`CREATE TABLE threads (
  id TEXT, title TEXT, cwd TEXT, updated_at_ms INTEGER, originator TEXT, source TEXT,
  archived INTEGER, attached_thread_parent_id TEXT
);`);
database.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, 0, NULL)').run(
  '00000000-0000-4000-8000-000000000001', 'Simulated system error', root, Date.now(), 'Codex Desktop', 'vscode',
);
database.close();
const env = {
  ...process.env, AGENT_INBOX_CODEX_HOME: root,
  AGENT_INBOX_CODEX_PIPE: String.raw`\\.\pipe\agent-inbox-error-ui-${randomUUID()}`,
  AGENT_INBOX_VERIFIED_CODEX_LINKS: '0', AGENT_INBOX_TEST_PROFILE: profile,
  AGENT_INBOX_MONITORING_QA_OUTPUT: output,
};
delete env.ELECTRON_RUN_AS_NODE;
try {
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(electron, [fileURLToPath(new URL('./fixtures/error-ui.mjs', import.meta.url))], {
      env, stdio: 'inherit', windowsHide: true,
    });
    const timeout = setTimeout(() => child.kill(), 100_000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); resolve(code ?? 1); });
  });
} finally {
  const resolved = path.resolve(root);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('agent-inbox-error-ui-')) {
    throw new Error('Unexpected test directory.');
  }
  rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

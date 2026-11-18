import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

if(process.platform!=='win32') throw new Error('The native taskbar check requires Windows.');
const root=mkdtempSync(path.join(os.tmpdir(),'agent-inbox-taskbar-'));
const profile=path.join(root,'profile');mkdirSync(profile);
const output=fileURLToPath(new URL('../.local/taskbar-qa/',import.meta.url));mkdirSync(output,{recursive:true});
const database=new DatabaseSync(path.join(root,'state_5.sqlite'));
database.exec(`CREATE TABLE threads (
  id TEXT, title TEXT, cwd TEXT, updated_at_ms INTEGER, originator TEXT, source TEXT,
  archived INTEGER, attached_thread_parent_id TEXT
);`);
const insert=database.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, 0, NULL)');
for(let i=1;i<=100;i++) insert.run(`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,
  `Taskbar check ${i}`,root,Date.now(),'Codex Desktop','vscode');
database.close();
const env={...process.env,AGENT_INBOX_CODEX_HOME:root,
  AGENT_INBOX_CODEX_PIPE:String.raw`\\.\pipe\agent-inbox-taskbar-${randomUUID()}`,
  AGENT_INBOX_VERIFIED_CODEX_LINKS:'0',AVATAR_THEME:'open-source',
  AGENT_INBOX_TEST_PROFILE:profile,AGENT_INBOX_BADGE_QA_OUTPUT:output};
delete env.ELECTRON_RUN_AS_NODE;
try {
  const code=await new Promise((resolve,reject)=>{
    const child=spawn(electron,[fileURLToPath(new URL('./fixtures/taskbar.mjs',import.meta.url))],{
      env,stdio:'inherit',windowsHide:true,
    });
    const timer=setTimeout(()=>child.kill(),25_000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);resolve(code??1);});
  });
  assert.equal(code,0,'Native taskbar check failed.');
} finally {
  const resolved=path.resolve(root);
  if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('agent-inbox-taskbar-')){
    throw new Error('Unexpected test directory.');
  }
  rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}

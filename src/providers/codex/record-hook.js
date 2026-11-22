import { defaultHookDirectory, recordHookEvent } from './hooks.js';

try {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw new Error('Hook input is too large.');
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks).toString('utf8');
  recordHookEvent(defaultHookDirectory(), JSON.parse(input));
} catch {
  console.error('Agent Inbox could not record a Codex hook event.');
}
// Keep feedback and permission decisions with Codex.
console.log('{}');

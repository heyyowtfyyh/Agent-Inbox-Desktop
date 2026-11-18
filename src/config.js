import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';

export const defaultCodexPipe = String.raw`\\.\pipe\codex-ipc`;

function pathValue(value, name) {
  if (!value?.trim()) return undefined;
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${name} contains control characters. Use single quotes around Windows paths in .env, for example 'C:\\new\\Codex # local'.`);
  }
  return value.trim();
}

// Resolve beside the project, independently of the shell's working directory.
export function readConfig({ env = process.env, envFile = new URL('../.env', import.meta.url) } = {}) {
  let local = {};
  try {
    local = parseEnv(readFileSync(envFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const rawValue = name => env[name]?.trim() ? env[name] : local[name];
  const value = name => rawValue(name)?.trim() || undefined;
  const codexHome = pathValue(rawValue('AGENT_INBOX_CODEX_HOME'), 'AGENT_INBOX_CODEX_HOME')
    || pathValue(env.CODEX_HOME, 'CODEX_HOME') || path.join(os.homedir(), '.codex');
  const vsCodePath = pathValue(rawValue('AGENT_INBOX_VSCODE_PATH'), 'AGENT_INBOX_VSCODE_PATH');
  const codexPipe = value('AGENT_INBOX_CODEX_PIPE') || defaultCodexPipe;
  const deepLinks = value('AGENT_INBOX_VERIFIED_CODEX_LINKS') || '1';
  const avatarTheme = value('AVATAR_THEME') || 'auto';

  for (const [name, directory] of [['AGENT_INBOX_CODEX_HOME / CODEX_HOME', codexHome], ['AGENT_INBOX_VSCODE_PATH', vsCodePath]]) {
    if (directory && !path.isAbsolute(directory)) throw new Error(`${name} must be an absolute path.`);
  }
  if (!/^\\\\\.\\pipe\\[^\\/]+$/.test(codexPipe)) {
    throw new Error('AGENT_INBOX_CODEX_PIPE must name a local Windows pipe.');
  }
  if (!['0', '1'].includes(deepLinks)) throw new Error('AGENT_INBOX_VERIFIED_CODEX_LINKS must be 0 or 1.');
  if (!['auto', 'open-source'].includes(avatarTheme)) throw new Error('AVATAR_THEME must be auto or open-source.');

  // Read only recognized settings; never inject .env entries into process.env.
  return { codexHome, vsCodePath, codexPipe, codexDeepLinksEnabled: deepLinks !== '0', avatarTheme };
}

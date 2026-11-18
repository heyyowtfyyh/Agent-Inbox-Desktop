import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const project = fileURLToPath(new URL('../', import.meta.url));

export function launchElectron(args, { env = process.env, spawnProcess = spawn, windowsHide = false } = {}) {
  const childEnv = { ...env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  return spawnProcess(electron, args, { env: childEnv, stdio: 'inherit', windowsHide });
}

const entry = process.argv[1] && path.resolve(process.argv[1]);
const self = fileURLToPath(import.meta.url);
if (entry && (process.platform === 'win32' ? entry.toLowerCase() === self.toLowerCase() : entry === self)) {
  const child = launchElectron([project, ...process.argv.slice(2)]);
  child.once('error', () => {
    console.error('Agent Inbox could not launch Electron. Run npm ci and check the local installation.');
    process.exitCode = 1;
  });
  child.once('exit', code => { process.exitCode = code ?? 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
}

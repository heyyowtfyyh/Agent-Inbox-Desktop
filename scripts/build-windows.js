import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, cp, mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Build this ZIP on Windows with x64 Node.js and the installed x64 Electron dependency.');
}

const project = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(project, 'dist');
const electron = path.join(project, 'node_modules', 'electron', 'dist');
const output = path.join(dist, 'Agent-Inbox-Windows-x64.zip');
const folderName = 'Agent Inbox';

async function verifyElectron() {
  const executable = await open(path.join(electron, 'electron.exe'), 'r');
  try {
    const dos = Buffer.alloc(64);
    await executable.read(dos, 0, dos.length, 0);
    const pe = Buffer.alloc(6);
    await executable.read(pe, 0, pe.length, dos.readUInt32LE(60));
    if (dos.toString('ascii', 0, 2) !== 'MZ' || pe.readUInt32LE(0) !== 0x4550 || pe.readUInt16LE(4) !== 0x8664) {
      throw new Error('The installed Electron binary is not for Windows x64.');
    }
  } finally { await executable.close(); }
}

async function copy(source, target) {
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, dereference: true, errorOnExist: true, force: false });
}

await verifyElectron();
const { name, version, type, main } = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
await mkdir(dist, { recursive: true });
const stage = await mkdtemp(path.join(dist, '.windows-'));
try {
  const bundle = path.join(stage, folderName);
  await cp(electron, bundle, { recursive: true, filter: source => path.basename(source) !== 'default_app.asar' });
  await rename(path.join(bundle, 'electron.exe'), path.join(bundle, 'Agent Inbox.exe'));
  await rename(path.join(bundle, 'LICENSE'), path.join(bundle, 'LICENSE.electron.txt'));
  await copyFile(path.join(project, 'LICENSE'), path.join(bundle, 'LICENSE'), constants.COPYFILE_EXCL);
  await copyFile(path.join(project, '.env.example'), path.join(bundle, '.env.example'), constants.COPYFILE_EXCL);
  await copyFile(path.join(project, 'scripts', 'portable-readme.txt'), path.join(bundle, 'README.txt'), constants.COPYFILE_EXCL);

  const app = path.join(bundle, 'resources', 'app');
  await mkdir(app, { recursive: true });
  // Keep Electron's app name aligned with the source launch so both use the same preferences.
  await writeFile(path.join(app, 'package.json'), `${JSON.stringify({ name, version, type, main }, null, 2)}\n`, { flag: 'wx' });
  for (const entry of [
    'src/config.js', 'src/index.html', 'src/main.js', 'src/model.js', 'src/preload.cjs',
    'src/renderer.js', 'src/styles.css', 'src/taskbar-badge.js', 'src/assets',
    'src/avatar/index.js', 'src/avatar/preferences.js', 'src/avatar/theme.js', 'src/avatar/open-source',
    'src/providers/codex',
  ]) {
    await copy(path.join(project, entry), path.join(app, entry));
  }

  // Bundle the font files served by the custom protocol and their license notices.
  for (const [family, weights] of [['sans', [400, 500, 600]], ['mono', [500]]]) {
    const font = `ibm-plex-${family}`;
    const directory = path.join('node_modules', '@fontsource', font);
    for (const entry of ['LICENSE', ...weights.map(weight => path.join('files', `${font}-latin-${weight}-normal.woff2`))]) {
      await copy(path.join(project, directory, entry), path.join(app, directory, entry));
    }
  }

  const archive = path.join(stage, path.basename(output));
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(tar, ['-a', '-cf', archive, '-C', stage, folderName], { stdio: 'inherit', windowsHide: true });
  await rename(archive, output);
  console.log(`Built ${output}`);
} finally {
  if (path.dirname(stage) !== path.resolve(dist) || !path.basename(stage).startsWith('.windows-')) {
    throw new Error('Unexpected Windows build staging directory.');
  }
  await rm(stage, { recursive: true, force: true, maxRetries: 3 });
}

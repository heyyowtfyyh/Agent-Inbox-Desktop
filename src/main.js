import { app, BrowserWindow, ipcMain, nativeImage, net, protocol, shell } from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCodexProvider } from './providers/codex/index.js';
import { readConfig } from './config.js';
import { createAvatarPreferences } from './avatar/preferences.js';
import { avatarColors } from './avatar/index.js';
import { badgeBitmap, createTaskbarBadge } from './taskbar-badge.js';

const config = readConfig({ envFile: app.isPackaged ? path.join(path.dirname(process.execPath), '.env') : undefined });
let avatars;
const sample = process.argv.includes('--sample');
let window;
let taskbarBadge;
let badgePoll;
let badgeRead;
let badgeForce = false;
const provider = createCodexProvider({
  codexHome: config.codexHome, pipe: config.codexPipe,
  deepLinksEnabled: config.codexDeepLinksEnabled, sample,
  onDiagnostic: ({ code, message }) => console.info(`[codex:${code}] ${message}`),
  onChange: () => {
    if (window && !window.isDestroyed()) window.webContents.send('inbox:runtime-changed');
    void refreshTaskbarBadge();
  },
});

function pinDirectory() {
  return path.join(app.getPath('userData'), sample ? 'sample-pins' : 'pins');
}

async function readPins() {
  try {
    const entries = await readdir(pinDirectory(), { withFileTypes: true });
    return new Set(entries.filter(entry => entry.isFile()).map(entry => entry.name));
  } catch (error) {
    return error.code === 'ENOENT' ? new Set() : null;
  }
}

async function readSnapshotData() {
  const [base, pins] = await Promise.all([provider.readSnapshot(), readPins()]);
  return {
    ...base,
    sessions: base.sessions.map(session => ({
      ...session, pinned: pins?.has(`session-${session.id}`) ?? null,
    })),
  };
}

async function readSnapshot() {
  const snapshot = await readSnapshotData();
  applyTaskbarBadge(snapshot);
  return snapshot;
}

function applyTaskbarBadge(snapshot, force = false) {
  if (!taskbarBadge || !window || window.isDestroyed()) return;
  try {
    taskbarBadge.update(snapshot, force);
  } catch {
    // A shell/overlay failure must not make valid session data unavailable to the UI.
    console.info('[taskbar] Native overlay update unavailable; will retry.');
  }
}

function refreshTaskbarBadge(force = false) {
  if (!taskbarBadge || !window || window.isDestroyed()) return;
  badgeForce ||= force;
  return badgeRead ??= readSnapshot().then(snapshot => {
    if (badgeForce) { badgeForce = false; applyTaskbarBadge(snapshot, true); }
  }).catch(() => {
    applyTaskbarBadge({ source:'unavailable', sessions:[] });
  }).finally(() => { badgeRead = null; });
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'agent-inbox', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function trustedHandler(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Invalid Agent Inbox request');
    }
    return callback(...args);
  });
}

async function isKind(candidate, method) {
  try {
    return (await stat(candidate))[method]();
  } catch {
    return false;
  }
}

async function findVsCode() {
  if (config.vsCodePath) return await isKind(config.vsCodePath, 'isFile') ? config.vsCodePath : null;
  const installs = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft VS Code'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft VS Code'),
    ...(process.env.PATH ?? '').split(path.delimiter).map(entry => entry.trim().replace(/^"|"$/g, ''))
      .filter(entry => path.isAbsolute(entry))
      .map(entry => path.basename(entry).toLowerCase() === 'bin' ? path.dirname(entry) : entry),
  ];
  for (const directory of new Set(installs.filter(Boolean))) {
    const executable = path.join(directory, 'Code.exe');
    if (await isKind(executable, 'isFile')) return executable;
  }
  return null;
}

async function openVsCode(session) {
  if (!session.cwd || !path.isAbsolute(session.cwd) || !(await isKind(session.cwd, 'isDirectory'))) {
    return { ok: false, message: 'The project directory is unavailable.' };
  }
  const executable = await findVsCode();
  if (!executable) return { ok: false, message: 'VS Code could not be found.' };

  // Codex stores extended-length Windows paths. VS Code expects a drive or UNC path.
  const folder = session.cwd.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\(?=[a-z]:\\)/i, '');
  return new Promise(resolve => {
    const editor = spawn(executable, ['--reuse-window', folder], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    // VS Code can wait 30 seconds for its updater before reporting launch failure.
    const startup = setTimeout(() => resolve({ ok: true }), 40_000).unref();
    const finish = ok => {
      clearTimeout(startup);
      resolve(ok ? { ok: true } : { ok: false, message: 'VS Code could not be opened.' });
    };
    editor.once('spawn', () => editor.unref());
    editor.once('error', () => finish(false));
    editor.once('exit', code => finish(code === 0));
  });
}

trustedHandler('inbox:snapshot', readSnapshot);
trustedHandler('inbox:avatar-theme', () => avatars.state());
trustedHandler('inbox:set-avatar-theme', async preference => {
  try {
    const state = await avatars.setPreference(preference);
    return state;
  } catch {
    throw new Error('The avatar preference could not be saved.');
  }
});
trustedHandler('inbox:set-pin', async (sessionId, pinned) => {
  if (typeof pinned !== 'boolean' || typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) {
    return { ok: false, message: 'This pin action is unavailable.' };
  }
  if (!await provider.hasSession(sessionId)) {
    return { ok: false, message: 'This session is no longer available.' };
  }

  const directory = pinDirectory();
  const file = path.join(directory, `session-${sessionId}`);
  try {
    if (pinned) {
      await mkdir(directory, { recursive: true });
      await writeFile(file, '', { flag: 'wx' });
    } else {
      await unlink(file);
    }
  } catch (error) {
    if (error.code !== (pinned ? 'EEXIST' : 'ENOENT')) {
      return { ok: false, message: 'The pin preference could not be saved.' };
    }
  }
  return { ok: true };
});

trustedHandler('inbox:open', async (destination, sessionId) => {
  if (!['codex', 'vscode'].includes(destination) || typeof sessionId !== 'string' || sessionId.length > 256) {
    return { ok: false, message: 'This navigation request is unavailable.' };
  }
  const snapshot = await readSnapshot();
  const session = snapshot.sessions.find(item => item.id === sessionId);
  if (!session) return { ok: false, message: 'This session is no longer available.' };
  if (sample) return { ok: false, message: 'Navigation is unavailable for sample sessions.' };
  if (destination === 'vscode') return openVsCode(session);

  const target = provider.conversationTarget(snapshot, session.id);
  if (!target) {
    return { ok: false, message: 'Exact Codex navigation is unavailable.' };
  }
  try {
    await shell.openExternal(target);
    return { ok: true };
  } catch {
    return { ok: false, message: 'Codex Desktop could not be opened.' };
  }
});

trustedHandler('inbox:window', action => {
  if (action === 'minimize') window.minimize();
  if (action === 'maximize') {
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  }
  if (action === 'close') window.close();
});

function start() {
  avatars = createAvatarPreferences({
    preferenceFile: path.join(app.getPath('userData'), 'avatar-preference.json'),
    defaultPreference: config.avatarTheme,
    onDiagnostic: message => console.info(`[avatar] ${message}`),
  });
  let windowsIcon = process.platform === 'win32'
    ? fileURLToPath(avatars.asset('avatar/open-source/app-icon.ico'))
    : undefined;
  if (windowsIcon) {
    try {
      const bytes = readFileSync(windowsIcon);
      const version = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
      const directory = path.join(app.getPath('userData'), 'icons');
      mkdirSync(directory, { recursive: true });
      const cachedIcon = path.join(directory, `agent-inbox-${version}.ico`);
      writeFileSync(cachedIcon, bytes);
      // A changed icon gets a new path so the Windows shell can bypass its cache.
      windowsIcon = cachedIcon;
    } catch {
      console.info('[icon] Icon cache unavailable; using the bundled application icon.');
    }
  }
  protocol.handle('agent-inbox', async request => {
    const url = new URL(request.url);
    const file = url.pathname.slice(1);
    if (url.hostname !== 'app' || request.method !== 'GET') return new Response(null, { status: 404 });
    const avatarFile = avatars.asset(file);
    if (avatarFile && url.searchParams.has('color')) {
      const color = `#${url.searchParams.get('color')}`;
      if (!file.startsWith('avatar/open-source/') || !file.endsWith('.svg') || !avatarColors.includes(color)) {
        return new Response(null, { status: 400 });
      }
      const svg = readFileSync(avatarFile, 'utf8').replace(/color="#[0-9a-f]{6}"/i, `color="${color}"`);
      return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' } });
    }
    if (avatarFile) return net.fetch(avatarFile.href);
    if (['index.html', 'styles.css', 'renderer.js', 'model.js', 'avatar/index.js'].includes(file) || /^assets\/[a-z-]+\.svg$/.test(file)) {
      return net.fetch(new URL(file, import.meta.url).href);
    }
    if (/^node_modules\/@fontsource\/ibm-plex-(sans|mono)\/files\/ibm-plex-(sans|mono)-latin-(400|500|600)-normal\.woff2$/.test(file)) {
      return net.fetch(new URL(`../${file}`, import.meta.url).href);
    }
    return new Response(null, { status: 404 });
  });
  window = new BrowserWindow({
    title: 'Agent Inbox', width: 600, height: 740, minWidth: 350, minHeight: 400,
    frame: false, backgroundColor: '#111111', autoHideMenuBar: true,
    icon: windowsIcon,
    webPreferences: {
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
    },
  });
  window.setIcon(fileURLToPath(avatars.asset('avatar/open-source/app-icon.png')));
  if (windowsIcon) {
    const appArgument = process.defaultApp ? ` "${app.getAppPath()}"` : '';
    window.setAppDetails({
      appId: 'AgentInbox.Desktop',
      appIconPath: windowsIcon,
      relaunchCommand: `"${process.execPath}"${appArgument}`,
      relaunchDisplayName: 'Agent Inbox',
    });
  }
  if (process.platform === 'win32') {
    taskbarBadge = createTaskbarBadge({ window, createImage: text => {
      const image = nativeImage.createFromBitmap(badgeBitmap(text,16), {width:16,height:16});
      const retina = nativeImage.createFromBitmap(badgeBitmap(text,32), {width:32,height:32});
      image.addRepresentation({scaleFactor:2,buffer:retina.toPNG()});
      return image;
    } });
    window.once('ready-to-show', () => { void refreshTaskbarBadge(true); });
    window.on('show', () => { void refreshTaskbarBadge(true); });
    window.on('restore', () => { void refreshTaskbarBadge(true); });
    // Keep metadata discovery and badges live even when the renderer is minimized or pauses polling.
    badgePoll = setInterval(() => { void refreshTaskbarBadge(); }, 5_000);
    void refreshTaskbarBadge();
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  return window.loadURL('agent-inbox://app/index.html');
}

// Electron must finish loading this entry point before it emits ready.
app.whenReady().then(start).catch(error => {
  console.error('Agent Inbox failed to start:', error);
  app.exit(1);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  clearInterval(badgePoll);
  taskbarBadge = null;
  provider.stop();
});

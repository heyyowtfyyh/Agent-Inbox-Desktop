import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveAvatarTheme } from './theme.js';

const validPreference = value => value === 'auto' || value === 'open-source';

export function createAvatarPreferences({ preferenceFile, defaultPreference = 'auto', personalDirectory,
  onDiagnostic = () => {} }) {
  const publicTheme = resolveAvatarTheme({ preference: 'open-source' });
  const automatic = resolveAvatarTheme({ personalDirectory });
  const personalAvailable = automatic.theme.id === 'personal';
  if (automatic.diagnostic) onDiagnostic(automatic.diagnostic);
  let preference = defaultPreference;
  try {
    const saved = JSON.parse(readFileSync(preferenceFile, 'utf8')).avatarTheme;
    if (!validPreference(saved)) throw new Error('Invalid saved preference.');
    preference = saved;
  } catch (error) {
    if (error.code !== 'ENOENT') onDiagnostic('Saved avatar preference could not be read; using the startup default.');
  }
  if (!validPreference(preference)) throw new Error('Invalid avatar theme preference.');
  const current = () => preference === 'auto' ? automatic : publicTheme;
  const state = () => ({ ...current().theme, preference, personalAvailable });
  const files = new Map();
  for (const selected of [publicTheme, automatic]) {
    for (const [name, url] of selected.files) {
      files.set(`${selected.theme.assetBase}${name.slice('avatar/'.length)}`, url);
    }
  }
  let pending = Promise.resolve();
  return {
    state,
    asset: file => files.get(file),
    setPreference(value) {
      if (!validPreference(value)) return Promise.reject(new Error('Invalid avatar theme preference.'));
      // Serialize saves and replace atomically. A failed save keeps the active preference.
      const operation = pending.catch(() => {}).then(async () => {
        await mkdir(path.dirname(preferenceFile), { recursive: true });
        const temporary = `${preferenceFile}.tmp`;
        await writeFile(temporary, `${JSON.stringify({ avatarTheme: value })}\n`, 'utf8');
        await rename(temporary, preferenceFile);
        preference = value;
        return state();
      });
      pending = operation;
      return operation;
    },
  };
}

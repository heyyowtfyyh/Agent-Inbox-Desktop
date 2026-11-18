import { readFileSync } from 'node:fs';

const publicDirectory = new URL('./open-source/', import.meta.url);
const localDirectory = new URL('../../.local/avatar/personal/', import.meta.url);
const safeName = value => typeof value === 'string' && /^[a-z]+(?:-[a-z]+)*$/.test(value);

function readTheme(directory, id, render) {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'));
  if (manifest.version !== 1 || manifest.render !== render || !Array.isArray(manifest.shapes)
    || !manifest.shapes.length || manifest.shapes.length > 16 || !manifest.shapes.every(safeName)
    || new Set(manifest.shapes).size !== manifest.shapes.length) throw new Error('Invalid avatar manifest.');
  const neutralFaces = render === 'layered' ? manifest.neutralFaces : undefined;
  if (render === 'layered' && (!neutralFaces || manifest.shapes.some(shape => !safeName(neutralFaces[shape]))
    || !Object.values(neutralFaces).every(safeName))) {
    throw new Error('Missing neutral face mappings.');
  }
  const assets = render === 'paired'
    ? manifest.shapes.flatMap(shape => ['idle', 'running', 'waiting'].map(face => `${shape}-${face}.svg`))
    : [...manifest.shapes.map(shape => `shape-${shape}.svg`),
      ...new Set(['working', 'waiting', ...Object.values(neutralFaces)].map(face => `face-${face}.svg`))];
  const files = new Map();
  // Resolve and validate the entire theme; never mix files from two themes.
  for (const file of ['theme.css', 'app-icon.png', 'app-icon.ico', ...assets]) {
    const url = new URL(file, directory);
    const bytes = readFileSync(url);
    const content = file.endsWith('.svg') || file.endsWith('.css') ? bytes.toString('utf8').trim() : null;
    const invalidIcon = file.endsWith('.png') ? !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : file.endsWith('.ico') ? bytes.length < 22 || bytes.readUInt16LE(2) !== 1 : false;
    if (!bytes.length || content === '' || invalidIcon
      || (file.endsWith('.svg') && (!/^<svg\b/.test(content) || !content.endsWith('</svg>')))) {
      throw new Error('Empty or invalid avatar asset.');
    }
    files.set(`avatar/${file}`, url);
  }
  return { theme: { id, render, assetBase: `avatar/${id}/`, shapes: manifest.shapes,
    ...(neutralFaces ? { neutralFaces } : {}) }, files };
}

export function resolveAvatarTheme({ preference = 'auto', personalDirectory = localDirectory } = {}) {
  if (!['auto', 'open-source'].includes(preference)) throw new Error('Invalid avatar theme preference.');
  if (preference === 'auto') {
    try {
      return { ...readTheme(personalDirectory, 'personal', 'layered'), diagnostic: null };
    } catch (error) {
      const diagnostic = error.code === 'ENOENT'
        ? 'Personal avatar theme is absent or incomplete; using open-source.'
        : 'Personal avatar theme could not be loaded; using open-source.';
      return { ...readTheme(publicDirectory, 'open-source', 'paired'), diagnostic };
    }
  }
  return { ...readTheme(publicDirectory, 'open-source', 'paired'), diagnostic: null };
}

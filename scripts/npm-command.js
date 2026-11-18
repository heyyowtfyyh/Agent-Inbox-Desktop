import { statSync } from 'node:fs';
import path from 'node:path';

// npm supplies its actual JS entry point to lifecycle scripts. For direct Node
// invocation, also search the Node installation and npm installations on PATH.
export function npmCommand({ env = process.env, node = process.execPath, platform = process.platform } = {}) {
  const inherited = env.npm_execpath;
  const candidates = [
    inherited && path.basename(inherited) === 'npm-cli.js' ? inherited : null,
    path.join(path.dirname(node), 'node_modules/npm/bin/npm-cli.js'),
    ...(env.PATH ?? '').split(path.delimiter).map(directory => directory.trim().replace(/^"|"$/g, ''))
      .filter(directory => path.isAbsolute(directory))
      .map(directory => path.join(directory, 'node_modules/npm/bin/npm-cli.js')),
  ];
  for (const candidate of candidates.filter(Boolean)) {
    try {
      if (path.isAbsolute(candidate) && statSync(candidate).isFile()) return { command: node, args: [candidate] };
    } catch { /* Try the next installation. */ }
  }
  if (platform !== 'win32') return { command: 'npm', args: [] };
  throw new Error('npm CLI could not be found. Run this check with npm run test:avatar-ui, or add the npm installation to PATH.');
}

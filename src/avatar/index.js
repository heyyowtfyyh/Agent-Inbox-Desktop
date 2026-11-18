// Stable identity and state mapping shared by both themes; artwork stays in its theme.
export const avatarColors = ['#1084FE', '#FF6700', '#00BCA6', '#FF263C', '#FF309B', '#9159FE', '#FF9800', '#45A738'];

export function avatarFor(session, theme) {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(session.id)) hash = Math.imul(hash ^ byte, 16777619);
  hash >>>= 0;
  const shape = theme.shapes[hash % theme.shapes.length];
  const expression = session.runtime === 'running' ? 'running'
    : session.runtime === 'approval' || session.runtime === 'input' ? 'waiting' : 'idle';
  const face = expression === 'running' ? 'working'
    : expression === 'waiting' ? 'waiting' : theme.neutralFaces?.[shape] ?? 'neutral';
  return { shape, color: avatarColors[hash % avatarColors.length], expression, face };
}

export function createAvatar(session, theme, document = globalThis.document) {
  const { shape, color, expression, face } = avatarFor(session, theme);
  const graphic = document.createElement('span');
  graphic.className = `avatar-graphic avatar-${theme.id}`;
  graphic.setAttribute('aria-hidden', 'true');
  const image = document.createElement('img');
  image.alt = '';
  if (theme.render === 'layered') {
    const silhouette = document.createElement('span');
    silhouette.className = `avatar-shape shape-${shape}`;
    silhouette.style.backgroundColor = color;
    image.className = 'icon';
    image.src = `${theme.assetBase}face-${face}.svg`;
    graphic.append(silhouette, image);
  } else {
    image.src = `${theme.assetBase}${shape}-${expression}.svg?color=${color.slice(1)}`;
    graphic.append(image);
  }
  return graphic;
}

// Count confirmed actionable conversations across the full snapshot, independent of UI filters.
export function taskbarCount(snapshot) {
  if (snapshot.source !== 'ready') return null;
  return new Set(snapshot.sessions.filter(session => session.unread === true
    || session.runtime === 'approval' || session.runtime === 'input').map(session => session.id)).size;
}

export function taskbarText(count) {
  return count == null || count === 0 ? '' : count > 99 ? '99+' : String(count);
}

// A small bitmap font keeps the native overlay independent of web fonts and renderer visibility.
const glyphs = {
  '0': ['111','101','101','101','111'], '1': ['010','110','010','010','111'],
  '2': ['111','001','111','100','111'], '3': ['111','001','111','001','111'],
  '4': ['101','101','111','001','001'], '5': ['111','100','111','001','111'],
  '6': ['111','100','111','101','111'], '7': ['111','001','010','010','010'],
  '8': ['111','101','111','101','111'], '9': ['111','101','111','001','111'],
  '+': ['000','010','111','010','000'],
};

export function badgeBitmap(text, size) {
  if (!/^(?:[1-9]\d?|99\+)$/.test(text) || ![16,32].includes(size)) throw new Error('Invalid taskbar badge.');
  const scale = text.length === 1 ? 1.8 : text.length === 2 ? 1.5 : 1.1;
  const gap = text.length === 3 ? 1 : 1.25;
  const width = text.length * 3 * scale + (text.length - 1) * gap;
  const left = (16-width)/2, top = (16-5*scale)/2;
  const bitmap = Buffer.alloc(size*size*4);
  for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
    let blue=0,green=0,red=0,alpha=0;
    for (let sy=0;sy<4;sy++) for (let sx=0;sx<4;sx++) {
      const px=(x+(sx+.5)/4)*16/size, py=(y+(sy+.5)/4)*16/size;
      const radius=(px-8)**2+(py-8)**2;
      if (radius>7.8**2) continue;
      let color = radius>7.1**2 ? [119,123,134] : [48,50,56];
      const row=Math.floor((py-top)/scale);
      if(row>=0&&row<5) for(let i=0;i<text.length;i++) {
        const column=Math.floor((px-left-i*(3*scale+gap))/scale);
        if(column>=0&&column<3&&glyphs[text[i]][row][column]==='1') color=[255,255,255];
      }
      red+=color[0];green+=color[1];blue+=color[2];alpha+=255;
    }
    // Windows NativeImage bitmap bytes are premultiplied BGRA.
    const offset=(y*size+x)*4;
    bitmap[offset]=Math.round(blue/16);bitmap[offset+1]=Math.round(green/16);
    bitmap[offset+2]=Math.round(red/16);bitmap[offset+3]=Math.round(alpha/16);
  }
  return bitmap;
}

export function createTaskbarBadge({ window, createImage }) {
  let previous;
  const images = new Map();
  return {
    update(snapshot, force = false) {
      const count = taskbarCount(snapshot);
      if (!force && count === previous) return;
      const text = taskbarText(count);
      if (!text) window.setOverlayIcon(null, '');
      else {
        if (!images.has(text)) images.set(text, createImage(text));
        window.setOverlayIcon(images.get(text), `${count} ${count === 1 ? 'conversation needs' : 'conversations need'} attention`);
      }
      previous = count;
    },
  };
}

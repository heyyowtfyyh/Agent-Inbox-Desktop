import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { app, net } from 'electron';
import '../../src/main.js';

app.setPath('userData', process.env.AGENT_INBOX_TEST_PROFILE);
app.disableHardwareAcceleration();
app.on('browser-window-created', (_, window) => {
  window.hide();
  const errors = [];
  window.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  window.webContents.once('did-finish-load', async () => {
    const evaluate = code => window.webContents.executeJavaScript(code);
    async function waitFor(code) {
      for (let i = 0; i < 100; i++) { if (await evaluate(code)) return; await delay(50); }
      throw new Error(`UI condition timed out: ${code}`);
    }
    const save = async name => writeFileSync(path.join(process.env.AGENT_INBOX_AVATAR_QA_OUTPUT,
      `${process.env.AGENT_INBOX_AVATAR_QA_SCENARIO ?? process.env.AVATAR_THEME}-${name}.png`), (await window.webContents.capturePage()).toPNG());
    try {
      await waitFor(`document.querySelectorAll('.session-card .avatar-graphic').length > 0`);
      const theme = await evaluate('window.inbox.avatarTheme()');
      assert.equal(theme.id, process.env.AGENT_INBOX_EXPECTED_THEME);
      const assertApplicationIcon = async () => {
        assert.ok((await evaluate(`document.querySelector('.app-mark').src`)).endsWith('/assets/app-icon.svg'));
        if (process.platform === 'win32') {
          const icon = readFileSync(new URL('../../src/avatar/open-source/app-icon.ico', import.meta.url));
          const version = createHash('sha256').update(icon).digest('hex').slice(0,12);
          const installed = path.join(app.getPath('userData'), 'icons', `agent-inbox-${version}.ico`);
          assert.ok(readFileSync(installed).equals(icon));
        }
      };
      await assertApplicationIcon();
      const picker = await evaluate(`({ value:document.querySelector('#avatar-theme').value,
        disabled:document.querySelector('#avatar-theme').disabled,
        options:[...document.querySelector('#avatar-theme').options].map(n=>n.value) })`);
      assert.deepEqual(picker.options, theme.personalAvailable ? ['auto', 'open-source'] : ['open-source']);
      assert.equal(picker.disabled, !theme.personalAvailable);
      if (process.env.AGENT_INBOX_VERIFY_SAVED === '1') {
        assert.equal(theme.preference, 'open-source');
        assert.equal(picker.value, 'open-source');
        console.log(JSON.stringify({ restartPreferenceRestored:true, selected:theme.id }));
        app.quit();
        return;
      }
      await evaluate('Promise.all([...document.images].map(i => i.decode()))');
      const measure = selector => evaluate(`(() => {
        const graphic = document.querySelector(${JSON.stringify(selector)});
        const child = graphic.querySelector('img');
        const a = graphic.getBoundingClientRect(), b = child.getBoundingClientRect();
        return {width:a.width,height:a.height,artWidth:b.width,artHeight:b.height};
      })()`);
      const compact = await measure('.session-card .avatar-graphic');
      assert.equal(compact.width, 46);
      assert.equal(compact.height, 46);
      assert.ok(Math.abs(compact.artWidth - (theme.id === 'personal' ? 57.2 : 46)) < .01);
      await save('inbox');
      await evaluate(`document.querySelector('[data-view="all"]').click()`);
      await waitFor(`document.querySelectorAll('.session-row .avatar-graphic').length === 7`);
      await evaluate('Promise.all([...document.images].map(i => i.decode()))');
      const row = await measure('.session-row .avatar-graphic');
      assert.equal(row.width, 28);
      assert.equal(row.height, 28);
      assert.ok(Math.abs(row.artWidth - (theme.id === 'personal' ? 34.84 : 28)) < .01);
      assert.equal(await evaluate(`document.querySelectorAll('.session-row .runtime-error').length`), 1);
      assert.equal(await evaluate(`document.querySelectorAll('.session-row .unread').length`), 1);
      await save('all');
      let liveSwitches = 0;
      if (theme.personalAvailable) {
        const choose = async preference => {
          await evaluate(`document.querySelector('#avatar-theme').focus();
            document.querySelector('#avatar-theme').value=${JSON.stringify(preference)};
            document.querySelector('#avatar-theme').dispatchEvent(new Event('change'));`);
          const id=preference==='auto'?'personal':'open-source';
          await waitFor(`!document.querySelector('#avatar-theme').disabled
            && document.querySelector('.session-row .avatar-${id}') !== null`);
          await evaluate('Promise.all([...document.images].map(i => i.decode()))');
          assert.equal(await evaluate(`document.activeElement.id`), 'avatar-theme');
          await assertApplicationIcon();
          assert.equal(await evaluate(`document.querySelectorAll('link[href*="avatar/"]').length`), 1);
          liveSwitches++;
        };
        const before = await evaluate(`({view:document.querySelector('[data-view="all"]').getAttribute('aria-pressed'),
          titles:[...document.querySelectorAll('.session-title')].map(n=>n.textContent),
          counts:[...document.querySelectorAll('.metric strong')].map(n=>n.textContent)})`);
        await choose(theme.id==='personal'?'open-source':'auto');
        const switchedRow=await measure('.session-row .avatar-graphic');
        assert.equal(switchedRow.width,28);
        assert.ok(Math.abs(switchedRow.artWidth-(theme.id==='personal'?28:34.84))<.01);
        await evaluate(`document.querySelector('[data-view="inbox"]').click()`);
        const switchedCard=await measure('.session-card .avatar-graphic');
        assert.equal(switchedCard.width,46);
        assert.ok(Math.abs(switchedCard.artWidth-(theme.id==='personal'?46:57.2))<.01);
        await evaluate(`document.querySelector('[data-view="all"]').click()`);
        const after = await evaluate(`({view:document.querySelector('[data-view="all"]').getAttribute('aria-pressed'),
          titles:[...document.querySelectorAll('.session-title')].map(n=>n.textContent),
          counts:[...document.querySelectorAll('.metric strong')].map(n=>n.textContent)})`);
        assert.deepEqual(after,before);
        await choose(theme.preference);
        // Keep a non-default filter and a collapsed project across a theme change.
        await evaluate(`document.querySelector('#status-filter').value='running';
          document.querySelector('#status-filter').dispatchEvent(new Event('change'));
          document.querySelector('.project-heading').click()`);
        await evaluate(`document.querySelector('#avatar-theme').value=${JSON.stringify(theme.id==='personal'?'open-source':'auto')};
          document.querySelector('#avatar-theme').dispatchEvent(new Event('change'));`);
        await waitFor(`!document.querySelector('#avatar-theme').disabled`);
        assert.equal(await evaluate(`document.querySelector('#status-filter').value`),'running');
        assert.equal(await evaluate(`document.querySelector('.project-heading').getAttribute('aria-expanded')`),'false');
        await evaluate(`document.querySelector('.project-heading').click();
          document.querySelector('#status-filter').value='all';
          document.querySelector('#status-filter').dispatchEvent(new Event('change'));`);
        await choose(theme.preference);
      }
      // Header control remains inside the titlebar at the minimum supported width.
      window.setSize(350,740);
      await delay(50);
      const narrow = await evaluate(`(() => {
        const a=document.querySelector('.identity').getBoundingClientRect();
        const b=document.querySelector('.avatar-picker').getBoundingClientRect();
        const c=document.querySelector('.window-controls').getBoundingClientRect();
        return {identityEnd:a.right,pickerStart:b.left,pickerEnd:b.right,controlsStart:c.left,controlsEnd:c.right,width:innerWidth};
      })()`);
      assert.ok(narrow.identityEnd<=narrow.pickerStart && narrow.pickerEnd<=narrow.controlsStart && narrow.controlsEnd<=narrow.width);
      await save('narrow');
      window.setSize(600,740);
      // Exercise every shape × expression using the same renderer, stylesheet and protocol.
      const gallery = await evaluate(`(async () => {
        const {createAvatar, avatarFor} = await import('./avatar/index.js');
        const theme = await window.inbox.avatarTheme();
        const ids = new Map();
        for(let i=0;ids.size<theme.shapes.length;i++) {
          const id='avatar-qa-'+i; ids.set(avatarFor({id,runtime:'idle'},theme).shape,id);
        }
        const gallery=document.createElement('div'); gallery.id='avatar-qa';
        Object.assign(gallery.style,{position:'fixed',inset:'0',zIndex:'100',background:'#111',padding:'20px',display:'grid',gridTemplateColumns:'repeat(3, 1fr)',gap:'6px',overflow:'auto'});
        let count=0;
        for(const shape of theme.shapes) for(const runtime of ['idle','running','approval']) {
          const cell=document.createElement('div');
          Object.assign(cell.style,{border:'1px solid #333',borderRadius:'8px',display:'flex',alignItems:'center',justifyContent:'space-around',gap:'8px'});
          const label=document.createElement('span');label.textContent=shape+' / '+runtime;
          Object.assign(label.style,{fontSize:'10px',width:'65px'});cell.append(label);
          for(const compact of [true,false]) {
            const holder=document.createElement('div');holder.className=compact?'avatar-button':'session-row';
            if(!compact)Object.assign(holder.style,{padding:'0',border:'0',minHeight:'0',background:'none'});
            holder.append(createAvatar({id:ids.get(shape),runtime},theme));cell.append(holder);count++;
          }
          gallery.append(cell);
        }
        document.body.append(gallery);await Promise.all([...gallery.querySelectorAll('img')].map(i=>i.decode()));
        await document.fonts.ready;
        return {count,unloaded:[...gallery.querySelectorAll('img')].filter(i=>!i.complete||!i.naturalWidth).length};
      })()`);
      assert.equal(gallery.count, theme.shapes.length * 6);
      assert.equal(gallery.unloaded, 0);
      await delay(100);
      await save('gallery');
      await evaluate(`document.querySelector('#avatar-qa').remove()`);
      let coloredPairs = 0;
      if (theme.id === 'open-source') {
        // Check the actual protocol response, not just the model's selected color.
        const colors = ['#1084FE','#FF6700','#00BCA6','#FF263C','#FF309B','#9159FE','#FF9800','#45A738'];
        for (const shape of theme.shapes) for (const expression of ['idle','running','waiting']) {
          for (const color of colors) {
            const response = await net.fetch(`agent-inbox://app/${theme.assetBase}${shape}-${expression}.svg?color=${color.slice(1)}`);
            assert.equal(response.status,200);
            assert.match(response.headers.get('content-type'), /image\/svg\+xml/);
            const svg = await response.text();
            assert.ok(svg.includes(`color="${color}"`));
            assert.ok(svg.includes('fill="currentColor"'));
          }
        }
        assert.equal((await net.fetch('agent-inbox://app/avatar/open-source/pebble-idle.svg?color=not-a-color')).status,400);
        assert.equal((await net.fetch('agent-inbox://app/avatar/open-source/robot-idle.svg')).status,404);
        const matrix = await evaluate(`(async()=>{
          const {createAvatar,avatarFor,avatarColors}=await import('./avatar/index.js');
          const theme=await window.inbox.avatarTheme();const ids=new Map();
          for(let i=0;i<4096&&ids.size<56;i++){
            const id='matrix-'+i;const a=avatarFor({id,runtime:'idle'},theme);ids.set(a.shape+'/'+a.color,id);
          }
          if(ids.size!==56)throw Error('Missing shape/color combinations');
          const root=document.createElement('div');root.id='avatar-color-matrix';
          Object.assign(root.style,{position:'fixed',inset:'0',zIndex:'100',background:'#111',padding:'12px',display:'grid',gridTemplateColumns:'54px repeat(8,minmax(0,1fr))',gridTemplateRows:'18px repeat(7,minmax(0,1fr))',gap:'3px'});
          const heading=document.createElement('span');heading.textContent='46 / 28';heading.style.fontSize='10px';root.append(heading);
          for(const color of avatarColors){const label=document.createElement('span');label.textContent=color;label.style.fontSize='8px';root.append(label);}
          for(const shape of theme.shapes){
            const label=document.createElement('span');label.textContent=shape;label.style.fontSize='10px';root.append(label);
            for(const color of avatarColors){
              const cell=document.createElement('div');Object.assign(cell.style,{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'5px',border:'1px solid #333',borderRadius:'6px'});
              cell.dataset.color=color;cell.dataset.shape=shape;
              for(const compact of [true,false]){
                const holder=document.createElement('div');holder.className=compact?'avatar-button':'session-row';
                if(!compact)Object.assign(holder.style,{padding:'0',border:'0',minHeight:'0',background:'none'});
                holder.append(createAvatar({id:ids.get(shape+'/'+color),runtime:'idle'},theme));cell.append(holder);
              }
              root.append(cell);
            }
          }
          document.body.append(root);await Promise.all([...root.querySelectorAll('img')].map(i=>i.decode()));
          return {pairs:ids.size,images:root.querySelectorAll('img').length,
            cells:[...root.querySelectorAll('[data-color]')].flatMap(cell=>[...cell.querySelectorAll('.avatar-graphic')].map(graphic=>{
              const r=graphic.getBoundingClientRect();return {color:cell.dataset.color,shape:cell.dataset.shape,x:r.x,y:r.y,width:r.width,height:r.height};
            }))};
        })()`);
        assert.equal(matrix.images,112);
        coloredPairs = matrix.pairs;
        await delay(100);
        await save('colors');
        const captured = await window.webContents.capturePage();
        const pixels = captured.toBitmap({ scaleFactor:1 });
        const imageSize = captured.getSize();
        assert.equal(pixels.length,imageSize.width*imageSize.height*4);
        for(const cell of matrix.cells){
          const wanted=parseInt(cell.color.slice(1),16);let matching=0;
          for(let y=Math.ceil(cell.y);y<Math.floor(cell.y+cell.height);y++)for(let x=Math.ceil(cell.x);x<Math.floor(cell.x+cell.width);x++){
            const offset=(y*imageSize.width+x)*4;
            const rgb=(pixels[offset+2]<<16)|(pixels[offset+1]<<8)|pixels[offset];
            if(pixels[offset+3]===255&&rgb===wanted)matching++;
          }
          assert.ok(matching>30,`${cell.shape} / ${cell.color} at ${cell.width}px must contain its selected body color.`);
        }
        const expected = new Map(colors.map(color=>[parseInt(color.slice(1),16),0]));
        for(let i=0;i<pixels.length;i+=4){
          const rgb=(pixels[i+2]<<16)|(pixels[i+1]<<8)|pixels[i];
          if(pixels[i+3]===255&&expected.has(rgb))expected.set(rgb,expected.get(rgb)+1);
        }
        assert.ok([...expected.values()].every(count=>count>100),'All eight palette colors must be visible in the rendered matrix.');
        await evaluate(`document.querySelector('#avatar-color-matrix').remove()`);
      }
      if (theme.personalAvailable && process.env.AGENT_INBOX_AVATAR_QA_SCENARIO === 'auto') {
        // Leave the UI-selected public preference for the separate restart process.
        await evaluate(`document.querySelector('#avatar-theme').value='open-source';
          document.querySelector('#avatar-theme').dispatchEvent(new Event('change'));`);
        await waitFor(`!document.querySelector('#avatar-theme').disabled`);
      }
      assert.equal(errors.length, 0, errors.join('\n'));
      console.log(JSON.stringify({ preference:process.env.AVATAR_THEME, selected:theme.id, compact, row, previews:gallery.count,
        coloredPairs,liveSwitches,narrowHeaderFits:true,unloaded:0,errors:0 }));
      app.quit();
    } catch (error) { console.error(error); app.exit(1); }
  });
});

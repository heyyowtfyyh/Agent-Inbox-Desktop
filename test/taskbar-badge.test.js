import assert from 'node:assert/strict';
import { test } from 'node:test';
import { badgeBitmap, createTaskbarBadge, taskbarCount, taskbarText } from '../src/taskbar-badge.js';

const snapshot = sessions => ({ source:'ready', sessions });
const session = (id, runtime='idle', unread=false) => ({id,runtime,unread});

test('taskbar counts unread or pending input/approval conversations once each', () => {
  const data=snapshot([
    session('unread','idle',true),session('approval','approval'),session('input','input'),
    session('both','input',true),session('both','approval',true),session('running','running'),
    session('error','error'),session('pinned','idle'),session('unknown','unknown',null),
  ]);
  assert.equal(taskbarCount(data),4);
  assert.equal(taskbarCount({...data,view:'all',filter:'running'}),4);
  assert.equal(taskbarCount(snapshot([session('still-unread','running',true)])),1);
});

test('stale or unavailable sources hide cached counts; only confirmed positive evidence counts', () => {
  const data=snapshot([session('one','idle',true)]);
  for(const source of ['loading','stale','unavailable']) assert.equal(taskbarCount({...data,source}),null);
  assert.equal(taskbarCount(snapshot([session('unknown','unknown',null)])),0);
  assert.equal(taskbarCount(snapshot([session('confirmed','approval',null)])),1);
});

test('native updates follow changes, reuse capped artwork and remove the overlay at zero', () => {
  const calls=[],rendered=[];
  const badge=createTaskbarBadge({window:{setOverlayIcon:(image,description)=>calls.push({image,description})},
    createImage:text=>{rendered.push(text);return {text};}});
  const data=count=>snapshot(Array.from({length:count},(_,i)=>session(String(i),'idle',true)));
  badge.update(data(0));assert.equal(calls.at(-1).image,null);
  badge.update(data(1));assert.equal(calls.at(-1).image.text,'1');
  const before=calls.length;badge.update(data(1));assert.equal(calls.length,before);
  badge.update(data(12));assert.equal(calls.at(-1).image.text,'12');
  badge.update(data(100));assert.equal(calls.at(-1).image.text,'99+');
  badge.update(data(101));assert.match(calls.at(-1).description,/^101 /);
  assert.equal(rendered.filter(text=>text==='99+').length,1);
  badge.update(data(1));assert.equal(rendered.filter(text=>text==='1').length,1);
  badge.update(data(0));assert.deepEqual(calls.at(-1),{image:null,description:''});
  badge.update(data(1));badge.update({...data(1),source:'stale'});assert.equal(calls.at(-1).image,null);
  assert.equal(taskbarText(99),'99');assert.equal(taskbarText(100),'99+');
});

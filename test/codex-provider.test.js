import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCodexProvider } from '../src/providers/codex/index.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const session = n => ({ id:id(n), title:`Session ${n}`, cwd:String.raw`C:\work\repo`,
  projectId:String.raw`c:\work\repo`, project:'repo', lastActivity:n, runtime:'unknown', unread:null });
const metadata = () => ({ source:'ready', sample:false, runtimeAvailable:false, unreadAvailable:false,
  sessions:[session(1),session(2),session(3)] });

function fixture(options = {}) {
  let source = metadata();
  const states = new Map([[id(1),{runtime:'input',unread:true,attention:true}],
    [id(2),{runtime:'idle',unread:false,attention:true}]]);
  const tracked=[];let stops=0,readerHome,runtimeOptions;
  const runtime={ track:ids=>tracked.push(ids), status:key=>states.get(key)?.runtime??'unknown',
    monitoring:()=>({status:'connected',code:null}),
    unread:key=>states.get(key)?.unread??null, attentionAvailable:key=>states.get(key)?.attention??false,
    stop:()=>stops++ };
  const provider=createCodexProvider({codexHome:'fixture-home',pipe:'fixture-pipe',platform:'win32',
    createReader:home=>{readerHome=home;return async()=>source;},
    createRuntime:value=>{runtimeOptions=value;return runtime;},...options});
  return {provider,states,tracked,setSource:value=>{source=value;},
    get source(){return source;},get stops(){return stops;},get readerHome(){return readerHome;},get runtimeOptions(){return runtimeOptions;} };
}

test('provider preserves metadata identity and projects current state without changing source records', async () => {
  let notifications=0;
  const f=fixture({onChange:()=>notifications++});
  const original=structuredClone(f.source);
  const snapshot=await f.provider.readSnapshot();
  assert.equal(f.provider.id,'codex');assert.equal(f.readerHome,'fixture-home');
  assert.equal(f.runtimeOptions.pipe,'fixture-pipe');f.runtimeOptions.onChange();assert.equal(notifications,1);
  assert.deepEqual(f.tracked,[original.sessions.map(s=>s.id)]);
  assert.deepEqual(snapshot.sessions.map(s=>({id:s.id,title:s.title,cwd:s.cwd,projectId:s.projectId,project:s.project,lastActivity:s.lastActivity})),
    original.sessions.map(({runtime,unread,...rest})=>rest));
  assert.deepEqual(snapshot.sessions.map(s=>[s.runtime,s.unread]),[['input',true],['idle',false],['unknown',null]]);
  assert.equal(snapshot.runtimeAvailable,true);assert.equal(snapshot.attentionAvailable,true);assert.equal(snapshot.unreadAvailable,true);
  assert.deepEqual(f.source,original);
  f.states.set(id(1),{runtime:'error',unread:false,attention:false});
  assert.equal((await f.provider.readSnapshot()).sessions[0].runtime,'error');
});

test('stale/unavailable discovery clears tracked IDs and keeps cached metadata semantics', async () => {
  const f=fixture();await f.provider.readSnapshot();
  const stale={...f.source,source:'stale'};f.setSource(stale);
  assert.deepEqual(await f.provider.readSnapshot(),{...stale,monitoring:{status:'unavailable',code:'SOURCE_UNAVAILABLE'}});
  assert.deepEqual(f.tracked.at(-1),[]);
  // Existing pins may still be changed for a known cached session, as before.
  assert.equal(await f.provider.hasSession(id(1)),true);
  assert.equal(await f.provider.hasSession(id(99)),false);
  const missing={...stale,source:'unavailable',sessions:[]};f.setSource(missing);
  assert.deepEqual(await f.provider.readSnapshot(),{...missing,monitoring:{status:'unavailable',code:'SOURCE_UNAVAILABLE'}});assert.deepEqual(f.tracked.at(-1),[]);
});

test('sample mode preserves sample IDs and states without reading local data or creating a stream', async () => {
  const provider=createCodexProvider({sample:true,platform:'win32',
    createReader:()=>{throw new Error('Unexpected metadata read');},createRuntime:()=>{throw new Error('Unexpected stream');}});
  const first=await provider.readSnapshot();assert.equal(await provider.readSnapshot(),first);
  assert.deepEqual(first.sessions.map(s=>s.id),Array.from({length:7},(_,i)=>`sample-${i+1}`));
  assert.deepEqual(first.sessions.map(s=>s.runtime),['running','approval','idle','error','input','idle','unknown']);
  assert.equal(first.sample,true);assert.equal(first.source,'ready');
  assert.deepEqual(first.monitoring,{status:'sample',code:null});
  assert.equal(await provider.hasSession('sample-1'),true);assert.equal(await provider.hasSession('missing'),false);
  assert.equal(provider.conversationTarget(first,'sample-1'),null);provider.stop();provider.stop();
});

test('non-Windows metadata passthrough does not start unsupported native monitoring', async () => {
  const source=metadata();
  const provider=createCodexProvider({platform:'linux',createReader:()=>async()=>source,
    createRuntime:()=>{throw new Error('Unexpected native stream');}});
  assert.deepEqual(await provider.readSnapshot(),{...source,monitoring:{status:'unavailable',code:'PLATFORM_UNSUPPORTED'}});provider.stop();
});

test('navigation targets keep the old allowlist, membership, source and deep-link guards', async () => {
  const f=fixture();const data=f.source;
  assert.equal(f.provider.conversationTarget(data,id(1)),`codex://threads/${id(1)}`);
  assert.equal(f.provider.conversationTarget({...data,source:'stale'},id(1)),null);
  assert.equal(f.provider.conversationTarget(data,id(99)),null);
  for(const unsafe of ['../outside','a/b','a?query','a#fragment',null]) {
    assert.equal(f.provider.conversationTarget({...data,sessions:[{id:unsafe}]},unsafe),null);
  }
  assert.equal(fixture({deepLinksEnabled:false}).provider.conversationTarget(data,id(1)),null);
  assert.equal(await f.provider.hasSession(id(1)),true);assert.deepEqual(f.tracked,[]);
});

test('provider owns stream cleanup and stop is idempotent', () => {
  const f=fixture();f.provider.stop();f.provider.stop();assert.equal(f.stops,1);
});

test('provider forwards diagnostic callbacks to discovery and native monitoring', () => {
  const onDiagnostic = () => {};
  let readerOptions, runtimeOptions;
  const provider = createCodexProvider({ platform: 'win32', onDiagnostic,
    createReader: (home, options) => { readerOptions = options; return async () => metadata(); },
    createRuntime: options => { runtimeOptions = options; return { stop() {} }; } });
  assert.equal(readerOptions.onDiagnostic, onDiagnostic);
  assert.equal(runtimeOptions.onDiagnostic, onDiagnostic);
  provider.stop();
});

test('provider exposes current source failures, clears them on recovery and forwards health changes', async () => {
  let changes = 0;
  const f = fixture({onChange:()=>changes++});
  f.runtimeOptions.onMonitoringChange();
  assert.equal(changes,1);
  for (const code of ['DATABASE_NOT_FOUND','DATABASE_ACCESS_DENIED','UNSUPPORTED_SCHEMA','DATABASE_BUSY']) {
    f.setSource({...metadata(),source:'unavailable',diagnostic:code});
    assert.deepEqual((await f.provider.readSnapshot()).monitoring,
      {status:code==='DATABASE_BUSY'?'reconnecting':'unavailable',code});
    f.setSource(metadata());
    assert.deepEqual((await f.provider.readSnapshot()).monitoring,{status:'connected',code:null});
  }
  f.setSource({...metadata(),sessions:[]});
  assert.deepEqual((await f.provider.readSnapshot()).monitoring,{status:'idle',code:null});
});

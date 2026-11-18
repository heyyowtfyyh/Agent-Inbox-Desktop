import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { app } from 'electron';
import '../../src/main.js';

app.setPath('userData',process.env.AGENT_INBOX_TEST_PROFILE);
app.disableHardwareAcceleration();
const states=Array.from({length:100},(_,i)=>({
  id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,runtime:'idle',unread:false,revision:0,
}));
const following=new Set();let peer;
function send(message){
  if(!peer||peer.destroyed)return;
  const bytes=Buffer.from(JSON.stringify(message));const size=Buffer.alloc(4);size.writeUInt32LE(bytes.length);
  peer.write(Buffer.concat([size,bytes]));
}
function snapshot(state){
  const active=['running','approval','input'].includes(state.runtime);
  send({type:'broadcast',method:'thread-stream-state-changed',version:13,sourceClientId:'badge-test-owner',params:{
    hostId:'local',conversationId:state.id,change:{type:'snapshot',revision:++state.revision,conversationState:{
      threadRuntimeStatus:{type:active?'active':'idle',activeFlags:[]},hasUnreadTurn:state.unread,
      requests:state.runtime==='approval'?[{method:'item/commandExecution/requestApproval'}]:[],
      turns:state.runtime==='input'?[{turnId:`turn-${state.id}`,status:'inProgress',
        items:[{type:'agentMessage',id:`question-${state.id}`,questions:[{}],content:[]}]}]:[],
    }},
  }});
}
function change(index,patch){Object.assign(states[index],patch);snapshot(states[index]);}
const server=createServer(socket=>{
  peer=socket;let bytes=Buffer.alloc(0);socket.on('error',()=>{});
  socket.on('data',chunk=>{
    bytes=Buffer.concat([bytes,chunk]);
    while(bytes.length>=4&&bytes.length>=bytes.readUInt32LE()+4){
      const size=bytes.readUInt32LE();const message=JSON.parse(bytes.subarray(4,size+4));bytes=bytes.subarray(size+4);
      if(message.method==='initialize')send({type:'response',requestId:message.requestId,resultType:'success',result:{clientId:'badge-check'}});
      if(message.method==='thread-stream-following-changed'&&message.params.following){
        const state=states.find(s=>s.id===message.params.conversationId);
        if(state){following.add(state.id);snapshot(state);}
      }
    }
  });
});
server.on('error',error=>{console.error(error);app.exit(1);});server.listen(process.env.AGENT_INBOX_CODEX_PIPE);
app.on('before-quit',()=>{peer?.destroy();server.close();});

app.on('browser-window-created',(_,window)=>{
  window.hide();
  // Keep native overlay calls real while isolating test taskbar grouping from the user's app.
  const originalDetails=window.setAppDetails.bind(window);
  window.setAppDetails=details=>originalDetails({...details,appId:`AgentInbox.BadgeCheck.${path.basename(path.dirname(app.getPath('userData')))}`});
  const calls=[];let failNext=false;const originalOverlay=window.setOverlayIcon.bind(window);
  window.setOverlayIcon=(image,description)=>{
    if(failNext){failNext=false;throw new Error('Simulated transient overlay failure.');}
    originalOverlay(image,description);
    const count=image?Number(description.match(/^\d+/)?.[0]):0;
    if(image){
      assert.deepEqual(image.getSize(),{width:16,height:16});
      assert.deepEqual(image.getScaleFactors().sort(),[1,2]);
      if([1,2,3,4,99,100].includes(count))writeFileSync(path.join(process.env.AGENT_INBOX_BADGE_QA_OUTPUT,
        `badge-${count>99?'99plus':count}.png`),image.toPNG({scaleFactor:2}));
    }
    calls.push({count,description,hidden:image===null});
  };
  window.webContents.once('did-finish-load',async()=>{
    const evaluate=code=>window.webContents.executeJavaScript(code);
    async function waitFor(condition){
      for(let i=0;i<100;i++){if(await condition())return;await delay(40);}
      throw new Error('Taskbar condition timed out. Last native call: '+JSON.stringify(calls.at(-1)));
    }
    const badge=count=>waitFor(()=>calls.at(-1)?.count===count);
    const checks=[];
    try{
      await waitFor(()=>following.size===100);await badge(0);
      assert.equal(calls.at(-1).hidden,true);checks.push('initial zero hidden');
      failNext=true;
      change(0,{unread:true});
      await waitFor(async()=> (await evaluate('window.inbox.snapshot()')).sessions.find(s=>s.id===states[0].id).unread===true);
      await badge(1);checks.push('transient shell failure leaves valid session snapshots intact and retries');
      change(0,{runtime:'approval'});
      await waitFor(async()=> (await evaluate('window.inbox.snapshot()')).sessions.find(s=>s.id===states[0].id).runtime==='approval');
      assert.equal(calls.at(-1).count,1);checks.push('Unread plus approval counted once');
      change(1,{runtime:'input'});await badge(2);
      change(2,{runtime:'approval'});await badge(3);checks.push('input and approval increase count 1 → 2 → 3');
      await evaluate(`document.querySelector('#status-filter').value='running';document.querySelector('#status-filter').dispatchEvent(new Event('change'));`);
      assert.equal(await evaluate(`document.querySelectorAll('.session-card').length`),0);
      assert.equal(calls.at(-1).count,3);checks.push('status filter does not change badge');
      await evaluate(`document.querySelector('#status-filter').value='all';document.querySelector('#status-filter').dispatchEvent(new Event('change'));`);
      await waitFor(async()=> await evaluate(`document.querySelector('.more')!==null`));
      await evaluate(`document.querySelector('.more').click()`);
      change(3,{unread:true});await badge(4);
      assert.equal(await evaluate(`document.querySelector('#session-menu').hidden`),false);
      checks.push('native update continues while menu pauses renderer polling');
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
      change(3,{unread:false});await badge(3);
      change(0,{runtime:'idle',unread:false});await badge(2);
      change(1,{runtime:'idle'});await badge(1);
      change(2,{runtime:'idle'});await badge(0);
      assert.deepEqual(calls.at(-1),{count:0,description:'',hidden:true});checks.push('3 → 2 → 1 → zero removes native overlay');
      for(const state of states){state.unread=true;state.runtime='idle';snapshot(state);}
      await badge(100);assert.match(calls.at(-1).description,/^100 /);checks.push('100 conversations use 99+ artwork with exact count description');
      for(let i=0;i<30;i++)change(i,{unread:false});await badge(70);checks.push('99+ updates back to 70');
      server.close();peer.destroy();await badge(0);
      assert.equal(calls.at(-1).hidden,true);checks.push('source disconnect clears stale badge');
      writeFileSync(path.join(process.env.AGENT_INBOX_BADGE_QA_OUTPUT,'verification.json'),JSON.stringify({checks,nativeCalls:calls},null,2));
      console.log(JSON.stringify({nativeOverlay:true,simulatedProvider:true,checks},null,2));
      app.quit();
    }catch(error){console.error(error);app.exit(1);}
  });
});

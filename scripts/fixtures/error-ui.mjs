import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { app } from 'electron';
import '../../src/main.js';

// Test-only provider. The real main, preload, renderer and model remain in use.
app.setPath('userData', process.env.AGENT_INBOX_TEST_PROFILE);
app.disableHardwareAcceleration();
const id = '00000000-0000-4000-8000-000000000001';
let peer;
let revision = 0;
let current = 'systemError';
let unread = false;
let respondToFollowing = true;
let followRequests = 0;
function send(message) {
  const payload = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  peer.write(Buffer.concat([header, payload]));
}
function change(value, version = 13) {
  send({ type: 'broadcast', method: 'thread-stream-state-changed', version,
    sourceClientId: 'simulated-owner', params: { hostId: 'local', conversationId: id, change: value } });
}
function snapshot() {
  change({ type: 'snapshot', revision: ++revision, conversationState: {
    threadRuntimeStatus: { type: current, activeFlags: [] }, hasUnreadTurn: unread, requests: [], turns: [],
  } });
}
function patch(type, whole = false) {
  current = type;
  change({ type: 'patches', baseRevision: revision, revision: ++revision, patches: [{
    op: 'replace', path: whole ? ['threadRuntimeStatus'] : ['threadRuntimeStatus', 'type'],
    value: whole ? { type, activeFlags: [] } : type,
  }] });
}
const server = createServer(socket => {
  peer = socket;
  let pending = Buffer.alloc(0);
  socket.on('error', () => {});
  socket.on('data', chunk => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 4 && pending.length >= pending.readUInt32LE() + 4) {
      const size = pending.readUInt32LE();
      const message = JSON.parse(pending.subarray(4, size + 4));
      pending = pending.subarray(size + 4);
      if (message.method === 'initialize') send({ type: 'response', requestId: message.requestId,
        resultType: 'success', result: { clientId: 'simulated-observer' } });
      if (message.method === 'thread-stream-following-changed' && message.params.following) {
        followRequests++;
        // Drop the initial reply while keeping the pipe connected.
        if (followRequests > 1 && respondToFollowing) snapshot();
      }
    }
  });
});
server.on('error', error => { console.error(error); app.exit(1); });
server.listen(process.env.AGENT_INBOX_CODEX_PIPE);

app.on('browser-window-created', (_, window) => {
  window.hide();
  window.webContents.once('did-finish-load', async () => {
    const evaluate = code => window.webContents.executeJavaScript(code);
    async function waitFor(code, timeoutMs = 5_000) {
      for (let attempt = 0; attempt < timeoutMs / 50; attempt++) {
        if (await evaluate(code)) return;
        await delay(50);
      }
      throw new Error(`UI condition timed out: ${code}`);
    }
    const filter = value => evaluate(`document.querySelector('#status-filter').value = ${JSON.stringify(value)};
      document.querySelector('#status-filter').dispatchEvent(new Event('change'));`);
    const checks = [];
    const capture = async name => {
      // A hidden Windows surface may not have a capturable frame.
      window.showInactive();
      try {
        await delay(150);
        writeFileSync(path.join(process.env.AGENT_INBOX_MONITORING_QA_OUTPUT, `${name}.png`),
          (await window.webContents.capturePage()).toPNG());
      } finally { window.hide(); }
    };
    const monitoringIs = status => `document.querySelector('#monitoring-status').dataset.status === '${status}'`;
    try {
      await waitFor(`document.querySelector('.runtime-unknown') !== null && document.querySelector('#running-count').textContent === '—'`);
      checks.push('missing initial snapshot: connected UI remains Unknown without guessing Running');
      assert.equal(await evaluate(`document.querySelector('#monitoring-label').textContent`), 'Connecting…');
      await waitFor(`document.querySelectorAll('.session-card .runtime-error').length === 1`, 15_000);
      assert.ok(followRequests >= 2);
      await waitFor(monitoringIs('connected'));
      assert.equal(await evaluate(`document.querySelector('#monitoring-detail').hidden`), true);
      await capture('connected');
      checks.push('initial snapshot retry: UI recovers automatically without restarting');
      assert.equal(await evaluate(`document.querySelector('.runtime-error').textContent`), 'Error');
      assert.equal(await evaluate(`document.querySelectorAll('.session-card .badge').length`), 1);
      const color = await evaluate(`getComputedStyle(document.querySelector('.runtime-error')).color`);
      const expectedColor = await evaluate(`(() => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--red)';
        document.body.append(probe);
        const result = getComputedStyle(probe).color;
        probe.remove();
        return result;
      })()`);
      assert.equal(color, expectedColor);
      checks.push('snapshot: red Error badge in Inbox');
      await filter('error');
      assert.equal(await evaluate(`document.querySelectorAll('.session-card').length`), 1);
      await filter('running');
      assert.equal(await evaluate(`document.querySelectorAll('.session-card').length`), 0);
      await filter('all');
      checks.push('Error filter includes the session; Running filter excludes it');
      await evaluate(`document.querySelector('[data-view="all"]').click()`);
      await waitFor(`document.querySelectorAll('.session-row .runtime-error').length === 1`);
      checks.push('Error badge in All sessions');
      await evaluate(`document.querySelector('[data-view="inbox"]').click()`);
      patch('active');
      await waitFor(`document.querySelectorAll('.session-card .runtime-running').length === 1`);
      await filter('error');
      assert.equal(await evaluate(`document.querySelectorAll('.session-card').length`), 0);
      await filter('all');
      checks.push('type patch: Error recovers to Running and leaves Error filter');
      patch('systemError', true);
      await waitFor(`document.querySelectorAll('.session-card .runtime-error').length === 1`);
      patch('idle', true);
      await waitFor(`document.querySelectorAll('.session-card').length === 0`);
      checks.push('whole-status patches: Error returns, then Idle/read leaves Inbox');
      unread = true;
      current = 'systemError';
      snapshot();
      await waitFor(`document.querySelectorAll('.session-card .runtime-error').length === 1 && document.querySelector('#unread-count').textContent === '01'`);
      assert.equal(await evaluate(`document.querySelectorAll('.session-card .badge').length`), 1);
      checks.push('Error plus unread: one Error badge and independent unread count');

      respondToFollowing = false;
      change({ type: 'snapshot', revision: ++revision, conversationState: {} }, 99);
      await waitFor(monitoringIs('unavailable'));
      assert.equal(await evaluate(`document.querySelector('#monitoring-label').textContent`), 'Monitoring unavailable');
      assert.match(await evaluate(`document.querySelector('#monitoring-detail').textContent`), /coding agent/);
      assert.equal(await evaluate(`document.querySelector('#monitoring-status').getAttribute('aria-describedby')`), 'monitoring-detail');
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.monitoring-warning')).display`), 'block');
      const layout = () => evaluate(`(() => {
        const badge = document.querySelector('#monitoring-status').getBoundingClientRect();
        const title = document.querySelector('.overview > div').getBoundingClientRect();
        const overview = document.querySelector('.overview').getBoundingClientRect();
        const detail = document.querySelector('#monitoring-detail').getBoundingClientRect();
        const summary = document.querySelector('.summary').getBoundingClientRect();
        return { belowTitle:detail.top >= overview.bottom, aboveCounts:detail.bottom <= summary.top,
          noOverlap:title.right <= badge.left, fits:document.body.scrollWidth <= window.innerWidth,
          warningColor:getComputedStyle(document.querySelector('#monitoring-status')).color };
      })()`);
      for (const [name,width] of [['unsupported',600],['unsupported-narrow',350]]) {
        window.setSize(width,740);
        await delay(100);
        const result = await layout();
        assert.equal(result.belowTitle,true);assert.equal(result.aboveCounts,true);
        assert.equal(result.noOverlap,true);assert.equal(result.fits,true);
        assert.equal(result.warningColor,expectedColor);
        await capture(name);
      }
      window.setSize(600,740);
      checks.push('unsupported protocol: red warning and actionable detail above counts fit 600px and 350px');
      respondToFollowing = true;
      snapshot();
      await waitFor(monitoringIs('connected'));
      assert.equal(await evaluate(`document.querySelector('#monitoring-detail').hidden`),true);
      assert.equal(await evaluate(`document.querySelector('#monitoring-detail').textContent`),'');
      checks.push('supported snapshot: monitoring recovers and clears previous error information');
      current = 'notLoaded';
      unread = false;
      await evaluate(`document.querySelector('[data-view="all"]').click()`);
      snapshot();
      await waitFor(`document.querySelector('.runtime-unknown') !== null`);
      assert.equal(await evaluate(monitoringIs('connected')),true);
      checks.push('an unloaded Unknown session does not flag a monitoring failure');
      await evaluate(`document.querySelector('[data-view="inbox"]').click()`);

      const alterSchema = sql => {
        const database = new DatabaseSync(path.join(process.env.AGENT_INBOX_CODEX_HOME,'state_5.sqlite'));
        try { database.exec(sql); } finally { database.close(); }
      };
      alterSchema('ALTER TABLE threads RENAME TO hidden_threads');
      await evaluate('window.inbox.snapshot()');
      await waitFor(monitoringIs('unavailable'));
      assert.match(await evaluate(`document.querySelector('#monitoring-detail').textContent`),/data format/);
      alterSchema('ALTER TABLE hidden_threads RENAME TO threads');
      current = 'idle';
      await evaluate('window.inbox.snapshot()');
      await waitFor(monitoringIs('connected'));
      checks.push('incompatible database: the source reason is visible and clears after schema recovery');

      current = 'active';
      snapshot();
      await waitFor(`document.querySelector('.session-card .runtime-running') !== null && document.querySelector('#running-count').textContent === '01'`);
      // The owner becomes idle, but its runtime patch is deliberately omitted.
      current = 'idle';
      unread = false;
      send({ type: 'broadcast', method: 'thread-read-state-changed', version: 3,
        sourceClientId: 'simulated-owner', params: { hostId: 'local', conversationId: id, hasUnreadTurn: false } });
      await waitFor(`document.querySelectorAll('.session-card').length === 0 && document.querySelector('#running-count').textContent === '00'`);
      checks.push('read event resyncs a missed Idle update; Running clears from card and counter');

      current = 'active';
      snapshot();
      await waitFor(`document.querySelector('.session-card .runtime-running') !== null`);
      current = 'idle';
      unread = true;
      change({ type: 'patches', baseRevision: revision, revision: ++revision,
        patches: [{ op: 'replace', path: ['hasUnreadTurn'], value: true }] });
      await waitFor(`document.querySelector('.session-card .unread') !== null && document.querySelector('#running-count').textContent === '00'`);
      checks.push('unread-only patch resyncs missed Idle; card becomes Unread and Running count is zero');

      current = 'active';
      unread = false;
      snapshot();
      await waitFor(`document.querySelector('.session-card .runtime-running') !== null`);
      current = 'idle';
      unread = true;
      await waitFor(`document.querySelector('.session-card .unread') !== null && document.querySelector('#running-count').textContent === '00'`, 15_000);
      checks.push('periodic snapshot recovers a missed Idle update even without read notifications');

      await evaluate(`document.querySelector('[data-view="all"]').click()`);
      current = 'active';
      unread = false;
      snapshot();
      await waitFor(`document.querySelector('.session-row .runtime-running') !== null`);
      respondToFollowing = false;
      await waitFor(`document.querySelector('.session-row .runtime-unknown') !== null && document.querySelector('#running-count').textContent === '—'`, 20_000);
      checks.push('silent provider: cached Running expires to Unknown; counter becomes unavailable');
      await waitFor(monitoringIs('reconnecting'));
      assert.match(await evaluate(`document.querySelector('#monitoring-detail').textContent`), /current session state/);
      await capture('waiting-for-state');
      respondToFollowing = true;
      current = 'systemError';
      unread = true;
      snapshot();
      await waitFor(`document.querySelector('.session-row .runtime-error') !== null`);
      await evaluate(`document.querySelector('[data-view="all"]').click()`);
      // Leave the listener available so the production reconnect path can recover.
      peer.destroy();
      await waitFor(`document.querySelectorAll('.session-row .runtime-unknown').length === 1`);
      assert.equal(await evaluate(`document.querySelectorAll('.runtime-error').length`), 0);
      assert.equal(await evaluate(`document.querySelector('#unread-count').textContent`), '—');
      checks.push('disconnect: Unknown replaces Error; unread becomes unavailable');
      await waitFor(monitoringIs('reconnecting'));
      assert.match(await evaluate(`document.querySelector('#monitoring-detail').textContent`), /connection|connect|retrying/i);
      await capture('disconnected');
      checks.push('disconnect: amber reconnecting badge explains the automatic retry');
      await waitFor(monitoringIs('connected'));
      assert.equal(await evaluate(`document.querySelector('#monitoring-detail').hidden`),true);
      server.close();
      peer.destroy();
      await waitFor(monitoringIs('reconnecting'));
      checks.push('reconnect: the warning clears on recovery and returns on a repeated disconnect');
      console.log(JSON.stringify({ simulated: true, checks }, null, 2));
      app.quit();
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
});
app.on('before-quit', () => { peer?.destroy(); server.close(); });
setTimeout(() => { console.error('Error UI check timed out.'); app.exit(1); }, 90_000).unref();

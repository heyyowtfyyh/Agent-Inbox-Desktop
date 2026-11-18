import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupByProject, monitoringView, viewOf } from '../src/model.js';

const session = (id, projectId, lastActivity, runtime = 'running') => ({
  id, projectId, project: projectId ?? 'Unassigned', lastActivity, runtime, unread: false,
});
const visible = (sessions, view = 'inbox', filter = 'all') => viewOf({
  sessions, runtimeAvailable: true, unreadAvailable: true,
}, view, filter).visible;

test('monitoring messages distinguish recovery from failures and clear stale details', () => {
  assert.deepEqual(monitoringView({status:'connected',code:'PIPE_ACCESS_DENIED'}),
    {status:'connected',label:'Monitoring',detail:''});
  assert.equal(monitoringView({status:'unavailable',code:'STREAM_VERSION_UNSUPPORTED'}).label,'Monitoring unavailable');
  assert.match(monitoringView({status:'unavailable',code:'STREAM_VERSION_UNSUPPORTED'}).detail,/coding agent/);
  assert.match(monitoringView({status:'unavailable',code:'PIPE_ACCESS_DENIED'}).detail,/permissions?|sandbox/);
  assert.match(monitoringView({status:'reconnecting',code:'PIPE_DISCONNECTED'}).detail,/retrying/i);
  assert.equal(monitoringView({status:'sample'}).label,'Sample data');
  assert.equal(monitoringView({status:'idle'}).detail,'');
  assert.equal(monitoringView({status:'unavailable',code:'private path or session text'}).detail.includes('private'),false);
  assert.equal(monitoringView({status:'unavailable',code:'toString'}).detail.includes('function'),false);
});

test('activity updates reorder sessions within projects without moving project groups', () => {
  const order = new Map();
  const initial = [session('a1', 'A', 30), session('b1', 'B', 20), session('a2', 'A', 10)];
  groupByProject(initial, order);
  const updated = visible([initial[0], { ...initial[1], lastActivity: 50 }, { ...initial[2], lastActivity: 40 }]);
  assert.deepEqual(updated.map(item => item.id), ['b1', 'a2', 'a1']);
  const groups = groupByProject(updated, order);
  assert.deepEqual([...groups.keys()], ['A', 'B']);
  assert.deepEqual(groups.get('A').sessions.map(item => item.id), ['a2', 'a1']);
});

test('filtering and view changes preserve project positions, including initially hidden projects', () => {
  const order = new Map();
  const sessions = [session('a', 'A', 30, 'idle'), session('b', 'B', 20), session('c', 'C', 10, 'error')];
  groupByProject(sessions, order);
  assert.deepEqual([...groupByProject(visible(sessions), order).keys()], ['B', 'C']);
  assert.deepEqual([...groupByProject(visible(sessions, 'inbox', 'error'), order).keys()], ['C']);
  assert.deepEqual([...groupByProject(visible([...sessions].reverse(), 'all'), order).keys()], ['A', 'B', 'C']);
  assert.deepEqual([...groupByProject(visible(sessions), order).keys()], ['B', 'C']);
});

test('new projects append and returning projects retain their original positions', () => {
  const order = new Map();
  const a = session('a', 'A', 20);
  const b = session('b', 'B', 10);
  groupByProject([a, b], order);
  assert.deepEqual([...groupByProject([b], order).keys()], ['B']);
  const updated = visible([session('c', 'C', 50), b, { ...a, lastActivity: 40 }]);
  assert.deepEqual([...groupByProject(updated, order).keys()], ['A', 'B', 'C']);
});

test('project identity uses the full key, including unassigned and matching display names', () => {
  const order = new Map();
  const sessions = [
    { ...session('a', 'first-path', 30), project: 'same-name' },
    session('b', null, 20),
    { ...session('c', 'second-path', 10), project: 'same-name' },
  ];
  groupByProject(sessions, order);
  const groups = groupByProject([...sessions].reverse(), order);
  assert.deepEqual([...groups.keys()], ['first-path', null, 'second-path']);
  assert.equal(groups.size, 3);
});

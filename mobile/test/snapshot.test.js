// node --test test/  (made-up people and posts, laid out the way the records table keeps them)
const test = require('node:test');
const assert = require('node:assert');
const { buildSnapshot, floorboardSnapshot, dkey, DAY } = require('../src/snapshot');

// a Wednesday at 10:00, so weekday everyday tasks fall on it
const NOW = new Date(2026, 10, 4, 10, 0).getTime(), TODAY = dkey(NOW), YESTERDAY = dkey(NOW - DAY), TOMORROW = dkey(NOW + DAY);
const rec = (coll, id, data) => ({ coll, id, data });
const post = (id, no, o) => rec('posts', id, { id, no, title: 'Post ' + no, type: 'task', level: 'green', author: 'u2', createdAt: NOW - no * 1000, toUsers: ['u1'], toDepts: [], closed: false, ...o });
const rcp = (postId, user, o) => rec('rcp', postId + '|' + user, { post: postId, user, status: 'todo', pct: 0, ...o });

const records = [
  rec('meta', 'store', { store: 'Test store' }),
  rec('depts', 'fin', { id: 'fin', name: 'Finance', features: { planner: true } }),
  rec('depts', 'shop', { id: 'shop', name: 'Shop floor', features: {} }),
  rec('users', 'u1', { id: 'u1', name: 'Alex Tester', role: 'staff', depts: ['fin'], manages: [] }),
  rec('users', 'u2', { id: 'u2', name: 'Sam Manager', role: 'manager', depts: ['fin'], manages: ['fin'] }),
  rec('users', 'u3', { id: 'u3', name: 'Lee Floor', role: 'staff', depts: ['shop'], manages: [] }),
  rec('users', 'u4', { id: 'u4', name: 'Gone Person', role: 'staff', depts: ['shop'], manages: [], active: false }),
  // waiting on u1: an amber task due tomorrow, an overdue red one, a done one, a closed one, and an approval already decided
  post('p1', 1001, { level: 'amber', due: TOMORROW }), rcp('p1', 'u1'),
  post('p2', 1002, { level: 'red', due: YESTERDAY }), rcp('p2', 'u1', { pct: 50 }),
  post('p3', 1003, {}), rcp('p3', 'u1', { status: 'done', updatedAt: NOW - 3600000 }),
  post('p4', 1004, { closed: true }), rcp('p4', 'u1'),
  post('p5', 1005, { type: 'approval', level: 'amber', approval: { approvers: ['u1', 'u2'], rule: 'any' } }), rcp('p5', 'u1'), rcp('p5', 'u2', { decision: 'approve', status: 'done' }),
  post('p6', 1006, { type: 'feedback' }), rcp('p6', 'u1'),
  // My week: two everyday tasks (one ticked today), a task for today, one for tomorrow, and a month-end job every Wednesday
  rec('plans', 'u1', { staples: [{ id: 's1', title: 'Read email' }, { id: 's2', title: 'Bank recons' }, { id: 's3', title: 'Weekend only', days: [0, 6] }] }),
  rec('ptasks', 't1', { id: 't1', user: 'u1', date: TODAY, title: 'Supplier payments', by: 'u2', at: 1 }),
  rec('ptasks', 't2', { id: 't2', user: 'u1', date: TOMORROW, title: 'Not today', by: 'u1', at: 2 }),
  rec('pdone', 'u1|' + TODAY + '|s1', { user: 'u1', date: TODAY, task: 's1', done: true }),
  rec('deadlines', 'dl1', { id: 'dl1', list: 'Debtors', title: 'Age analysis', owners: ['u1'], repeat: 'weekly', day: 3 }),
  rec('dltick', 'dl1|' + TODAY + '|u1', { dl: 'dl1', key: TODAY + '|u1', by: 'u1', at: NOW }),
];

test('Needs you: counts and order match the web app', () => {
  const s = buildSnapshot(records, 'u1', NOW);
  assert.equal(s.state, 'ok');
  assert.equal(s.store, 'Test store');
  assert.deepEqual(s.needs, { total: 3, red: 1, amber: 1, green: 1, overdue: 1 });
  assert.deepEqual(s.top.map((p) => p.id), ['p2', 'p1', 'p6']); // ASAP first, then Important, then General
  assert.equal(s.top[0].overdue, true);
  assert.equal(s.top[0].from, 'Sam');
  assert.equal(s.top[0].link, 'floorboard://go?to=post%3Ap2');
});

test('My week: today only, ticks kept, still-to-do first', () => {
  const w = buildSnapshot(records, 'u1', NOW).week;
  // Read email (done), Bank recons, Supplier payments, overdue tagged p2, tagged p1 due tomorrow is not today, done p3 today, Age analysis (done)
  assert.deepEqual(w.items.map((x) => x.key), ['t-s2', 't-t1', 'p-p2', 't-s1', 'p-p3', 'm-dl1']);
  assert.equal(w.total, 6);
  assert.equal(w.done, 3);
  assert.equal(w.items.find((x) => x.key === 'p-p2').late, true);
  assert.equal(w.items.find((x) => x.key === 't-t1').sub, 'from Sam');
  assert.equal(w.items.find((x) => x.key === 'm-dl1').link, 'floorboard://go?to=view%3Amonthend');
});

test('no My week list for someone whose department has it off', () => {
  const s = buildSnapshot(records, 'u3', NOW);
  assert.equal(s.state, 'ok');
  assert.equal(s.week, null);
  assert.equal(s.needs.total, 0);
});

test('a removed person or an unknown id shows as gone', () => {
  assert.equal(buildSnapshot(records, 'u4', NOW).state, 'gone');
  assert.equal(buildSnapshot(records, 'nobody', NOW).state, 'gone');
});

test('the string version the iPhone widget calls', () => {
  assert.equal(JSON.parse(floorboardSnapshot(JSON.stringify(records), 'u1', NOW)).needs.total, 3);
  assert.equal(JSON.parse(floorboardSnapshot('not json', 'u1', NOW)).state, 'error');
});

// What the home-screen widget shows for one person, worked out from the store's records the same way the web app does
// (source/floorboard.html: needsMe, sortNeeds, dayList, taggedFor, deadlinesFor). Keep the two in step.
// Plain JavaScript with no imports: the app and the Android widget require() it, and the iPhone widget runs this same
// file in JavaScriptCore (scripts/embed-snapshot.js copies it into targets/widget/SnapshotSource.swift).

var SNAPSHOT_COLLS = ['meta', 'users', 'depts', 'posts', 'rcp', 'plans', 'ptasks', 'pdone', 'deadlines', 'dltick'];

var DAY = 86400000, HOUR = 3600000;
var LEVEL_RANK = { red: 0, amber: 1, green: 2 };
var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var pad = function (n) { return String(n).padStart(2, '0'); };
var dkey = function (t) { var d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
var keyToDate = function (k) { var p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
var dowOf = function (k) { return keyToDate(k).getDay(); };
var firstName = function (u) { return u ? String(u.name || '').split(' ')[0] : ''; };
// a link the widget opens: floorboard://go?to=post:p1047 opens the web app at #go-post:p1047
var link = function (to) { return 'floorboard://go?to=' + encodeURIComponent(to); };

// the records as the web app's fromRecs() puts them together, for just the parts the widget needs
function assemble(records) {
  var by = {};
  records.forEach(function (r) { (by[r.coll] = by[r.coll] || []).push(r); });
  var of = function (c) { return (by[c] || []).map(function (r) { return r.data; }); };
  var meta = (by.meta || []).filter(function (r) { return r.id === 'store'; })[0];
  var db = { store: meta && meta.data.store || '', users: of('users'), depts: of('depts'), plans: {}, ptasks: of('ptasks'), pdone: {} };
  (by.plans || []).forEach(function (r) { db.plans[r.id] = r.data; });
  (by.pdone || []).forEach(function (r) { db.pdone[r.id] = r.data; });
  var dls = {};
  db.deadlines = of('deadlines').map(function (x) { var d = Object.assign({}, x, { done: {} }); dls[x.id] = d; return d; });
  (by.dltick || []).forEach(function (r) { var x = r.data, t = dls[x.dl]; if (t) { var v = Object.assign({}, x); delete v.dl; delete v.key; t.done[x.key] = v; } });
  var posts = {};
  db.posts = of('posts').map(function (p) { var q = Object.assign({}, p, { recips: {} }); posts[p.id] = q; return q; });
  (by.rcp || []).forEach(function (r) { var x = r.data, p = posts[x.post]; if (p) { var v = Object.assign({}, x); delete v.post; delete v.user; p.recips[x.user] = v; } });
  return db;
}

function apState(p) {
  var a = p.approval;
  if (!a) return 'waiting';
  var rs = a.approvers.map(function (id) { return p.recips[id]; }).filter(Boolean);
  if (rs.some(function (r) { return r.decision === 'reject'; })) return 'rejected';
  var yes = rs.filter(function (r) { return r.decision === 'approve'; }).length;
  if (a.rule === 'all' ? rs.length > 0 && yes === rs.length : yes > 0) return a.paidAt ? 'paid' : 'approved';
  var req = p.recips[p.author];
  return req && req.answer && req.status !== 'done' ? 'query' : 'waiting';
}
var apOpen = function (p) { var s = apState(p); return s === 'waiting' || s === 'query'; };

function needsMe(p, id, today) {
  var r = p.recips[id]; if (!r || p.closed) return false;
  if (p.type === 'vote' && p.poll && p.poll.closes && p.poll.closes < today) return false;
  if (p.type === 'approval' && !r.answer && !r.paid && !r.rejected && !apOpen(p)) return false;
  return r.status !== 'done';
}
function isOverdue(p, id, today) {
  if (!p.due || p.closed || p.due >= today) return false;
  if (p.type === 'approval' && !apOpen(p)) return false;
  var r = p.recips[id]; return !!r && r.status !== 'done';
}
function sortNeeds(id, today) {
  return function (a, b) {
    return ((LEVEL_RANK[a.level] == null ? 3 : LEVEL_RANK[a.level]) - (LEVEL_RANK[b.level] == null ? 3 : LEVEL_RANK[b.level]))
      || (isOverdue(b, id, today) - isOverdue(a, id, today)) || (a.due || '9999').localeCompare(b.due || '9999') || b.createdAt - a.createdAt;
  };
}

var featureOn = function (dept, key) { return !!(dept && dept.features && dept.features[key]); };
var plannerOn = function (db, u) { return db.depts.some(function (d) { return featureOn(d, 'planner') && (u.depts.indexOf(d.id) >= 0 || u.manages.indexOf(d.id) >= 0); }); };
var pkey = function (who, k, id) { return who + '|' + k + '|' + id; };
function dayList(db, who, k) {
  var dow = dowOf(k), staples = ((db.plans[who] || {}).staples || []).filter(function (s) { return (s.days || [1, 2, 3, 4, 5]).indexOf(dow) >= 0 && (!s.from || s.from <= k) && (!s.until || k < s.until); });
  var own = db.ptasks.filter(function (t) { return t.user === who && t.date === k; }).sort(function (a, b) { return a.at - b.at; });
  return staples.map(function (s) { return { id: s.id, title: s.title, staple: true }; })
    .concat(own.map(function (t) { return { id: t.id, title: t.title, by: t.by, staple: false }; }))
    .map(function (t) { t.st = db.pdone[pkey(who, k, t.id)] || {}; return t; });
}
function taggedFor(db, who, k, today) {
  return db.posts.filter(function (p) {
    if (p.type !== 'task' || p.closed || p.deadline || !p.recips[who] || p.author === who) return false;
    var r = p.recips[who];
    if (r.status === 'done') return !!r.updatedAt && dkey(r.updatedAt) === k;
    return (!p.due || p.due < today ? today : p.due) === k;
  }).sort(function (a, b) { return ((LEVEL_RANK[a.level] == null ? 3 : LEVEL_RANK[a.level]) - (LEVEL_RANK[b.level] == null ? 3 : LEVEL_RANK[b.level])) || a.createdAt - b.createdAt; });
}
function deadlinesFor(db, who, k) {
  var dow = dowOf(k);
  return db.deadlines.filter(function (dl) { return dl.owners.indexOf(who) >= 0 && (dl.repeat === 'daily' ? dow !== 0 && dow !== 6 : dl.repeat === 'weekly' ? dl.day === dow : dl.due === k); });
}
function meDoneFor(db, dl, who, k) {
  if ((dl.done || {})[k + '|*']) return true;
  var p = db.posts.filter(function (x) { return x.id === 'p-dl-' + dl.id + '-' + k; })[0], r = p && p.recips[who];
  if (r) return r.status === 'done';
  return !!(dl.done || {})[k + '|' + who];
}

// records: [{ coll, id, data }] from the records table; me: the signed-in person's staff id; now: milliseconds
function buildSnapshot(records, me, now) {
  var db = assemble(records), today = dkey(now), d = keyToDate(today);
  var u = db.users.filter(function (x) { return x.id === me && x.active !== false; })[0];
  var base = { v: 1, at: now, day: today, dayLabel: WD[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()], store: db.store, link: link('view:needs') };
  if (!u) return Object.assign(base, { state: 'gone' });
  u = Object.assign({ depts: [], manages: [] }, u);
  var userById = function (id) { return db.users.filter(function (x) { return x.id === id; })[0]; };

  var mine = db.posts.filter(function (p) { return needsMe(p, me, today); }).sort(sortNeeds(me, today));
  var count = function (l) { return mine.filter(function (p) { return p.level === l; }).length; };
  var needs = { total: mine.length, red: count('red'), amber: count('amber'), green: count('green'), overdue: mine.filter(function (p) { return isOverdue(p, me, today); }).length };
  var top = mine.slice(0, 5).map(function (p) {
    return { id: p.id, no: p.no || null, title: p.title || '', level: p.level || 'green', type: p.type, overdue: isOverdue(p, me, today), from: firstName(userById(p.author)), link: link('post:' + p.id) };
  });

  var week = null;
  if (plannerOn(db, u)) {
    var items = [];
    dayList(db, me, today).forEach(function (t) {
      var by = t.by && t.by !== me ? userById(t.by) : null;
      items.push({ key: 't-' + t.id, kind: t.staple ? 'everyday' : 'task', title: t.title, done: !!t.st.done, late: false, sub: by ? 'from ' + firstName(by) : t.staple ? 'Every day' : '', link: link('view:week') });
    });
    taggedFor(db, me, today, today).forEach(function (p) {
      var r = p.recips[me], from = firstName(userById(p.author));
      items.push({ key: 'p-' + p.id, kind: 'tagged', title: p.title || '', level: p.level || 'green', done: r.status === 'done', late: r.status !== 'done' && !!p.due && p.due < today,
        sub: ['#' + p.no, from && 'from ' + from].filter(Boolean).join(' · '), link: link('post:' + p.id) });
    });
    deadlinesFor(db, me, today).forEach(function (dl) {
      items.push({ key: 'm-' + dl.id, kind: 'monthend', title: dl.title || '', done: meDoneFor(db, dl, me, today), late: false, sub: 'Month end · ' + (dl.list || ''), link: link('view:monthend') });
    });
    var done = items.filter(function (x) { return x.done; }).length;
    // still to do first, then what's ticked off, the way the web app's Today list puts them
    week = { done: done, total: items.length, items: items.filter(function (x) { return !x.done; }).concat(items.filter(function (x) { return x.done; })), link: link('view:week') };
  }
  return Object.assign(base, { state: 'ok', me: { id: me, first: firstName(u) }, needs: needs, top: top, week: week });
}

// for the iPhone widget: JSON in, JSON out, so nothing has to cross between Swift and JavaScript but two strings
function floorboardSnapshot(recordsJson, me, now) {
  try { return JSON.stringify(buildSnapshot(JSON.parse(recordsJson), me, now)); } catch (e) { return JSON.stringify({ v: 1, state: 'error', error: String(e && e.message || e) }); }
}

if (typeof module !== 'undefined') module.exports = { SNAPSHOT_COLLS: SNAPSHOT_COLLS, buildSnapshot: buildSnapshot, floorboardSnapshot: floorboardSnapshot, dkey: dkey, DAY: DAY, HOUR: HOUR };

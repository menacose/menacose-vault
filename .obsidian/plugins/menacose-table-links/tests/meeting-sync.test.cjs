'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcile, freeze, connect, bind, tableBlocks, MeetingSync, SOURCES } = require('../meeting-sync');
const tick = String.fromCharCode(96).repeat(3);
const path = '03_Meetings/03.01_Board-Meetings/Meeting Agenda and MoMs 20261025.md';
const encode = data => tick + 'smart-table\n' + JSON.stringify(data) + '\n' + tick;
const decode = text => tableBlocks(text)[0].data;
const col = id => ({ id, name: id, type: ['owner', 'status'].includes(id) ? 'select' : 'text', options: [] });
function setup() {
  const actions = { columns: ['action', 'related_work', 'owner', 'due_date', 'status', 'notes'].map(col),
    rows: [{ id: 'a1', cells: { action: 'Send survey', related_work: 'Survey', owner: 'Omar',
      due_date: '2026-10-25', status: 'In Progress', notes: 'Draft' } }] };
  const work = { columns: ['work', 'type', 'areas', 'owner', 'target_date', 'status', 'milestone'].map(col),
    rows: [{ id: 'w1', cells: { work: '[[04_Projects/Survey|Survey]]', type: 'Project', areas: 'Programs',
      owner: 'Mohamed', target_date: '', status: 'Active', milestone: 'Review draft' } }] };
  const review = { columns: ['item', 'kind', 'related_work', 'owner', 'due_date', 'status', 'update'].map(col),
    rows: [], menacoseSync: { version: 1, role: 'review', active: true, meeting: path,
      bindings: {}, known: ['actions:a1', 'work:w1'] } };
  bind(review, 'actions', actions.rows[0]); bind(review, 'work', work.rows[0]);
  const commitments = { columns: review.columns.filter(c => c.id !== 'kind'),
    rows: [{ id: 'blank', cells: { item: '', owner: 'TBD', due_date: '', status: 'TBD' } }],
    menacoseSync: { version: 1, role: 'commitments', active: true, meeting: path, bindings: {} } };
  return { actions, work, review, commitments,
    sources: { actions: encode(actions), work: encode(work) } };
}
const meeting = f => 'Before\n\n' + encode(f.review) + '\n\nBetween\n\n' + encode(f.commitments) + '\n\nAfter';
test('meeting and register edits merge by field; a second sync is idempotent', () => {
  const f = setup();
  f.review.rows[0].cells.due_date = '2026-11-01';
  f.actions.rows[0].cells.owner = 'Bassem';
  f.sources.actions = encode(f.actions);
  const result = reconcile(meeting(f), f.sources, path);
  assert.equal(decode(result.sources.actions).rows[0].cells.due_date, '2026-11-01');
  assert.equal(decode(result.meeting).rows[0].cells.owner, 'Bassem');
  const again = reconcile(result.meeting, result.sources, path);
  assert.equal(again.meeting, result.meeting);
  assert.deepEqual(again.sources, result.sources);
  assert.deepEqual(result.issues, []);
});
test('project and action ownership/status stay distinct', () => {
  const f = setup();
  f.review.rows[0].cells.status = 'Completed';
  f.review.rows[1].cells.status = 'Blocked';
  const result = reconcile(meeting(f), f.sources, path);
  assert.equal(decode(result.sources.actions).rows[0].cells.status, 'Completed');
  assert.equal(decode(result.sources.work).rows[0].cells.status, 'Blocked');
  assert.equal(decode(result.sources.work).rows[0].cells.owner, 'Mohamed');
});
test('a filled commitment creates one action; a blank or partial placeholder creates none', () => {
  const f = setup();
  f.commitments.rows[0].cells.owner = 'Omar';
  let result = reconcile(meeting(f), f.sources, path);
  assert.equal(decode(result.sources.actions).rows.length, 1);
  const blocks = tableBlocks(result.meeting);
  f.review = blocks[0].data; f.commitments = blocks[1].data; f.sources = result.sources;
  f.commitments.rows[0].cells.item = 'Invite speakers';
  f.commitments.rows[0].cells.related_work = '[[07_Communications/Expert Talks Operations|Expert Talks Operations]]';
  result = reconcile(meeting(f), f.sources, path);
  const created = decode(result.sources.actions).rows[1];
  assert.equal(created.cells.action, 'Invite speakers');
  assert.equal(created.cells.related_work, 'Expert Talks Operations');
  assert.equal(created.cells.owner, 'Omar');
  assert.equal(decode(result.meeting).rows.length, 2, 'New commitment should not also appear in the review.');
  const again = reconcile(result.meeting, result.sources, path);
  assert.equal(decode(again.sources.actions).rows.length, 2);
  assert.equal(again.meeting, result.meeting);
});
test('new register rows appear in the review; removing a view never deletes register rows', () => {
  const f = setup();
  f.actions.rows.push({ id: 'a2', cells: { action: 'New from register', owner: 'Omar', status: 'Pending' } });
  f.sources.actions = encode(f.actions);
  let result = reconcile(meeting(f), f.sources, path);
  const review = decode(result.meeting);
  assert.equal(review.rows.length, 3);
  review.rows = review.rows.filter(row => row.id !== 'sync-actions-a1');
  const blocks = tableBlocks(result.meeting);
  const removed = result.meeting.replace(blocks[0].raw, encode(review));
  result = reconcile(removed, result.sources, path);
  assert.equal(decode(result.sources.actions).rows.length, 2);
  assert(!decode(result.meeting).rows.some(r => r.id === 'sync-actions-a1'));
});
test('concurrent edits of the same cell retain both values and report a conflict', () => {
  const f = setup();
  f.review.rows[0].cells.owner = 'Bassem';
  f.actions.rows[0].cells.owner = 'Moataz';
  f.sources.actions = encode(f.actions);
  let result = reconcile(meeting(f), f.sources, path);
  assert.equal(decode(result.meeting).rows[0].cells.owner, 'Bassem');
  assert.equal(decode(result.sources.actions).rows[0].cells.owner, 'Moataz');
  assert.equal(result.issues.length, 1);
  const review = decode(result.meeting);
  review.rows[0].cells.owner = 'Moataz';
  result = reconcile(result.meeting.replace(tableBlocks(result.meeting)[0].raw, encode(review)), result.sources, path);
  assert.deepEqual(result.issues, []);
});
test('frozen meetings, dated copies and unrelated content are protected', () => {
  const f = setup();
  const text = meeting(f);
  const frozen = freeze(text, path);
  f.actions.rows[0].cells.status = 'Completed';
  f.sources.actions = encode(f.actions);
  assert.equal(reconcile(frozen, f.sources, path).meeting, frozen);
  assert.equal(reconcile(text, f.sources, path.replace('20261025', '20261018_Update')).meeting, text);
  assert(frozen.startsWith('Before\n\n'));
  assert(frozen.endsWith('\n\nAfter'));
  assert.equal(freeze(frozen, path), frozen);
});
test('connecting an empty template loads open work, preserves a blank commitment row and never syncs the template file', () => {
  const f = setup();
  f.review.rows = [];
  f.review.menacoseSync.bindings = {};
  f.review.menacoseSync.active = false;
  const text = meeting(f);
  const prepared = connect(text, f.sources, path);
  assert.equal(decode(prepared).rows.length, 2);
  assert.equal(tableBlocks(prepared)[1].data.rows[0].cells.item, '');
  assert.equal(reconcile(text, f.sources, '99_Templates/Meeting Agenda and MoMs.md').meeting, text);
});
test('missing source rows do not erase meeting records or resurrect deleted actions', () => {
  const f = setup();
  f.actions.rows = [];
  f.sources.actions = encode(f.actions);
  const result = reconcile(meeting(f), f.sources, path);
  assert.equal(decode(result.meeting).rows.length, 2);
  assert.equal(decode(result.sources.actions).rows.length, 0);
  assert.equal(result.issues.length, 1);
});
test('source writes are guarded against a newer user edit; retry merges it safely', async () => {
  const f = setup();
  f.review.rows[0].cells.due_date = '2026-11-01';
  const store = new Map([[path, meeting(f)], [SOURCES.actions, f.sources.actions], [SOURCES.work, f.sources.work]]);
  let race = true, retries = 0;
  const vault = {
    getMarkdownFiles: () => [...store.keys()].map(path => ({ path })),
    getAbstractFileByPath: path => store.has(path) ? { path } : null,
    read: async file => store.get(file.path),
    process: async (file, fn) => {
      if (file.path === SOURCES.actions && race) {
        race = false;
        const data = decode(store.get(file.path));
        data.rows[0].cells.owner = 'Bassem';
        store.set(file.path, encode(data));
      }
      store.set(file.path, fn(store.get(file.path)));
    },
  };
  const engine = Object.assign(Object.create(MeetingSync.prototype), {
    app: { vault, workspace: {} }, alive: true, lastIssues: '',
    schedule: () => { retries++; }, notice: () => {},
  });
  assert.equal(await engine.syncAll(), false);
  assert.equal(retries, 1);
  assert.equal(store.get(path), meeting(f), 'Meeting baseline must not advance after a raced source write.');
  assert.equal(await engine.syncAll(), true);
  assert.equal(decode(store.get(SOURCES.actions)).rows[0].cells.owner, 'Bassem');
  assert.equal(decode(store.get(SOURCES.actions)).rows[0].cells.due_date, '2026-11-01');
  assert.equal(decode(store.get(path)).rows[0].cells.owner, 'Bassem');
});
test('connecting the next meeting freezes the previous minutes; finishing freezes current values', async () => {
  const f = setup(), nextPath = path.replace('20261025', '20261101');
  const template = setup();
  template.review.rows = []; template.review.menacoseSync.bindings = {};
  for (const data of [template.review, template.commitments]) {
    data.menacoseSync.active = false; data.menacoseSync.meeting = '';
  }
  const store = new Map([[path, meeting(f)], [nextPath, meeting(template)],
    [SOURCES.actions, f.sources.actions], [SOURCES.work, f.sources.work]]);
  const vault = {
    getMarkdownFiles: () => [...store.keys()].map(path => ({ path })),
    getAbstractFileByPath: path => store.has(path) ? { path } : null,
    read: async file => store.get(file.path),
    process: async (file, fn) => store.set(file.path, fn(store.get(file.path))),
  };
  const engine = Object.assign(Object.create(MeetingSync.prototype), {
    app: { vault, workspace: {} }, alive: true, lastIssues: '', queue: Promise.resolve(),
    schedule: () => {}, notice: () => {},
  });
  await engine.activate(nextPath);
  assert.equal(decode(store.get(path)).menacoseSync.active, false);
  assert.equal(decode(store.get(nextPath)).menacoseSync.active, true);
  const previous = store.get(path), source = decode(store.get(SOURCES.actions));
  source.rows[0].cells.status = 'Completed';
  store.set(SOURCES.actions, encode(source));
  assert.equal(await engine.syncAll(), true);
  assert.equal(store.get(path), previous);
  assert.equal(decode(store.get(nextPath)).rows[0].cells.status, 'Completed');
  await engine.finish(nextPath);
  const snapshot = store.get(nextPath);
  source.rows[0].cells.status = 'Blocked';
  store.set(SOURCES.actions, encode(source));
  await engine.syncAll();
  assert.equal(store.get(nextPath), snapshot);
});
test('finish saves the last editor change before syncing and freezing minutes', async () => {
  const f = setup(), store = new Map([[path, meeting(f)],
    [SOURCES.actions, f.sources.actions], [SOURCES.work, f.sources.work]]);
  f.review.rows[0].cells.due_date = '2026-11-08';
  let saved = false;
  const vault = {
    getMarkdownFiles: () => [...store.keys()].map(path => ({ path })),
    getAbstractFileByPath: path => store.has(path) ? { path } : null,
    read: async file => store.get(file.path),
    process: async (file, fn) => store.set(file.path, fn(store.get(file.path))),
  };
  const editor = { file: { path }, getMode: () => 'source',
    getViewData: () => meeting(f), save: async () => { saved = true; store.set(path, meeting(f)); } };
  const engine = Object.assign(Object.create(MeetingSync.prototype), {
    app: { vault, workspace: { getLeavesOfType: () => [{ view: editor }] } },
    alive: true, lastIssues: '', queue: Promise.resolve(), schedule: () => {}, notice: () => {},
  });
  await engine.finish(path);
  assert(saved);
  assert.equal(decode(store.get(SOURCES.actions)).rows[0].cells.due_date, '2026-11-08');
  assert.equal(decode(store.get(path)).rows[0].cells.due_date, '2026-11-08');
  assert.equal(decode(store.get(path)).menacoseSync.active, false);
});

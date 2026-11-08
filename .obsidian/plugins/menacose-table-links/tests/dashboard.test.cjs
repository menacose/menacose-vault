'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PATHS, properties, personKey, validDate, collect, summarize, dashboardHtml, Dashboard } = require('../dashboard');
const fence = String.fromCharCode(96).repeat(3);
const table = (field, rows) => fence + 'smart-table\n' + JSON.stringify({
  columns: [{ id: field }], rows: rows.map((cells, i) => ({ id: 'r' + i, cells })),
}) + '\n' + fence;
const person = (name, former = false, aliases = []) => ({ path: PATHS.people + name + '.md',
  text: '---\ntype: person\nrole: ' + (former ? 'Former Secretary' : 'Coordinator') +
    '\naliases: ' + JSON.stringify(aliases) + '\n---\n' });
const meeting = (date, checklist, extra = '', suffix = '') => ({
  path: PATHS.board + 'Meeting Agenda and MoMs ' + date.replaceAll('-', '') + suffix + '.md',
  text: '---\ndate: ' + date + '\n' + extra + '\n---\n\n## 1. Attendance\n\n' +
    checklist + '\n\n## 2. Progress\n- [x] Done task\n',
});
function sources(actions = [], work = [], activities = []) {
  return [{ path: PATHS.actions, text: table('action', actions) },
    { path: PATHS.work, text: table('work', work) },
    { path: PATHS.activities, text: table('activity', activities) }];
}
const model = docs => summarize(collect(docs), 'year', '2026-10-25');
test('duplicate meeting notes count once and an unchecked updated copy does not replace recorded attendance', () => {
  const result = model([person('Omar Hussein'), ...sources(),
    meeting('2026-10-18', '- [x] Omar Hussein ✅ 2026-10-18'),
    meeting('2026-10-18', '- [ ] Omar Hussein', '', '_Update')]);
  assert.equal(result.recordedMeetings, 1);
  assert.equal(result.meetingNotes, 1);
  assert.equal(result.people[0].present, 1);
  assert(result.issues.some(issue => /count as one/.test(issue.message)));
});
test('blank attendance lists, future notes and completed action checkboxes do not become attendance', () => {
  const result = model([person('Omar Hussein'), ...sources(),
    meeting('2026-10-18', '- [ ] Omar Hussein'),
    meeting('2026-11-01', '- [x] Omar Hussein ✅ 2026-11-01')]);
  assert.equal(result.recordedMeetings, 0);
  assert.equal(result.unrecordedMeetings, 1);
  assert.equal(result.people[0].listed, 0);
  assert.equal(result.people[0].present, 0);
});
test('explicitly confirmed zero attendance is different from unknown attendance', () => {
  const result = model([person('Omar Hussein'), ...sources(),
    meeting('2026-10-18', '- [ ] Omar Hussein', 'attendance confirmed: true')]);
  assert.equal(result.recordedMeetings, 1);
  assert.equal(result.people[0].listed, 1);
  assert.equal(result.people[0].present, 0);
});
test('aliases and honorifics match; former contacts are not counted as current team', () => {
  const result = model([person('Dr. Bassem Hassan', false, ['Bassem Hassan']), person('Hassan Eldeeb', true), ...sources(),
    meeting('2026-10-18', '- [x] [[Bassem Hassan]] ✅ 2026-10-18\n- [x] Hassan Eldeeb')]);
  assert.equal(result.people.length, 1);
  assert.equal(result.people[0].present, 1);
  assert.equal(result.participants, 1);
  assert.equal(personKey('**[[Dr. Bassem Hassan]]** ✅ 2026-10-18'), 'bassem hassan');
});
test('each person’s denominator contains only recorded meetings where that person was listed', () => {
  const result = model([person('Omar Hussein'), person('Mohamed Adel'), ...sources(),
    meeting('2026-10-04', '- [x] Omar Hussein\n- [ ] Mohamed Adel'),
    meeting('2026-10-18', '- [x] Omar Hussein')]);
  assert.equal(result.people.find(p => p.name === 'Omar Hussein').listed, 2);
  assert.equal(result.people.find(p => p.name === 'Mohamed Adel').listed, 1);
});
test('a dated filename takes precedence over an inconsistent property date and flags it', () => {
  const doc = meeting('2026-07-19', '- [x] Omar Hussein ✅ 2026-07-19');
  doc.text = doc.text.replace('date: 2026-07-19', 'date: 2026-07-05');
  const data = collect([person('Omar Hussein'), ...sources(), doc]);
  assert.equal(data.meetings[0].date, '2026-07-19');
  assert(data.issues.some(issue => /differs from/.test(issue.message)));
});
test('copied attendance completion dates are not counted as presence in a different meeting', () => {
  const result = model([person('Omar Hussein'), ...sources(),
    meeting('2026-10-18', '- [x] Omar Hussein ✅ 2026-10-11')]);
  assert.equal(result.people[0].present, 0);
  assert.equal(result.recordedMeetings, 0);
  assert(result.issues.some(issue => /another meeting/.test(issue.message)));
});
test('period boundaries are inclusive and do not filter the current workload', () => {
  const data = collect([person('Omar Hussein'),
    ...sources([{ action: 'An old open action', owner: 'Omar Hussein', status: 'In Progress', due_date: '2026-01-01' }]),
    meeting('2026-07-27', '- [x] Omar Hussein'), meeting('2026-07-28', '- [x] Omar Hussein'),
    meeting('2026-10-25', '- [x] Omar Hussein')]);
  const recent = summarize(data, '90days', '2026-10-25');
  assert.equal(recent.from, '2026-07-28');
  assert.equal(recent.recordedMeetings, 2);
  assert.equal(recent.delivery.overdue, 1);
  assert.equal(summarize(data, 'quarter', '2026-10-25').recordedMeetings, 1);
});
test('announced, planned, unknown and future editions do not become delivered activities', () => {
  const result = model([...sources([], [], [
    { activity: 'Announced Talk', date: '2026-09-01', status: 'TBD', attendees: 40 },
    { activity: 'Next Talk', date: '2026-11-01', status: 'Planned', attendees: '' },
    { activity: 'Future Held Error', date: '2026-11-02', status: 'Held', attendees: 20 },
  ])]);
  assert.equal(result.activities.held, 0);
  assert.equal(result.activities.visits, null);
  assert.equal(result.activities.upcoming.length, 1);
});
test('zero attendance is measurable; blanks are unknown; ratios use matched editions only', () => {
  const result = model([...sources([], [], [
    { activity: 'A', date: '2026-10-01', status: 'Held', series: 'Expert Talk', registrations: 100, attendees: 60 },
    { activity: 'B', date: '2026-10-02', status: 'Held', series: 'Expert Talk', registrations: '', attendees: 30 },
    { activity: 'C', date: '2026-10-03', status: 'Held', series: 'Expert Talk', registrations: 10, attendees: 0 },
    { activity: 'D', date: '2026-10-04', status: 'Held', series: 'Expert Talk', registrations: 20, attendees: '' },
  ])]);
  assert.equal(result.activities.held, 4);
  assert.equal(result.activities.measured, 3);
  assert.equal(result.activities.visits, 90);
  assert.equal(result.activities.paired, 2);
  assert.equal(result.activities.pairedAttendees, 60);
  assert.equal(result.activities.pairedRegistrations, 110);
});
test('invalid counts and whitespace are not converted to measured zero', () => {
  const result = model([...sources([], [], [-1, 2.5, false, ' '].map((attendees, i) =>
    ({ activity: 'Edition ' + i, date: '2026-10-01', status: 'Held', attendees })))]);
  assert.equal(result.activities.visits, null);
  assert.equal(result.activities.measured, 0);
});
test('duplicate activity links with different aliases count as one edition', () => {
  const result = model([...sources([], [], [
    { activity: '[[Events/A|Talk A]]', date: '2026-10-01', status: 'Held', attendees: 30 },
    { activity: '[[Events/A|Another Label]]', date: '2026-10-01', status: 'TBD', attendees: '' },
  ])]);
  assert.equal(result.activities.held, 1);
  assert.equal(result.activities.visits, 30);
});
test('canonical registers supply work totals; shared owners are not counted as everyone’s workload', () => {
  const docs = [person('Omar Hussein'), person('Mohamed Adel'), ...sources([
    { action: 'Shared', owner: 'All', status: 'Pending', due_date: '2026-10-25' },
    { action: 'Mine', owner: 'Omar Hussein', status: 'In Progress', due_date: '2026-10-24' },
    { action: 'Closed', owner: 'Omar Hussein', status: 'Completed', due_date: '2026-10-01' },
    { action: 'Cancelled', status: 'Cancelled' },
  ], [{ work: 'Project', type: 'Project', status: 'Blocked' }]),
  { path: PATHS.board + 'Meeting Agenda and MoMs 20261025.md',
    text: table('action', [{ action: 'Shared', owner: 'All', status: 'Pending' }]) }];
  const result = model(docs);
  assert.equal(result.delivery.open, 2);
  assert.equal(result.delivery.overdue, 1);
  assert.equal(result.delivery.dueSoon, 1);
  assert.equal(result.delivery.ownerNeeded, 1);
  assert.equal(result.delivery.blocked, 1);
  assert.equal(result.people[0].openActions, 1);
  assert.equal(result.people[1].openActions, 0);
});
test('missing structured sources show Not Recorded and source values cannot inject HTML', () => {
  const result = model([person('Omar Hussein')]);
  const html = dashboardHtml(result);
  assert.equal(result.availability.action, false);
  assert(html.includes('Not Recorded'));
  const injected = model([person('<img src=x onerror=alert(1)>'), ...sources([
    { action: '<script>alert(1)</script>', owner: 'All', status: 'Pending' },
  ])]);
  const safe = dashboardHtml(injected);
  assert(!safe.includes('<script>'));
  assert(!safe.includes('<img src=x'));
  assert(safe.includes('&lt;script&gt;'));
});
test('read-only refresh updates a newly detached dashboard and later source edits without writing', async () => {
  let docs = [person('Omar Hussein'), ...sources(), meeting('2026-10-18', '- [x] Omar Hussein')];
  let draws = 0;
  const state = { el: { isConnected: false }, period: 'year' };
  const instance = Object.assign(Object.create(Dashboard.prototype), {
    alive: true, serial: 0, views: new Set([state]),
    app: { vault: {
      getMarkdownFiles: () => docs.map(doc => ({ path: doc.path })),
      read: async file => docs.find(doc => doc.path === file.path).text,
      process: () => { throw Error('Dashboard must never write.'); },
      modify: () => { throw Error('Dashboard must never write.'); },
    } },
    draw: () => { draws++; },
  });
  await instance.refresh();
  assert.equal(draws, 1);
  assert.equal(instance.data.meetings.filter(m => m.recorded).length, 1);
  docs.push(meeting('2026-10-25', '- [x] Omar Hussein'));
  await instance.refresh();
  assert.equal(draws, 2);
  assert.equal(instance.data.meetings.filter(m => m.recorded).length, 2);
});
test('frontmatter scalars, aliases and date validity are parsed without inventing dates', () => {
  assert.deepEqual(properties('---\ntype: person\naliases:\n  - Bassem Hassan\nrole: "Vice President"\n---\n'),
    { type: 'person', aliases: ['Bassem Hassan'], role: 'Vice President' });
  assert.equal(validDate('2026-02-30'), '');
  assert.equal(validDate('2026-10-25T20:00:00'), '2026-10-25');
});

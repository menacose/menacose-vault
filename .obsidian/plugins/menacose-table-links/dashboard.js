'use strict';
const PATHS = {
  board: '03_Meetings/03.01_Board-Meetings/',
  people: '01_Governance/MENACOSE_People/',
  work: '04_Projects/Work Overview.md',
  actions: '04_Projects/Action Register.md',
  activities: '10_Programs/Activity Register.md',
};
const closed = status => /^(completed|cancelled)$/i.test(String(status || '').trim());
const plain = value => {
  const s = String(value ?? '').trim();
  const m = s.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
  return m ? m[2] || m[1].split('#')[0].split('/').pop().replace(/\.md$/i, '') : s;
};
function personKey(value) {
  return plain(String(value || '').replace(/\*\*/g, '').replace(/\s*(?:✅|❌).*$/, '')
    .replace(/\s+[-–—]\s*(?:absent|apolog|not attending).*$/i, '')
    .trim()).replace(/^(?:(?:dr|prof|eng)\.?\s+)+/i, '').trim().toLocaleLowerCase();
}
function properties(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const result = {}; let last;
  if (!m) return result;
  const value = raw => {
    const s = raw.trim();
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (/^\[/.test(s)) { try { return JSON.parse(s); } catch {} }
    return s.replace(/^(['"])([\s\S]*)\1$/, '$2');
  };
  for (const line of m[1].split('\n')) {
    const entry = line.match(/^([^ #:\t][^:]*):\s*(.*)$/);
    if (entry) { last = entry[1].trim().toLowerCase(); result[last] = value(entry[2]); }
    else if (last && /^\s+-\s+/.test(line)) {
      if (!Array.isArray(result[last])) result[last] = [];
      result[last].push(value(line.replace(/^\s+-\s+/, '')));
    }
  }
  return result;
}
function validDate(value) {
  const s = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const date = new Date(s + 'T12:00:00Z');
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === s ? s : '';
}
function todayDate(now = new Date()) {
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')].join('-');
}
function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function startDate(period, today) {
  if (period === 'quarter') {
    const month = Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1;
    return today.slice(0, 4) + '-' + String(month).padStart(2, '0') + '-01';
  }
  if (period === '90days') return addDays(today, -89);
  return period === 'all' ? '0000-01-01' : today.slice(0, 4) + '-01-01';
}
function tables(text) {
  const result = [];
  for (const match of String(text || '').matchAll(/^\x60{3}smart-table\s*\n([\s\S]*?)\n\x60{3}/gm)) {
    try {
      const data = JSON.parse(match[1]);
      if (Array.isArray(data.columns) && Array.isArray(data.rows)) result.push(data);
    } catch { /* Reported as a missing structured source below. */ }
  }
  return result;
}
function roster(docs) {
  return docs.filter(doc => doc.path.startsWith(PATHS.people)).map(doc => {
    const props = properties(doc.text);
    if (props.type !== 'person') return null;
    const name = doc.path.split('/').pop().replace(/\.md$/i, '');
    return { name, path: doc.path, role: props.role || '', former:
      /former|inactive/i.test(String(props.role_status || '') + ' ' + String(props.role || '')),
      keys: [...new Set([name, ...(Array.isArray(props.aliases) ? props.aliases : [])].map(personKey))] };
  }).filter(Boolean);
}
function attendance(doc, issues) {
  const props = properties(doc.text);
  const token = doc.path.match(/(\d{4})(\d{2})(\d{2})(?:_Update)?\.md$/i);
  const fromName = token ? validDate(token.slice(1).join('-')) : '';
  const fromProps = validDate(props['date & time'] || props.date);
  const date = fromName || fromProps;
  if (!date) { issues.push({ path: doc.path, message: 'Meeting date is missing or invalid.' }); return null; }
  if (fromName && fromProps && fromName !== fromProps)
    issues.push({ path: doc.path, message: 'Property date differs from the filename; statistics use ' + fromName + '.' });
  const lines = doc.text.split('\n');
  const header = lines.findIndex(line => /^#{1,6}\s+(?:\d+[.)]\s*)?(?:Attendance|Attendees)\s*$/i.test(line.trim()));
  const people = new Map();
  if (header >= 0) for (const line of lines.slice(header + 1)) {
    if (/^#{1,6}\s|^\s*---\s*$/.test(line)) break;
    const m = line.match(/^\s*[-*]\s+\[([ xX-])\]\s+(.+)$/);
    if (!m || /{{|…|^\s*(?:TBD|Person \d+|\.\.\.)\s*$/i.test(m[2])) continue;
    const key = personKey(m[2]); if (!key) continue;
    let present = m[1].toLowerCase() === 'x';
    const checkedDate = m[2].match(/✅\s*(\d{4}-\d{2}-\d{2})/);
    if (present && checkedDate && checkedDate[1] !== date) {
      issues.push({ path: doc.path, message: 'An attendance check has another meeting’s date and was not counted.' });
      present = false;
    }
    people.set(key, Boolean(people.get(key)) || present);
  }
  const cancelled = /^(cancelled|canceled)$/i.test(props['meeting status'] || props.meeting_status || props.status || '');
  const confirmed = props['attendance confirmed'] === true ||
    /Attendance Confirmed:\*{0,2}\s*(?:Yes|True)\b/i.test(doc.text);
  return { path: doc.path, date, people, recorded: !cancelled &&
    (confirmed || [...people.values()].some(Boolean)), cancelled, confirmed };
}
function countValue(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '') ||
      !['number', 'string'].includes(typeof value)) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}
function collect(docs) {
  const issues = [], people = roster(docs), byPath = new Map(docs.map(doc => [doc.path, doc]));
  const availability = {};
  const source = (path, field) => {
    const data = tables(byPath.get(path)?.text).find(table => table.columns.some(col => col.id === field));
    availability[field] = Boolean(data);
    if (!data) issues.push({ path, message: 'No valid structured table was found.' });
    return data?.rows.filter(row => String(row.cells?.[field] || '').trim()) || [];
  };
  const actions = source(PATHS.actions, 'action').map(row => ({ ...row.cells, id: row.id, path: PATHS.actions }));
  const work = source(PATHS.work, 'work').map(row => ({ ...row.cells, id: row.id, path: PATHS.work }));
  const candidates = docs.filter(doc => doc.path.startsWith(PATHS.board)).map(doc => attendance(doc, issues)).filter(Boolean);
  const groups = new Map();
  for (const meeting of candidates) { const group = groups.get(meeting.date) || []; group.push(meeting); groups.set(meeting.date, group); }
  const meetings = [];
  for (const [date, group] of groups) {
    // Prefer an actual attendance record over an unchecked reformatted copy.
    group.sort((a, b) => ((Number(b.confirmed) * 1000 + Number(b.recorded) * 100 +
      [...b.people.values()].filter(Boolean).length * 10 + b.people.size) -
      (Number(a.confirmed) * 1000 + Number(a.recorded) * 100 +
      [...a.people.values()].filter(Boolean).length * 10 + a.people.size)) ||
      Number(/_Update\.md$/i.test(b.path)) - Number(/_Update\.md$/i.test(a.path)));
    meetings.push(group[0]);
    if (group.length > 1) issues.push({ path: group[0].path,
      message: group.length + ' notes for ' + date + ' count as one meeting; the most complete attendance record is used.' });
  }
  const activityRows = source(PATHS.activities, 'activity');
  const activityGroups = new Map();
  for (const row of activityRows) {
    const cells = row.cells;
    const activity = { ...cells, id: row.id, path: PATHS.activities, date: validDate(cells.date),
      registrations: countValue(cells.registrations), attendees: countValue(cells.attendees) };
    for (const key of ['registrations', 'attendees']) {
      if (cells[key] !== '' && cells[key] != null && activity[key] == null)
        issues.push({ path: PATHS.activities, message: plain(cells.activity) + ': ' + key + ' must be a whole number of at least zero.' });
    }
    if (!activity.date) issues.push({ path: PATHS.activities, message: plain(cells.activity) + ': add the edition’s date.' });
    const link = String(activity.activity).match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
    const identity = link ? link[1] : plain(activity.activity);
    const key = activity.date + '|' + identity.toLowerCase() + '|' + (activity.series || '');
    const group = activityGroups.get(key) || []; group.push(activity); activityGroups.set(key, group);
  }
  const activities = [];
  for (const group of activityGroups.values()) {
    group.sort((a, b) => ((Number(b.status === 'Held') * 10 + Number(b.attendees != null) * 3 + Number(b.registrations != null)) -
      (Number(a.status === 'Held') * 10 + Number(a.attendees != null) * 3 + Number(a.registrations != null))));
    activities.push(group[0]);
    if (group.length > 1) issues.push({ path: PATHS.activities,
      message: plain(group[0].activity) + ': duplicate edition rows are counted once; review the entries.' });
  }
  return { people, meetings, actions, work, activities, issues, availability };
}
function summarize(data, period = 'year', today = todayDate()) {
  const from = startDate(period, today), inPeriod = date => date && date >= from && date <= today;
  const people = data.people.filter(person => !person.former);
  const allKeys = new Map(data.people.flatMap(person => person.keys.map(key => [key, person])));
  const meetings = data.meetings.filter(meeting => inPeriod(meeting.date) && !meeting.cancelled);
  const recorded = meetings.filter(meeting => meeting.recorded);
  const actions = data.actions.filter(action => !closed(action.status));
  const late = action => validDate(action.due_date) && action.due_date < today;
  const soon = action => validDate(action.due_date) && action.due_date >= today && action.due_date <= addDays(today, 14);
  const workload = person => actions.filter(action => person.keys.includes(personKey(action.owner)));
  const attendanceRows = people.map(person => {
    let present = 0, listed = 0;
    for (const meeting of recorded) {
      const key = person.keys.find(key => meeting.people.has(key));
      if (key != null) { listed++; if (meeting.people.get(key)) present++; }
    }
    const own = workload(person);
    return { ...person, present, listed, openActions: own.length, overdue: own.filter(late).length };
  });
  const months = new Map();
  for (const meeting of recorded) {
    const key = meeting.date.slice(0, 7), row = months.get(key) || { month: key, meetings: 0, present: 0, listed: 0 };
    row.meetings++;
    for (const person of people) {
      const key = person.keys.find(key => meeting.people.has(key));
      if (key != null) { row.listed++; if (meeting.people.get(key)) row.present++; }
    }
    months.set(key, row);
  }
  const activityRecords = data.activities.filter(activity => inPeriod(activity.date));
  const held = activityRecords.filter(activity => activity.status === 'Held');
  const measured = held.filter(activity => activity.attendees != null);
  const paired = measured.filter(activity => activity.registrations > 0);
  const series = [...new Set(held.map(activity => activity.series || 'Other'))].map(name => {
    const sessions = held.filter(activity => (activity.series || 'Other') === name);
    const measured = sessions.filter(activity => activity.attendees != null);
    return { name, held: sessions.length, measured: measured.length,
      visits: measured.length ? measured.reduce((sum, activity) => sum + activity.attendees, 0) : null };
  });
  const issues = data.issues.filter(issue => !issue.path.startsWith(PATHS.board) ||
    meetings.some(meeting => meeting.path === issue.path));
  for (const meeting of meetings) if (!meeting.recorded)
    issues.push({ path: meeting.path, message: meeting.date + ': attendance is not recorded; excluded from participation rates.' });
  for (const meeting of recorded) for (const key of meeting.people.keys())
    if (!allKeys.has(key)) issues.push({ path: meeting.path, message: 'An attendance name is not matched to MENACOSE People: ' + key + '.' });
  for (const activity of held) if (activity.attendees == null)
    issues.push({ path: PATHS.activities, message: plain(activity.activity) + ': Held, but attendance is not recorded.' });
  const ownerNeeded = actions.filter(action => !allKeys.has(personKey(action.owner)) ||
    allKeys.get(personKey(action.owner))?.former);
  const noDate = actions.filter(action => !validDate(action.due_date));
  const unknownStatus = actions.filter(action => !action.status || action.status === 'TBD');
  const attention = [...actions].filter(action => late(action) || soon(action) ||
    /blocked/i.test(action.status) || ownerNeeded.includes(action)).sort((a, b) =>
    Number(late(b)) - Number(late(a)) || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
  const distributions = ['Project', 'Recurring Activity'].map(type => ({
    type, total: data.work.filter(row => row.type === type).length,
    open: data.work.filter(row => row.type === type && !closed(row.status)).length,
    blocked: data.work.filter(row => row.type === type && row.status === 'Blocked').length,
    completed: data.work.filter(row => row.type === type && row.status === 'Completed').length,
  }));
  const participants = attendanceRows.reduce((sum, person) => sum + person.present, 0);
  const listed = attendanceRows.reduce((sum, person) => sum + person.listed, 0);
  return { today, period, from, availability: data.availability, people: attendanceRows, recordedMeetings: recorded.length,
    meetingNotes: meetings.length, unrecordedMeetings: meetings.filter(meeting => !meeting.recorded).length,
    participants, listed, months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    activities: { recorded: activityRecords.length, held: held.length, measured: measured.length,
      visits: measured.length ? measured.reduce((sum, activity) => sum + activity.attendees, 0) : null,
      pairedAttendees: paired.reduce((sum, activity) => sum + activity.attendees, 0),
      pairedRegistrations: paired.reduce((sum, activity) => sum + activity.registrations, 0),
      paired: paired.length, series,
      upcoming: data.activities.filter(activity => activity.date >= today && activity.date <= addDays(today, 30) &&
        !['Held', 'Cancelled'].includes(activity.status)).sort((a, b) => a.date.localeCompare(b.date)) },
    delivery: { actions: data.actions.length, open: actions.length,
      completed: data.actions.filter(action => /^completed$/i.test(action.status)).length,
      overdue: actions.filter(late).length, dueSoon: actions.filter(soon).length,
      ownerNeeded: ownerNeeded.length, noDate: noDate.length, unknownStatus: unknownStatus.length,
      blocked: data.work.filter(row => row.status === 'Blocked').length, distributions, attention },
    issues: [...new Map(issues.map(issue => [issue.path + issue.message, issue])).values()] };
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const number = value => value == null ? 'Not Recorded' : Number(value).toLocaleString();
const ratio = (a, b) => b ? Math.round(a / b * 100) + '%' : 'Not Recorded';
function noteLink(path, text) {
  return '<a class="internal-link" href="#' + escapeHtml(encodeURIComponent(path)) +
    '" data-note-path="' + escapeHtml(path) + '">' + escapeHtml(text) + '</a>';
}
function itemLink(value, fallback) {
  const m = String(value || '').match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
  return noteLink(m ? m[1] : fallback, plain(value));
}
function htmlTable(headers, rows, empty) {
  if (!rows.length) return '<p class="menacose-dashboard-empty">' + escapeHtml(empty) + '</p>';
  return '<div class="menacose-dashboard-table-wrap"><table><thead><tr>' +
    headers.map(header => '<th scope="col">' + escapeHtml(header) + '</th>').join('') +
    '</tr></thead><tbody>' + rows.map(row => '<tr>' +
      row.map(cell => '<td>' + cell + '</td>').join('') + '</tr>').join('') +
    '</tbody></table></div>';
}
function cards(items) {
  return '<div class="menacose-dashboard-cards">' + items.map(([title, value, caption]) =>
    '<div class="menacose-dashboard-card"><span>' + escapeHtml(title) +
    '</span><strong>' + escapeHtml(value) + '</strong><small>' + escapeHtml(caption) +
    '</small></div>').join('') + '</div>';
}
function bar(present, listed) {
  if (!listed) return '<span class="menacose-dashboard-muted">Not Recorded</span>';
  return '<div class="menacose-dashboard-bar"><progress max="' + listed + '" value="' + present +
    '" aria-label="' + escapeHtml(present + ' of ' + listed + ' marked present') +
    '"></progress><span>' + ratio(present, listed) + '</span></div>';
}
function dashboardHtml(model) {
  const core = model.people;
  const current = model.delivery;
  const activity = model.activities;
  const actionMetric = value => model.availability.action ? number(value) : 'Not Recorded';
  const activityMetric = value => model.availability.activity ? number(value) : 'Not Recorded';
  let html = '<section class="menacose-dashboard-section"><h2>Core Team Participation</h2>' +
    '<p class="menacose-dashboard-muted">Current core-team contacts, counted only where listed in a recorded board meeting. Unchecked names mean Not Marked Present.</p>' +
    cards([
      ['Meetings With Attendance', number(model.recordedMeetings), model.meetingNotes + ' distinct meeting notes in the period'],
      ['Marked Present', ratio(model.participants, model.listed), model.participants + ' of ' + model.listed + ' listed opportunities'],
      ['Attendance Not Recorded', number(model.unrecordedMeetings), 'Excluded from participation rates'],
    ]) +
    htmlTable(['Person', 'Present / Listed', 'Participation', 'Open Actions', 'Past Due'],
      core.map(person => [
        noteLink(person.path, person.name) + '<small class="menacose-dashboard-role">' + escapeHtml(person.role) + '</small>',
        escapeHtml(person.present + ' / ' + person.listed), bar(person.present, person.listed),
        escapeHtml(actionMetric(person.openActions)), escapeHtml(actionMetric(person.overdue)),
      ]), 'Add core-team person notes to MENACOSE People to show participation.') +
    '<h3>Monthly Participation</h3>' +
    htmlTable(['Month', 'Recorded Meetings', 'Marked Present / Listed', 'Participation'],
      model.months.map(month => [escapeHtml(month.month), number(month.meetings),
        escapeHtml(month.present + ' / ' + month.listed), bar(month.present, month.listed)]),
      'No recorded board attendance in this period.') + '</section>';

  html += '<section class="menacose-dashboard-section"><h2>Activity Attendance And Engagement</h2>' +
    '<p class="menacose-dashboard-muted">Confirmed Held editions from ' + noteLink(PATHS.activities, 'Activity Register') +
    '. Announcements and planned dates do not establish delivery or attendance.</p>' +
    cards([
      ['Confirmed Held Editions', activityMetric(activity.held), 'Recorded editions within the selected period'],
      ['Attendance Visits', activityMetric(activity.visits), 'Sum of recorded attendance; not unique people'],
      ['Attendance Coverage', model.availability.activity && activity.held ? ratio(activity.measured, activity.held) : 'Not Recorded',
        activity.measured + ' of ' + activity.held + ' Held editions have attendance figures'],
      ['Attendance / Registrations', model.availability.activity ? ratio(activity.pairedAttendees, activity.pairedRegistrations) : 'Not Recorded',
        'Only matched figures from ' + activity.paired + ' edition(s)'],
    ]) +
    htmlTable(['Activity Type', 'Held Editions', 'Attendance Visits', 'Attendance Recorded'],
      activity.series.map(series => [escapeHtml(series.name), number(series.held), number(series.visits),
        escapeHtml(series.measured + ' / ' + series.held)]),
      'No editions are confirmed Held in this period. Attendance totals remain Not Recorded until entered.') +
    '<h3>Upcoming Activities</h3><p class="menacose-dashboard-muted">Next 30 days, independent of the historical period filter. TBD means the edition still needs confirmation.</p>' +
    htmlTable(['Edition', 'Date', 'Owner', 'Status'],
      activity.upcoming.map(edition => [itemLink(edition.activity, PATHS.activities), escapeHtml(edition.date),
        escapeHtml(edition.owner || 'TBD'), escapeHtml(edition.status || 'TBD')]),
      'No upcoming editions are recorded for the next 30 days.') + '</section>';

  html += '<section class="menacose-dashboard-section"><h2>Current Work And Follow Up</h2>' +
    '<p class="menacose-dashboard-muted">Current shared registers, independent of the historical period filter. Meeting copies are not counted again.</p>' +
    cards([
      ['Open Actions', actionMetric(current.open), current.completed + ' completed actions in the current register'],
      ['Past Due', actionMetric(current.overdue), 'Open actions due before today'],
      ['Due In 14 Days', actionMetric(current.dueSoon), 'Includes actions due today'],
      ['Blocked Work', model.availability.work ? number(current.blocked) : 'Not Recorded', 'Projects and recurring activities needing help'],
    ]) +
    htmlTable(['Work Type', 'Recorded', 'Open', 'Blocked', 'Completed'],
      model.availability.work ? current.distributions.map(row => [escapeHtml(row.type), number(row.total),
        number(row.open), number(row.blocked), number(row.completed)]) : [],
      'The Work Overview source table is not available.') +
    '<p>' + noteLink(PATHS.actions, 'Open Action Register') + ' · ' + noteLink(PATHS.work, 'Open Work Overview') + '</p>' +
    '<p class="menacose-dashboard-muted">' + escapeHtml(actionMetric(current.ownerNeeded)) +
    ' open action(s) need a named current owner; ' + escapeHtml(actionMetric(current.noDate)) +
    ' have no agreed date; ' + escapeHtml(actionMetric(current.unknownStatus)) +
    ' still have TBD status. Shared assignments such as All count once and are not assigned to every person.</p>' +
    '<h3>Actions To Review</h3>' +
    htmlTable(['Action', 'Owner', 'Due Date', 'Status'],
      current.attention.slice(0, 10).map(action => [noteLink(PATHS.actions + '#Actions', action.action),
        escapeHtml(action.owner || 'TBD'), escapeHtml(action.due_date || 'Not Agreed'), escapeHtml(action.status || 'TBD')]),
      'No actions need attention under the current date, ownership and blocker checks.') + '</section>';

  html += '<section class="menacose-dashboard-section"><h2>Data Coverage And Sources</h2>' +
    '<p>Membership totals, membership growth and unique event participants are not inferred from contact notes or aggregate attendance.</p>' +
    '<details><summary>Records To Review (' + model.issues.length + ')</summary>' +
    htmlTable(['Source', 'Review'],
      model.issues.slice(0, 30).map(issue => [noteLink(issue.path, issue.path.split('/').pop().replace(/\.md$/i, '')),
        escapeHtml(issue.message)]), 'No date, duplicate or attendance-coverage issues were found in the selected period.') +
    (model.issues.length > 30 ? '<p>Showing the first 30 records.</p>' : '') +
    '</details></section>';
  return html;
}

class Dashboard {
  constructor(plugin, MarkdownRenderChild) {
    this.plugin = plugin; this.app = plugin.app; this.views = new Set(); this.alive = true;
    plugin.register(() => { this.alive = false; clearTimeout(this.timer); this.views.clear(); });
    for (const event of ['modify', 'create', 'delete', 'rename'])
      plugin.registerEvent(this.app.vault.on(event, (file, oldPath) => {
        if (this.relevant(file?.path) || this.relevant(oldPath)) this.schedule();
      }));
    plugin.registerMarkdownCodeBlockProcessor('menacose-dashboard', (_source, el, ctx) => {
      const state = { el, sourcePath: ctx.sourcePath, period: 'year', serial: 0 };
      this.views.add(state);
      if (ctx.addChild && MarkdownRenderChild) {
        const views = this.views;
        class DashboardChild extends MarkdownRenderChild { onunload() { views.delete(state); } }
        ctx.addChild(new DashboardChild(el));
      }
      this.refresh();
    });
    plugin.registerInterval(setInterval(() => { if (this.views.size) this.schedule(); }, 60000));
  }
  relevant(path) {
    return typeof path === 'string' && (path.startsWith(PATHS.board) || path.startsWith(PATHS.people) ||
      [PATHS.work, PATHS.actions, PATHS.activities].includes(path));
  }
  schedule() {
    if (!this.alive || !this.views.size) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), 500);
  }
  async refresh() {
    const serial = this.serial = (this.serial || 0) + 1;
    // The processor can run before its element is attached to the document.
    // MarkdownRenderChild handles cleanup; do not discard a new detached view.
    if (!this.views.size || !this.alive) return;
    try {
      const docs = await Promise.all(this.app.vault.getMarkdownFiles().filter(file => this.relevant(file.path))
        .map(async file => ({ path: file.path, text: await this.app.vault.read(file) })));
      if (!this.alive || serial !== this.serial) return;
      this.data = collect(docs);
      for (const state of this.views) this.draw(state);
    } catch (error) {
      if (serial !== this.serial) return;
      console.error('[MENACOSE Dashboard]', error);
      for (const state of this.views) {
        state.el.empty();
        state.el.createEl('p', { text: 'Dashboard could not read its sources. Select Refresh or reopen this note.' });
        const retry = state.el.createEl('button', { text: 'Refresh' }); retry.onclick = () => this.refresh();
      }
    }
  }
  draw(state) {
    const el = state.el;
    el.empty(); el.addClass('menacose-dashboard');
    const toolbar = el.createDiv({ cls: 'menacose-dashboard-toolbar' });
    const labelEl = toolbar.createEl('label', { text: 'Attendance Period ' });
    const select = labelEl.createEl('select');
    for (const [value, text] of [['year', 'This Year'], ['quarter', 'This Quarter'],
      ['90days', 'Last 90 Days'], ['all', 'All Time']])
      select.createEl('option', { text, attr: { value } });
    select.value = state.period;
    select.onchange = () => { state.period = select.value; this.draw(state); };
    const refresh = toolbar.createEl('button', { text: 'Refresh' });
    refresh.onclick = () => this.refresh();
    toolbar.createSpan({ text: 'Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      cls: 'menacose-dashboard-muted' });
    const content = el.createDiv();
    // All text and attributes are escaped; source notes cannot inject markup.
    content.innerHTML = dashboardHtml(summarize(this.data, state.period));
    content.addEventListener('click', event => {
      const anchor = event.target.closest?.('a[data-note-path]');
      if (!anchor) return;
      event.preventDefault(); event.stopPropagation();
      this.app.workspace.openLinkText(anchor.dataset.notePath, state.sourcePath, event.metaKey || event.ctrlKey);
    });
  }
}
module.exports = { PATHS, properties, personKey, validDate, todayDate, tables, collect, summarize, dashboardHtml, Dashboard };

'use strict';
const { Plugin, TFile, MarkdownView, Notice, MarkdownRenderChild } = require('obsidian');
const { MeetingSync } = (() => {
const module = { exports: {} };
'use strict';
// Smart Table preserves this opt-in metadata when saving. Historic notes
// without it, frozen notes, templates and unconnected copies are never synced.
const FENCE = String.fromCharCode(96).repeat(3);
const TABLE = /^(\x60{3}smart-table)\s*\n([\s\S]*?)\n\x60{3}/gm;
const SOURCES = {
  work: '04_Projects/Work Overview.md',
  actions: '04_Projects/Action Register.md',
};
const MEETINGS = '03_Meetings/03.01_Board-Meetings/';
const TEMPLATE = '99_Templates/Meeting Agenda and MoMs.md';
const clone = value => JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
const fields = ['item', 'kind', 'related_work', 'owner', 'due_date', 'status', 'update'];
const maps = {
  work: { item: 'work', kind: 'type', related_work: 'areas', owner: 'owner',
    due_date: 'target_date', status: 'status', update: 'milestone' },
  actions: { item: 'action', related_work: 'related_work', owner: 'owner',
    due_date: 'due_date', status: 'status', update: 'notes' },
};
function tableBlocks(text) {
  const blocks = [];
  for (const m of text.matchAll(TABLE)) {
    try {
      const data = JSON.parse(m[2]);
      if (Array.isArray(data.columns) && Array.isArray(data.rows))
        blocks.push({ from: m.index, to: m.index + m[0].length, raw: m[0], data });
    } catch { /* Leave invalid or unrelated blocks untouched. */ }
  }
  return blocks;
}
function replaceBlocks(text, blocks) {
  for (const block of [...blocks].reverse()) {
    // Preserve original formatting if data did not change.
    if (equal(JSON.parse(block.raw.slice(block.raw.indexOf('\n') + 1, block.raw.lastIndexOf('\n'))), block.data)) continue;
    // A unique revision also prevents Smart Table's Live Preview widget from
    // reusing stale DOM when a later external edit returns cells to their
    // original values after earlier edits made inside that widget.
    block.data.menacoseRevision = (Number(block.data.menacoseRevision) || 0) + 1;
    const rendered = FENCE + 'smart-table\n' + JSON.stringify(block.data) + '\n' + FENCE;
    text = text.slice(0, block.from) + rendered + text.slice(block.to);
  }
  return text;
}
function label(value) {
  const s = String(value ?? '').trim();
  const m = s.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
  return m ? m[2] || m[1].split('#')[0].split('/').pop().replace(/\.md$/i, '') : s;
}
function project(source, row) {
  const result = {};
  for (const [local, remote] of Object.entries(maps[source])) result[local] = row.cells[remote] ?? '';
  if (source === 'actions') {
    result.kind = 'Action';
    result.related_work = result.related_work ? '[[' + result.related_work + ']]' : '';
  }
  return result;
}
function canonical(source, field, value) {
  return source === 'actions' && field === 'related_work' ? label(value) : value;
}
function addOptions(data) {
  for (const col of data.columns) {
    if (!['select', 'status', 'multiselect'].includes(col.type)) continue;
    col.options ||= [];
    for (const row of data.rows) {
      const values = Array.isArray(row.cells[col.id]) ? row.cells[col.id] : [row.cells[col.id]];
      for (const value of values) if (value && !col.options.some(o => o.label === value))
        col.options.push({ label: value, color: 'gray' });
    }
  }
}
const sourceKey = (source, id) => source + ':' + id;
function bind(data, source, sourceRow, localId) {
  const cells = project(source, sourceRow);
  const row = { id: localId || 'sync-' + source + '-' + sourceRow.id, cells: clone(cells) };
  data.rows.push(row);
  data.menacoseSync.bindings[row.id] = { source, id: sourceRow.id, base: clone(cells) };
  return row;
}
function isOwned(data, path) {
  const meta = data.menacoseSync;
  return meta?.version === 1 && meta.active === true && meta.meeting === path &&
    ['review', 'commitments'].includes(meta.role) && path.startsWith(MEETINGS);
}
function reconcile(meetingText, sourceTexts, path) {
  const sourceBlocks = {};
  for (const source of Object.keys(SOURCES)) {
    sourceBlocks[source] = tableBlocks(sourceTexts[source])[0];
    if (!sourceBlocks[source]) throw new Error('No valid table in ' + SOURCES[source]);
  }
  const blocks = tableBlocks(meetingText);
  const views = blocks.filter(b => isOwned(b.data, path));
  const issues = [];
  if (!views.length) return { meeting: meetingText, sources: { ...sourceTexts }, issues };
  for (const { data } of views) {
    const meta = data.menacoseSync;
    meta.bindings ||= {};
    const localIds = new Set(data.rows.map(row => row.id));
    for (const id of Object.keys(meta.bindings)) if (!localIds.has(id)) delete meta.bindings[id];
    for (const row of data.rows) {
      row.cells ||= {};
      let binding = meta.bindings[row.id];
      if (!binding) {
        if (!String(row.cells.item || '').trim()) continue;
        const source = meta.role === 'commitments' || !['Project', 'Recurring Activity'].includes(row.cells.kind)
          ? 'actions' : 'work';
        const id = 'meeting-' + path.split('/').pop().replace(/\.md$/i, '') + '-' + row.id;
        // Stable generated IDs also make retries and undo safe.
        let sourceRow = sourceBlocks[source].data.rows.find(r => r.id === id);
        if (!sourceRow) {
          const cells = {};
          for (const [local, remote] of Object.entries(maps[source]))
            cells[remote] = canonical(source, local, row.cells[local] ?? '');
          cells.owner ||= 'TBD'; cells.status ||= 'TBD';
          sourceRow = { id, cells };
          sourceBlocks[source].data.rows.push(sourceRow);
        }
        const current = project(source, sourceRow);
        Object.assign(row.cells, current);
        binding = meta.bindings[row.id] = { source, id, base: clone(current) };
      }
      const source = binding.source;
      if (!maps[source]) continue;
      const sourceRow = sourceBlocks[source].data.rows.find(r => r.id === binding.id);
      if (!sourceRow) {
        issues.push(label(row.cells.item) + ': the source row was removed. The meeting record was kept.');
        continue;
      }
      const remote = project(source, sourceRow);
      const base = binding.base || {};
      const visible = new Set(data.columns.map(col => col.id));
      for (const field of fields) {
        if (!visible.has(field) || !Object.hasOwn(remote, field)) continue;
        if (field === 'kind' && source === 'actions') {
          row.cells.kind = 'Action'; base.kind = 'Action'; continue;
        }
        const localValue = row.cells[field] ?? '';
        const remoteValue = remote[field] ?? '';
        // Compare relation labels canonically: a full-path link and a short
        // link to the same related work do not constitute a conflict.
        const norm = value => canonical(source, field, value);
        const localChanged = !equal(norm(localValue), norm(base[field]));
        const remoteChanged = !equal(norm(remoteValue), norm(base[field]));
        if (localChanged && remoteChanged && !equal(norm(localValue), norm(remoteValue))) {
          issues.push(label(row.cells.item) + ' / ' + field +
            ': both places changed. Values were kept; make either cell match the other to resolve.');
          continue;
        }
        if (localChanged && field === 'kind' && !['Project', 'Recurring Activity'].includes(localValue)) {
          issues.push(label(row.cells.item) + ': a work row must be Project or Recurring Activity.');
          continue;
        }
        const value = localChanged ? localValue : remoteValue;
        const remoteField = maps[source][field];
        if (remoteField) sourceRow.cells[remoteField] = norm(value);
        row.cells[field] = value;
        base[field] = clone(value);
      }
      binding.base = base;
    }
  }
  // New rows added directly in a register enter the review. Removing a row
  // from a meeting only removes that view; it never deletes source work.
  for (const block of Object.values(sourceBlocks)) addOptions(block.data);
  const bound = new Set(views.flatMap(({ data }) =>
    Object.values(data.menacoseSync.bindings).map(b => sourceKey(b.source, b.id))));
  for (const { data } of views) {
    const meta = data.menacoseSync;
    if (meta.role === 'review') {
      const known = new Set(meta.known || []);
      for (const [source, block] of Object.entries(sourceBlocks)) for (const row of block.data.rows) {
        const key = sourceKey(source, row.id);
        if (!known.has(key) && !bound.has(key)) {
          bind(data, source, row); bound.add(key);
        }
      }
      meta.known = Object.entries(sourceBlocks).flatMap(([source, block]) =>
        block.data.rows.map(row => sourceKey(source, row.id)));
    }
    // Carry new dropdown choices to both locations, without erasing custom
    // colours or modifying sorting, filters and column widths.
    for (const col of data.columns) {
      if (!['owner', 'status'].includes(col.id)) continue;
      col.options ||= [];
      for (const block of Object.values(sourceBlocks)) {
        const original = block.data.columns.find(c => c.id === col.id);
        for (const option of original?.options || [])
          if (!col.options.some(o => o.label === option.label)) col.options.push(clone(option));
      }
    }
    addOptions(data);
  }
  const sources = {};
  for (const [source, block] of Object.entries(sourceBlocks)) {
    addOptions(block.data);
    sources[source] = replaceBlocks(sourceTexts[source], [block]);
  }
  return { meeting: replaceBlocks(meetingText, blocks), sources, issues };
}
function freeze(text, path) {
  const blocks = tableBlocks(text);
  for (const { data } of blocks) if (isOwned(data, path)) data.menacoseSync.active = false;
  return replaceBlocks(text, blocks);
}
function connect(text, sourceTexts, path) {
  const blocks = tableBlocks(text);
  const sources = Object.fromEntries(Object.entries(sourceTexts).map(([key, value]) => [key, tableBlocks(value)[0]?.data]));
  if (Object.values(sources).some(data => !data)) throw new Error('A source register is missing its table.');
  for (const { data } of blocks) {
    const meta = data.menacoseSync;
    if (!meta || !['review', 'commitments'].includes(meta.role)) continue;
    meta.version = 1; meta.active = true; meta.meeting = path; meta.bindings ||= {};
    if (meta.role === 'review' && !data.rows.some(row => String(row.cells.item || '').trim())) {
      data.rows = [];
      for (const source of ['actions', 'work']) for (const row of sources[source].rows) {
        if (['Completed', 'Cancelled'].includes(row.cells.status)) continue;
        bind(data, source, row);
      }
    }
    meta.known = Object.entries(sources).flatMap(([source, data]) => data.rows.map(row => sourceKey(source, row.id)));
  }
  return replaceBlocks(text, blocks);
}

class MeetingSync {
  constructor(plugin, Notice) {
    this.plugin = plugin; this.app = plugin.app; this.Notice = Notice;
    this.queue = Promise.resolve(); this.alive = true; this.lastIssues = '';
    plugin.register(() => { this.alive = false; clearTimeout(this.timer); });
    plugin.registerEvent(this.app.vault.on('modify', file => {
      if (this.relevant(file?.path)) this.schedule();
    }));
    plugin.registerEvent(this.app.vault.on('create', file => {
      if (file?.path?.startsWith(MEETINGS)) this.schedule();
    }));
    plugin.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (!file?.path?.startsWith(MEETINGS)) return;
      this.run(async () => {
        await this.app.vault.process(file, text => {
          const blocks = tableBlocks(text);
          for (const { data } of blocks)
            if (data.menacoseSync?.meeting === oldPath) data.menacoseSync.meeting = file.path;
          return replaceBlocks(text, blocks);
        });
        this.schedule();
      });
    }));
    const doc = this.app.workspace.containerEl?.ownerDocument;
    if (doc) plugin.registerDomEvent(doc, 'focusout', event => {
      if (event.target?.closest?.('.smart-table, .smart-table-lp')) this.schedule();
    });
    this.app.workspace.onLayoutReady(() => this.schedule());
    plugin.addCommand({ id: 'sync-meeting', name: 'Sync Meeting Tables Now',
      callback: () => this.run(() => this.syncAll()) });
    plugin.addCommand({ id: 'finish-meeting', name: 'Finish Meeting And Keep Snapshot',
      callback: () => this.finish(this.app.workspace.getActiveFile()?.path) });
    plugin.addCommand({ id: 'connect-meeting', name: 'Connect This Meeting To Registers',
      callback: () => this.activate(this.app.workspace.getActiveFile()?.path) });
    plugin.addCommand({ id: 'prepare-weekly-meeting', name: 'Prepare Today’s Weekly Meeting',
      callback: () => this.prepare() });
    plugin.registerMarkdownCodeBlockProcessor('menacose-meeting', async (_source, el, ctx) => {
      const render = async () => {
        const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
        if (!file) return;
        const text = await this.app.vault.read(file);
        const active = tableBlocks(text).some(b => isOwned(b.data, file.path));
        el.empty();
        const bar = el.createDiv({ cls: 'menacose-meeting-controls' });
        bar.createSpan({ text: active ? 'Live Tables' : 'Meeting Snapshot' });
        const button = bar.createEl('button', {
          text: active ? 'Finish Meeting & Keep Snapshot' : 'Connect For Editing',
        });
        button.onclick = async () => {
          button.disabled = true;
          if (active) await this.finish(file.path); else await this.activate(file.path);
          await render();
        };
        if (active) {
          const sync = bar.createEl('button', { text: 'Sync Now' });
          sync.onclick = () => this.run(() => this.syncAll());
        }
      };
      await render();
    });
  }
  relevant(path) {
    return path && (Object.values(SOURCES).includes(path) || path.startsWith(MEETINGS));
  }
  notice(message) { if (this.alive) new this.Notice(message, 10000); }
  run(job) {
    const pending = this.queue.then(() => this.alive && job());
    this.queue = pending.catch(error => {
      console.error('[MENACOSE Meeting Sync]', error);
      this.notice('Meeting sync needs attention: ' + error.message);
    });
    return this.queue;
  }
  schedule() {
    if (!this.alive) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(() => this.syncAll()), 300);
  }
  async readSources() {
    const texts = {};
    for (const [source, path] of Object.entries(SOURCES)) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file) throw new Error('Missing register: ' + path);
      texts[source] = await this.app.vault.read(file);
    }
    return texts;
  }
  async guardedWrite(path, expected, updated) {
    if (updated === expected) return true;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) return false;
    let matched = false;
    await this.app.vault.process(file, current => {
      matched = current === expected;
      return matched ? updated : current;
    });
    return matched;
  }
  async saveOpenEdits() {
    // Explicit meeting controls must include the final Live Preview edit,
    // even when Obsidian's normal debounced save has not run yet.
    for (const leaf of this.app.workspace.getLeavesOfType?.('markdown') || []) {
      const view = leaf.view;
      if (!this.relevant(view?.file?.path) || view.getMode?.() !== 'source' ||
          typeof view.getViewData !== 'function' || typeof view.save !== 'function') continue;
      if (view.getViewData() !== await this.app.vault.read(view.file)) await view.save();
    }
  }
  async syncAll() {
    // Smart Table commits text on change/blur. Do not rebuild a widget while
    // its cell contains an unfinished edit.
    const focused = this.app.workspace.containerEl?.ownerDocument?.activeElement;
    if (focused?.matches?.('input, textarea, select') && focused.closest?.('.smart-table, .smart-table-lp')) return false;
    const files = this.app.vault.getMarkdownFiles().filter(file => file.path.startsWith(MEETINGS));
    const issues = [];
    for (const file of files) {
      if (!this.alive) return false;
      const text = await this.app.vault.read(file);
      if (!tableBlocks(text).some(block => isOwned(block.data, file.path))) continue;
      const sources = await this.readSources();
      const result = reconcile(text, sources, file.path);
      // Guard against edits made after our read. Retry rather than replacing
      // newer user edits with a stale complete-note write.
      for (const source of Object.keys(SOURCES)) {
        if (!await this.guardedWrite(SOURCES[source], sources[source], result.sources[source])) {
          this.schedule(); return false;
        }
      }
      if (!await this.guardedWrite(file.path, text, result.meeting)) {
        this.schedule(); return false;
      }
      issues.push(...result.issues);
    }
    const signature = issues.join('\n');
    if (signature && signature !== this.lastIssues) this.notice(signature);
    this.lastIssues = signature;
    return issues.length === 0;
  }
  finish(path) {
    return this.run(async () => {
      if (!path?.startsWith(MEETINGS)) return this.notice('Open a board meeting note first.');
      await this.saveOpenEdits();
      if (!await this.syncAll()) return this.notice('Resolve the sync notice before finishing the meeting.');
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file) return;
      await this.app.vault.process(file, text => freeze(text, path));
      this.notice('Meeting saved as a snapshot. Later register changes will not change its tables.');
    });
  }
  activate(path) {
    return this.run(async () => {
      if (!path?.startsWith(MEETINGS)) return this.notice('Open a board meeting note first.');
      await this.saveOpenEdits();
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file) return;
      const current = await this.app.vault.read(file);
      if (!tableBlocks(current).some(b => b.data.menacoseSync)) return this.notice('Use the updated weekly meeting template.');
      if (!await this.syncAll()) return this.notice('Resolve the sync notice before connecting another meeting.');
      // One meeting at a time: protect the previous minutes before a new
      // live meeting is prepared. Opt-in copies are reconnected explicitly.
      for (const other of this.app.vault.getMarkdownFiles()) if (other.path.startsWith(MEETINGS) && other.path !== path)
        await this.app.vault.process(other, text => freeze(text, other.path));
      const sources = await this.readSources();
      await this.app.vault.process(file, text => connect(text, sources, path));
      await this.syncAll();
      this.notice('Meeting tables connected. Edit here or in either register.');
    });
  }
  async prepare() {
    try {
      const now = new Date();
      const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
      const name = 'Meeting Agenda and MoMs ' + date.replaceAll('-', '');
      const path = MEETINGS + name + '.md';
      let file = this.app.vault.getAbstractFileByPath(path);
      if (!file) {
        const template = this.app.vault.getAbstractFileByPath(TEMPLATE);
        if (!template) throw new Error('Meeting template is missing.');
        const text = (await this.app.vault.read(template))
          .replaceAll('<% tp.file.title %>', name)
          .replace('date & time:\n', 'date & time: ' + date + 'T20:00:00\n');
        file = await this.app.vault.create(path, text);
      }
      await this.app.workspace.getLeaf(false).openFile(file);
      await this.activate(path);
    } catch (error) { this.notice(error.message); }
  }
}
module.exports = { MeetingSync, SOURCES, MEETINGS, tableBlocks, replaceBlocks, project, reconcile, freeze, connect, bind, sourceKey };

return module.exports;
})();
const { Dashboard } = (() => {
const module = { exports: {} };
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

return module.exports;
})();
const START = '<!-- menacose-table-links:start -->';
const END = '<!-- menacose-table-links:end -->';
const INDEX = /<!-- menacose-table-links:start -->[\s\S]*?<!-- menacose-table-links:end -->/;
function parseWiki(value) {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
  if (!m) return null;
  const target = m[1].trim();
  const path = target.split('#')[0];
  return { target, label: m[2] || path.split('/').pop().replace(/\.md$/i, '') };
}
function tables(text, transform) {
  return text.replace(/^```smart-table\s*\n([\s\S]*?)\n```/gm, (block, source) => {
    let data;
    try { data = JSON.parse(source); } catch { return block; }
    if (!Array.isArray(data.columns) || !Array.isArray(data.rows)) return block;
    const original = JSON.stringify(data);
    transform(data);
    return JSON.stringify(data) === original ? block : '```smart-table\n' + JSON.stringify(data) + '\n```';
  });
}
function linkedValues(text) {
  const seen = new Map();
  tables(text, data => {
    for (const row of data.rows) for (const cell of Object.values(row.cells || {})) {
      for (const value of Array.isArray(cell) ? cell : [cell]) {
        const link = parseWiki(value);
        if (link && !seen.has(link.target)) seen.set(link.target, value.trim());
      }
    }
  });
  return [...seen.values()];
}
function syncIndex(text) {
  const links = linkedValues(text);
  const existing = text.match(INDEX);
  if (!links.length) return existing ? text.replace(INDEX, '') : text;
  const index = START + '\n' + links.map(x => '- ' + x).join('\n') + '\n' + END;
  if (existing) return text.replace(INDEX, index);
  return text.trimEnd() + '\n\n## Linked Notes\n\n' + index + '\n';
}
function renameWiki(value, oldPath, newPath, allowShort) {
  const link = parseWiki(value);
  if (!link) return value;
  const old = oldPath.replace(/\.md$/i, '');
  const next = newPath.replace(/\.md$/i, '');
  const oldName = old.split('/').pop();
  const nextName = next.split('/').pop();
  const hash = link.target.indexOf('#');
  const path = (hash < 0 ? link.target : link.target.slice(0, hash)).replace(/\.md$/i, '');
  if (path !== old && !(allowShort && path === oldName)) return value;
  const suffix = hash < 0 ? '' : link.target.slice(hash);
  const hasAlias = value.includes('|');
  const label = hasAlias ? (link.label === oldName ? nextName : link.label) : '';
  return '[[' + next + suffix + (label ? '|' + label : '') + ']]';
}
function renameTables(text, oldPath, newPath, allowShort = true) {
  const oldName = oldPath.split('/').pop().replace(/\.md$/i, '');
  const newName = newPath.split('/').pop().replace(/\.md$/i, '');
  return tables(text, data => {
    for (const row of data.rows) for (const [key, value] of Object.entries(row.cells || {})) {
      if (Array.isArray(value)) row.cells[key] = value.map(x => renameWiki(x, oldPath, newPath, allowShort));
      else row.cells[key] = renameWiki(value, oldPath, newPath, allowShort);
      if (key === 'related_work' && allowShort && value === oldName) row.cells[key] = newName;
    }
    for (const col of data.columns) if (col.id === 'related_work' && allowShort) {
      for (const option of col.options || []) if (option.label === oldName) option.label = newName;
      if (data.filters?.[col.id] === oldName) data.filters[col.id] = newName;
    }
  });
}
module.exports = class MenacoseTableLinks extends Plugin {
  onload() {
    this.timers = new Map();
    this.renameTimers = new Set();
    this.linkViews = new Map();
    this.alive = true;
    this.queue = Promise.resolve();
    this.meetingSync = new MeetingSync(this, Notice);
    this.dashboard = new Dashboard(this, MarkdownRenderChild);
    this.register(() => {
      this.alive = false;
      for (const timer of this.timers.values()) clearTimeout(timer);
      for (const timer of this.renameTimers) clearTimeout(timer);
      clearTimeout(this.paintTimer);
      for (const dispose of this.linkViews.values()) dispose();
      this.linkViews.clear();
    });
    this.registerEvent(this.app.vault.on('modify', file => this.scheduleIndex(file)));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (file instanceof TFile && file.extension === 'md') {
        // Let Obsidian finish its native link updates before updating code-block data.
        const timer = setTimeout(() => {
          this.renameTimers.delete(timer);
          this.enqueue(() => this.renameReferences(file.path, oldPath));
        }, 350);
        this.renameTimers.add(timer);
      }
    }));
    this.registerMarkdownPostProcessor((el, ctx) => {
      el.dataset.menacoseSourcePath = ctx.sourcePath;
      this.schedulePaint();
    });
    this.app.workspace.onLayoutReady(() => {
      if (!this.alive) return;
      for (const file of this.app.vault.getMarkdownFiles()) this.scheduleIndex(file);
      const doc = this.app.workspace.containerEl.ownerDocument;
      this.document = doc;
      this.observer = new MutationObserver(() => this.schedulePaint());
      this.observer.observe(this.app.workspace.containerEl, { childList: true, subtree: true });
      this.register(() => this.observer.disconnect());
      this.registerDomEvent(doc, 'change', event => {
        if (event.target.matches?.('.smart-table-cell-text')) this.enhance(event.target);
      });
      this.schedulePaint();
    });
  }
  enqueue(job) {
    this.queue = this.queue.then(() => this.alive && job()).catch(error => console.error('[MENACOSE Table Links]', error));
  }
  scheduleIndex(file) {
    if (!(file instanceof TFile) || file.extension !== 'md' || !this.alive) return;
    clearTimeout(this.timers.get(file.path));
    this.timers.set(file.path, setTimeout(() => {
      this.timers.delete(file.path);
      this.enqueue(() => this.syncFile(file));
    }, 250));
  }
  async syncFile(file) {
    if (this.app.vault.getAbstractFileByPath(file.path) !== file) return;
    const text = await this.app.vault.cachedRead(file);
    if (syncIndex(text) === text) return;
    await this.app.vault.process(file, syncIndex);
  }
  async renameReferences(newPath, oldPath) {
    const oldName = oldPath.split('/').pop().replace(/\.md$/i, '');
    const allowShort = !this.app.vault.getMarkdownFiles().some(file => file.basename === oldName && file.path !== newPath);
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.alive) return;
      const transform = text => syncIndex(renameTables(text, oldPath, newPath, allowShort));
      const text = await this.app.vault.cachedRead(file);
      if (transform(text) !== text) await this.app.vault.process(file, transform);
    }
    this.schedulePaint();
  }
  schedulePaint() {
    if (!this.alive) return;
    clearTimeout(this.paintTimer);
    this.paintTimer = setTimeout(() => {
      if (!this.alive) return;
      for (const [wrapper, dispose] of this.linkViews) {
        if (wrapper.isConnected === false) { dispose(); this.linkViews.delete(wrapper); }
      }
      this.app.workspace.containerEl.querySelectorAll('.smart-table-cell-text').forEach(input => this.enhance(input));
    }, 60);
  }
  sourcePath(input) {
    const marked = input.closest('[data-menacose-source-path]');
    if (marked) return marked.dataset.menacoseSourcePath;
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      if (leaf.view instanceof MarkdownView && leaf.view.containerEl.contains(input)) return leaf.view.file?.path || '';
    }
    return this.app.workspace.getActiveFile()?.path || '';
  }
  enhance(input) {
    if (input.closest('.menacose-table-link-cell') || !parseWiki(input.value)) return;
    const source = this.sourcePath(input);
    const doc = input.ownerDocument;
    const wrapper = doc.createElement('div');
    wrapper.className = 'menacose-table-link-cell';
    const display = doc.createElement('div');
    display.className = 'menacose-table-link-display';
    const anchor = doc.createElement('a');
    anchor.className = 'internal-link menacose-table-note-link';
    const edit = doc.createElement('button');
    edit.className = 'menacose-table-link-edit';
    edit.type = 'button';
    edit.textContent = '✎';
    edit.setAttribute('aria-label', 'Edit Note Link');
    edit.title = 'Edit Note Link';
    const refresh = () => {
      const link = parseWiki(input.value);
      input.hidden = Boolean(link);
      display.hidden = !link;
      if (link) {
        anchor.textContent = link.label;
        anchor.setAttribute('href', '#' + encodeURIComponent(link.target));
        anchor.setAttribute('data-href', link.target);
        anchor.title = 'Open ' + link.target;
      }
    };
    anchor.addEventListener('click', event => {
      const link = parseWiki(input.value);
      if (!link) return;
      event.preventDefault();event.stopPropagation();
      this.app.workspace.openLinkText(link.target, source, event.metaKey || event.ctrlKey);
    });
    anchor.addEventListener('mouseover', event => {
      const link = parseWiki(input.value);
      if (link) this.app.workspace.trigger('hover-link', { event, source: 'menacose-table-links', hoverParent: wrapper, targetEl: anchor, linktext: link.target, sourcePath: source });
    });
    edit.addEventListener('click', event => {
      event.preventDefault();event.stopPropagation();
      input.hidden = false;display.hidden = true;input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    input.addEventListener('change', refresh);
    input.addEventListener('blur', refresh);
    this.linkViews.set(wrapper, () => {
      input.removeEventListener('change', refresh);
      input.removeEventListener('blur', refresh);
      input.hidden = false;
      if (wrapper.parentNode) wrapper.replaceWith(input);
    });
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);wrapper.appendChild(display);
    display.appendChild(anchor);display.appendChild(edit);
    refresh();
  }
};
module.exports.helpers = { parseWiki, linkedValues, syncIndex, renameWiki, renameTables };

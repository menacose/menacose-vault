'use strict';
const { Plugin, TFile, MarkdownView, Notice } = require('obsidian');
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

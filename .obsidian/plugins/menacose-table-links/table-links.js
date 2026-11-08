'use strict';
const { Plugin, TFile, MarkdownView, Notice, MarkdownRenderChild } = require('obsidian');
const { MeetingSync } = require('./meeting-sync');
const { Dashboard } = require('./dashboard');
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

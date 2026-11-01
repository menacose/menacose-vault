'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Dashboard, PATHS } = require('../dashboard');
class Element {
  constructor(tag = 'div', options = {}) {
    this.tag = tag; this.children = []; this.listeners = {}; this.text = options.text || '';
    this.dataset = {}; this.isConnected = false; this.value = options.attr?.value || '';
  }
  empty() { this.children = []; }
  addClass() {}
  createEl(tag, options) { const el = new Element(tag, options); this.children.push(el); return el; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  addEventListener(event, callback) { this.listeners[event] = callback; }
  find(tag) {
    for (const child of this.children) { if (child.tag === tag) return child; const found = child.find(tag); if (found) return found; }
    return null;
  }
}
test('dashboard mounts, filters, refreshes, opens source links and releases its view', async () => {
  const fence = String.fromCharCode(96).repeat(3);
  const emptyTable = field => fence + 'smart-table\n' +
    JSON.stringify({ columns: [{ id: field }], rows: [] }) + '\n' + fence;
  const docs = new Map([
    [PATHS.people + 'Omar Hussein.md', '---\ntype: person\nrole: Communications\n---\n'],
    [PATHS.actions, emptyTable('action')], [PATHS.work, emptyTable('work')], [PATHS.activities, emptyTable('activity')],
  ]);
  for (const date of ['20260104', '20261025'])
    docs.set(PATHS.board + 'Meeting Agenda and MoMs ' + date + '.md', '## Attendance\n- [x] Omar Hussein\n');
  const processors = new Map(), disposers = [], children = [], opened = [];
  const plugin = {
    app: {
      vault: { on: () => ({}), getMarkdownFiles: () => [...docs.keys()].map(path => ({ path })),
        read: async file => docs.get(file.path) },
      workspace: { openLinkText: (...args) => opened.push(args) },
    },
    register: fn => disposers.push(fn), registerEvent() {},
    registerInterval: timer => disposers.push(() => clearInterval(timer)),
    registerMarkdownCodeBlockProcessor: (language, callback) => processors.set(language, callback),
  };
  const dashboard = new Dashboard(plugin, class { constructor(el) { this.el = el; } });
  try {
    const el = new Element();
    processors.get('menacose-dashboard')('', el, { sourcePath: '00_Meta/Chapter Dashboard.md',
      addChild: child => children.push(child) });
    await dashboard.refresh();
    assert.equal(dashboard.views.size, 1, 'A detached element must survive the initial render.');
    assert.equal(el.find('select').value, 'year');
    const content = el.children[1];
    assert(content.innerHTML.includes('Core Team Participation'));
    assert(content.innerHTML.includes('Activity Attendance And Engagement'));
    assert(content.innerHTML.includes('Current Work And Follow Up'));
    el.find('select').value = 'quarter'; el.find('select').onchange();
    assert.equal([...dashboard.views][0].period, 'quarter');
    let prevented = false;
    el.children[1].listeners.click({
      target: { closest: () => ({ dataset: { notePath: PATHS.actions } }) },
      preventDefault: () => { prevented = true; }, stopPropagation() {}, metaKey: true,
    });
    assert(prevented);
    assert.deepEqual(opened[0], [PATHS.actions, '00_Meta/Chapter Dashboard.md', true]);
    docs.set(PATHS.actions, fence + 'smart-table\n' + JSON.stringify({
      columns: [{ id: 'action' }], rows: [{ id: 'new', cells: { action: 'New action', status: 'Pending' } }],
    }) + '\n' + fence);
    await el.find('button').onclick();
    assert.equal(dashboard.data.actions.length, 1);
    children[0].onunload();
    assert.equal(dashboard.views.size, 0);
  } finally { for (const dispose of disposers) dispose(); }
});

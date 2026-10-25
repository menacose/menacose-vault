'use strict';
const fs = require('node:fs');
const path = require('node:path');
const integration = fs.readFileSync(path.join(__dirname, 'table-links.js'), 'utf8');
const engine = fs.readFileSync(path.join(__dirname, 'meeting-sync.js'), 'utf8');
const target = "const { MeetingSync } = require('./meeting-sync');";
if (!integration.includes(target)) throw new Error('MeetingSync import was not found.');
const bundled = integration.replace(target,
  'const { MeetingSync } = (() => {\nconst module = { exports: {} };\n' +
  engine + '\nreturn module.exports;\n})();');
fs.writeFileSync(path.join(__dirname, 'main.js'), bundled);
process.stdout.write('Built self-contained main.js.\n');

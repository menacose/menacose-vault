'use strict';
const fs = require('node:fs');
const path = require('node:path');
const integration = fs.readFileSync(path.join(__dirname, 'table-links.js'), 'utf8');
let bundled = integration;
for (const [moduleName, exported] of [['meeting-sync', 'MeetingSync'], ['dashboard', 'Dashboard']]) {
  const source = fs.readFileSync(path.join(__dirname, moduleName + '.js'), 'utf8');
  const target = "const { " + exported + " } = require('./" + moduleName + "');";
  if (!bundled.includes(target)) throw new Error(exported + ' import was not found.');
  bundled = bundled.replace(target,
    'const { ' + exported + ' } = (() => {\nconst module = { exports: {} };\n' +
    source + '\nreturn module.exports;\n})();');
}
fs.writeFileSync(path.join(__dirname, 'main.js'), bundled);
process.stdout.write('Built self-contained main.js.\n');

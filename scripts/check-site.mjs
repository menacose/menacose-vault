import fs from 'node:fs';
import assert from 'node:assert/strict';
for (const file of ['index.html','app.js','style.css','data.json','team.json','assets/menacose-logo.png','assets/mena-globe.png']) {
  assert(fs.statSync(new URL('../public/'+file,import.meta.url)).size>0,`Missing or empty website file: ${file}`);
}
const data=JSON.parse(fs.readFileSync(new URL('../public/data.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
for(const key of ['actions','projects','meetings']) assert(Array.isArray(data[key]),`Invalid snapshot: ${key}`);
const team=JSON.parse(fs.readFileSync(new URL('../public/team.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
assert(Array.isArray(team.members)&&team.members.length>0,'Missing core team');
console.log(`Site ready: ${data.actions.length} actions, ${data.projects.length} workstreams, ${team.members.length} team members.`);

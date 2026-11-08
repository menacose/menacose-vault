import fs from 'node:fs';
import path from 'node:path';
const vault=path.resolve(process.argv[2] || '../menacose-vault');
const root=path.resolve(import.meta.dirname,'..');
function table(file){const text=fs.readFileSync(path.join(vault,file),'utf8'); const blocks=[...text.matchAll(/```smart-table\s*\n([\s\S]*?)```/g)];if(!blocks.length)throw Error('Missing smart table: '+file);return JSON.parse(blocks[0][1]).rows;}
const clean=s=>String(s||'').replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g,'$2').replace(/\[\[([^\]]+)\]\]/g,'$1');
const source=file=>'obsidian://open?vault='+encodeURIComponent(path.basename(vault))+'&file='+encodeURIComponent(file);
const actionFile='04_Projects/Action Register.md', workFile='04_Projects/Work Overview.md';
const actions=table(actionFile).map(r=>({id:r.id,...Object.fromEntries(Object.entries(r.cells).map(([k,v])=>[k,clean(v)])),source:source(actionFile)}));
const projects=table(workFile).map(r=>({id:r.id,...Object.fromEntries(Object.entries(r.cells).map(([k,v])=>[k,clean(v)])),source:source(workFile)}));
const folder='03_Meetings/03.01_Board-Meetings';
const meetings=fs.readdirSync(path.join(vault,folder)).filter(x=>/\d{8}\.md$/.test(x)).sort().reverse().map(file=>{const text=fs.readFileSync(path.join(vault,folder,file),'utf8');const stamp=file.match(/(\d{4})(\d{2})(\d{2})/);const focus=text.match(/\*\*Focus Today:\*\*\s*([^\n]+)/);return {title:file.replace('.md',''),date:stamp.slice(1).join('-'),focus:focus?focus[1]:'Weekly core team agenda and progress review.',source:source(folder+'/'+file)};});
const data={importedAt:new Date().toISOString(),actions,projects,meetings};
fs.writeFileSync(path.join(root,'public/data.json'),JSON.stringify(data,null,2));
console.log(`Imported ${actions.length} actions, ${projects.length} workstreams and ${meetings.length} meetings.`);

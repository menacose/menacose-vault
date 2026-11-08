import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../public');
http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);res.end('Not found');return;}res.setHeader('Content-Type',({'html':'text/html','css':'text/css','js':'text/javascript','json':'application/json'})[file.split('.').pop()]||'application/octet-stream');res.end(data);});}).listen(4173,'127.0.0.1',()=>console.log('MENACOSE Hub: http://127.0.0.1:4173'));

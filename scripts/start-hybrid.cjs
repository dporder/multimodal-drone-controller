// Start both processes, reusing only a matching local Swarm Lab service.
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),children=[];
async function matches(url,predicate){try{const r=await fetch(url,{signal:AbortSignal.timeout(800)});return r.ok&&predicate(await r.text());}catch{return false;}}
function start(command,args){const child=spawn(command,args,{cwd:root,stdio:'inherit'});children.push(child);child.on('error',e=>{console.error(e.message);stop(1);});child.on('exit',code=>{if(code)stop(code);});}
function stop(code=0){for(const c of children)if(c.exitCode===null)c.kill('SIGTERM');process.exitCode=code;}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
(async()=>{
 if(!await matches('http://127.0.0.1:8766/browser/',text=>text.includes('Swarm Lab')))start(process.execPath,['scripts/serve-browser.cjs']);
 if(!await matches('http://127.0.0.1:8767/health',text=>text.includes('swarm-drone-controller'))){const local=path.join(root,'.venv/bin/python');start(process.env.SWARM_PYTHON||(fs.existsSync(local)?local:'python3'),['-m','swarm_lab.drone_backend','--port','8767']);}
 console.log('Open http://127.0.0.1:8766/browser/ · JavaScript physics + Python drone controllers');
})().catch(e=>{console.error(e.message);stop(1);});

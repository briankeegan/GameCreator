const { chromium } = require('/home/user/GameCreator/node_modules/playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT='/home/user/GameCreator',PORT=8512;
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=http.createServer((q,r)=>{const a=path.join(ROOT,decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/,''));
 fs.readFile(a,(e,b)=>{if(e){r.writeHead(404);return r.end('nf');}r.writeHead(200,{'Content-Type':MIME[path.extname(a).toLowerCase()]||'application/octet-stream'});r.end(b);});});
let fails=0;
(async()=>{
 await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
 const br=await chromium.launch();
 const pg=await (await br.newContext({viewport:{width:900,height:700}})).newPage();
 pg.on('pageerror',e=>{console.log('PAGE ERROR',e.message);fails++;});
 await pg.goto(`http://127.0.0.1:${PORT}/games/the-game/index.html`);
 await pg.waitForFunction(()=>!!window.__newseyDebug);
 await pg.click('#titleStart'); await pg.waitForTimeout(300);
 await pg.locator('.file-slot').first().click(); await pg.waitForTimeout(400);
 for(let i=0;i<40;i++) await pg.click('#cutscene',{force:true}).catch(()=>{});
 await pg.waitForTimeout(700);
 for(let i=0;i<12;i++){ await pg.keyboard.press('z'); await pg.waitForTimeout(50); }

 // VISIT every room first. canStand needs that room's walk mask decoded, and
 // an unvisited room has none — asking about it answers "you cannot stand
 // anywhere", which reads exactly like a door with no arrival.
 for (const id of await pg.evaluate(()=>Object.keys(NEWSEY_STORY.ROOMS))) {
   await pg.evaluate((id)=>__newseyDebug.enterRoom(id), id);
   await pg.waitForTimeout(220);
 }
 const rows = await pg.evaluate(()=>{
   const R=NEWSEY_STORY.ROOMS, out=[];
   for (const id of Object.keys(R)) {
     for (const ex of (R[id].exits||[])) {
       const dest=ex.to, link=ex.link;
       if(!R[dest]) continue;
       const partner=(R[dest].exits||[]).find(e=>e.link===link);
       const a=__newseyDebug.arrivalFrom(dest, link);
       if(!a){ out.push({id,link,dest,err:'NO ARRIVAL'}); continue; }
       if(!partner){ out.push({id,link,dest,err:'no partner rect (npc link)'}); continue; }
       // is the arrival point inside the partner door's own rectangle?
       const pw=__newseyDebug.player.w, ph=__newseyDebug.player.h;
       const on = a.x+pw>partner.x && a.x<partner.x+partner.w &&
                  a.y+ph>partner.y && a.y<partner.y+partner.h;
       const cx=a.x+pw/2, cy=a.y+ph/2;
       const dx=Math.max(partner.x-cx, cx-(partner.x+partner.w), 0);
       const dy=Math.max(partner.y-cy, cy-(partner.y+partner.h), 0);
       out.push({id,link,dest,on,gap:Math.round(Math.hypot(dx,dy)),facing:a.facing});
     }
   }
   return out;
 });
 console.log('leaving        via          you arrive in    does it land on that door?');
 for(const r of rows){
   if(r.err){ console.log(`  ${r.id} ${r.link} -> ${r.dest}: ${r.err}`); if(r.err==='NO ARRIVAL')fails++; continue; }
   const tag = r.on ? 'lands on the door' : `MISSES BY ${r.gap}px`;
   if(!r.on) fails++;
   console.log(`  ${r.id.padEnd(13)} ${r.link.padEnd(11)} -> ${r.dest.padEnd(13)} ${tag}  facing ${r.facing}`);
 }
 console.log(fails?`\n${fails} door(s) do not arrive on their partner`:'\nevery door arrives on its partner');
 await br.close(); server.close(); process.exit(fails?1:0);
})();

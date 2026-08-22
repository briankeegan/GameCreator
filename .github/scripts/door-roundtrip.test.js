const { chromium } = require('/home/user/GameCreator/node_modules/playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT='/home/user/GameCreator',PORT=8517;
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=http.createServer((q,r)=>{const a=path.join(ROOT,decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/,''));
 fs.readFile(a,(e,b)=>{if(e){r.writeHead(404);return r.end('nf');}r.writeHead(200,{'Content-Type':MIME[path.extname(a).toLowerCase()]||'application/octet-stream'});r.end(b);});});
let fails=0; const ok=(n,c,x)=>{console.log((c?'  ok  ':'  FAIL')+'  '+n+(x===undefined?'':'   '+x)); if(!c)fails++;};
(async()=>{
 await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
 const br=await chromium.launch();
 const pg=await (await br.newContext({viewport:{width:900,height:700}})).newPage();
 pg.on('pageerror',e=>{console.log('  PAGE ERROR',e.message);fails++;});
 await pg.goto(`http://127.0.0.1:${PORT}/games/the-game/index.html`);
 await pg.waitForFunction(()=>!!window.__newseyDebug);
 await pg.click('#titleStart'); await pg.waitForTimeout(300);
 await pg.locator('.file-slot').first().click(); await pg.waitForTimeout(400);
 for(let i=0;i<40;i++) await pg.click('#cutscene',{force:true}).catch(()=>{});
 await pg.waitForTimeout(700);
 for(let i=0;i<12;i++){ await pg.keyboard.press('z'); await pg.waitForTimeout(50); }
 const room=()=>pg.evaluate(()=>__newseyDebug.room());
 const walk=async(key,ms)=>{ await pg.keyboard.down(key); await pg.waitForTimeout(ms); await pg.keyboard.up(key); await pg.waitForTimeout(1800); };

 // Bedroom -> Lounge -> straight back. This is the reported stuck case.
 await pg.evaluate(()=>__newseyDebug.enterRoom('bedroom')); await pg.waitForTimeout(1200);
 await pg.evaluate(()=>{const e=NEWSEY_STORY.ROOMS.bedroom.exits.find(x=>x.link==='westDoor');
   const p=__newseyDebug.player; p.x=e.x-10; p.y=e.y+e.h/2-p.h/2;});
 await pg.waitForTimeout(200);
 await walk('ArrowRight',900);
 ok('bedroom -> lounge', (await room())==='The Lounge', 'room='+(await room()));
 await walk('ArrowLeft',900);
 ok('and straight back again, no getting stuck', (await room())==='Your Room, Infinity', 'room='+(await room()));
 await walk('ArrowRight',900);
 ok('and through once more', (await room())==='The Lounge', 'room='+(await room()));
 console.log(fails?`\n${fails} FAILED`:'\nall passed');
 await br.close(); server.close(); process.exit(fails?1:0);
})();

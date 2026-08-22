const { chromium } = require('/home/user/GameCreator/node_modules/playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT='/home/user/GameCreator',PORT=8510;
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
 const put=(x,y)=>pg.evaluate(([x,y])=>{const p=__newseyDebug.player; p.x=x-p.w/2; p.y=y-p.h/2;},[x,y]);
 const go=(id)=>pg.evaluate((id)=>__newseyDebug.enterRoom(id),id);

 await go('lounge'); await pg.waitForTimeout(1200);
 console.log('in', await room());
 const ex = await pg.evaluate(()=>NEWSEY_STORY.ROOMS.lounge.exits.map(e=>({link:e.link,x:e.x,y:e.y,w:e.w,h:e.h})));
 const east = ex.find(e=>e.link==='eastDoor');

 // 1. stand ON the east door but walk the WRONG way (up) — must NOT fire
 await put(east.x+east.w/2, east.y+east.h/2); await pg.waitForTimeout(200);
 await pg.keyboard.down('ArrowUp'); await pg.waitForTimeout(500); await pg.keyboard.up('ArrowUp');
 await pg.waitForTimeout(300);
 ok('standing on the east door and walking UP does not open it', (await room())==='The Lounge', 'room='+(await room()));

 // 2. same door, walking RIGHT — must fire
 await go('lounge'); await pg.waitForTimeout(1200);
 await put(east.x-6, east.y+east.h/2); await pg.waitForTimeout(200);
 await pg.keyboard.down('ArrowRight'); await pg.waitForTimeout(900); await pg.keyboard.up('ArrowRight');
 await pg.waitForTimeout(1800);
 ok('walking RIGHT into the east door opens it', (await room())==="Kyran's Lab", 'room='+(await room()));

 // 3. the back arch needs UP, not a graze
 await go('lounge'); await pg.waitForTimeout(1200);
 const arch = ex.find(e=>e.link==='northArch');
 await put(arch.x+arch.w/2, arch.y+arch.h/2); await pg.waitForTimeout(200);
 await pg.keyboard.down('ArrowRight'); await pg.waitForTimeout(400); await pg.keyboard.up('ArrowRight');
 await pg.waitForTimeout(300);
 ok('standing in the back arch and walking sideways does not open it', (await room())==='The Lounge', 'room='+(await room()));
 await go('lounge'); await pg.waitForTimeout(1200);
 await put(arch.x+arch.w/2, arch.y+arch.h+8); await pg.waitForTimeout(200);
 await pg.keyboard.down('ArrowUp'); await pg.waitForTimeout(900); await pg.keyboard.up('ArrowUp');
 await pg.waitForTimeout(1800);
 ok('walking UP into the back arch opens it', (await room())==='The Library', 'room='+(await room()));

 console.log(fails?`\n${fails} FAILED`:'\nall passed');
 await br.close(); server.close(); process.exit(fails?1:0);
})();

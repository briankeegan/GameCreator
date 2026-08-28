const { chromium } = require('/home/user/GameCreator/node_modules/playwright');
const { shoot } = require(require('path').join(__dirname,'shoot.js'));
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT='/home/user/GameCreator',PORT=8515,OUT=process.env.OUT;
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=http.createServer((q,r)=>{const a=path.join(ROOT,decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/,''));
 fs.readFile(a,(e,b)=>{if(e){r.writeHead(404);return r.end('nf');}r.writeHead(200,{'Content-Type':MIME[path.extname(a).toLowerCase()]||'application/octet-stream'});r.end(b);});});
(async()=>{
 await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
 const br=await chromium.launch();
 const pg=await (await br.newContext({viewport:{width:700,height:500}})).newPage();
 await pg.goto(`http://127.0.0.1:${PORT}/games/the-game/index.html`);
 await pg.waitForFunction(()=>!!window.__newseyDebug);
 await pg.click('#titleStart'); await pg.waitForTimeout(300);
 await pg.locator('.file-slot').first().click(); await pg.waitForTimeout(400);
 for(let i=0;i<40;i++) await pg.click('#cutscene',{force:true}).catch(()=>{});
 await pg.waitForTimeout(700);
 for(let i=0;i<12;i++){ await pg.keyboard.press('z'); await pg.waitForTimeout(50); }
 for (const r of ['lab','library','arena']) {
   await pg.evaluate((r)=>__newseyDebug.enterRoom(r), r);
   await pg.waitForTimeout(700);
   await shoot(pg.locator('#stage'), `${OUT}/room-${r}.png`, r);
 }
 await br.close(); server.close();
})();

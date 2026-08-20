const { chromium } = require('/home/user/GameCreator/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT='/home/user/GameCreator', PORT=8461, OUT='/tmp/claude-0/-home-user/e80c57f7-74a5-5949-a097-2632c64d4b5a/scratchpad';
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{const abs=path.join(ROOT,decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/,''));
  fs.readFile(abs,(e,b)=>{if(e){res.writeHead(404);return res.end('nf');}res.writeHead(200,{'Content-Type':MIME[path.extname(abs).toLowerCase()]||'application/octet-stream'});res.end(b);});});
let fails=0; const ok=(n,c,x)=>{console.log((c?'  ok  ':'  FAIL')+'  '+n+(x===undefined?'':'   '+x)); if(!c)fails++;};
(async()=>{
  await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
  const browser=await chromium.launch();
  const page=await (await browser.newContext({viewport:{width:1000,height:820}})).newPage();
  page.on('pageerror', e=>{console.log('  PAGE ERROR', e.message); fails++;});
  await page.goto(`http://127.0.0.1:${PORT}/games/the-game/index.html`);
  await page.waitForFunction(()=>!!window.__newseyDebug);
  await page.click('#titleStart'); await page.waitForTimeout(300);
  await page.locator('.file-slot').first().click(); await page.waitForTimeout(400);
  for (let i=0;i<40;i++) await page.click('#cutscene',{force:true}).catch(()=>{});
  await page.waitForTimeout(900);
  for (let i=0;i<12;i++){ await page.keyboard.press('z'); await page.waitForTimeout(60); }
  const room=()=>page.evaluate(()=>window.__newseyDebug.room());
  const feet=()=>page.evaluate(()=>({x:Math.round(__newseyDebug.player.x+7),y:Math.round(__newseyDebug.player.y+18)}));
  const walk=async(k,ms)=>{await page.keyboard.down(k);await page.waitForTimeout(ms);await page.keyboard.up(k);await page.waitForTimeout(150);};
  // hold a direction but stop the instant the room changes — otherwise a door
  // hands you to the next room and the next keypress hands you straight back,
  // and the test measures the far end of a loop instead of one transition.
  const until=async(k,from,ms=4000)=>{await page.keyboard.down(k);
    for(let t=0;t<ms;t+=100){await page.waitForTimeout(100); if((await room())!==from) break;}
    await page.keyboard.up(k); await page.waitForTimeout(200);};
  const onMask=()=>page.evaluate(()=>{
    const p=__newseyDebug.player, m=window.__m;
    const x=Math.round(p.x+p.w/2), y=Math.round(p.y+p.h);
    return !!m && m[(y*320+x)*4]>127;
  });
  await page.evaluate(async()=>{ await new Promise(res=>{const i=new Image();
    i.onload=()=>{const c=document.createElement('canvas');c.width=320;c.height=200;
      const cx=c.getContext('2d');cx.drawImage(i,0,0,320,200);window.__m=cx.getImageData(0,0,320,200).data;res();};
    i.onerror=()=>res(); i.src='art/walk-garden.png';}); });

  await page.evaluate(()=>__newseyDebug.enterRoom('garden'));
  await page.waitForTimeout(700);
  ok('lands in the garden on the floor plate', (await room())==='The Anarchy Garden' && await onMask(), JSON.stringify(await feet()));

  // shove into every edge and every prop; must never leave the plate
  const dirs=[['ArrowUp','up'],['ArrowDown','down'],['ArrowLeft','left'],['ArrowRight','right']];
  for (const [k,name] of dirs) {
    await page.evaluate(()=>__newseyDebug.enterRoom('garden'));
    await page.waitForTimeout(200);
    await until(k, 'The Anarchy Garden', 2600);
    const stillHere = (await room())==='The Anarchy Garden';
    ok(`hard ${name} stays on the plate`, !stillHere || await onMask(),
       (stillHere ? '' : 'left via a door: ') + JSON.stringify(await feet()));
  }
  // corner scrub
  await page.evaluate(()=>__newseyDebug.enterRoom('garden'));
  await page.waitForTimeout(200);
  for (const c of [['ArrowUp','ArrowLeft'],['ArrowUp','ArrowRight'],['ArrowDown','ArrowRight'],['ArrowDown','ArrowLeft']]) {
    await page.keyboard.down(c[0]); await page.keyboard.down(c[1]); await page.waitForTimeout(900);
    await page.keyboard.up(c[0]); await page.keyboard.up(c[1]);
  }
  ok('scrubbing every corner stays on the plate', await onMask(), JSON.stringify(await feet()));

  // walk into a statue and a tree — must stop short of the base
  const into = async (fromX,fromY,key,ms) => {
    await page.evaluate(([x,y])=>__newseyDebug.enterRoom('garden',{x,y}),[fromX,fromY]);
    await page.waitForTimeout(200); await walk(key,ms); return await feet();
  };
  const propOf = (art, n=0)=>page.evaluate(([art,n])=>{
    const ps = NEWSEY_STORY.ROOMS.garden.props.filter(p=>p.art===art);
    return ps[n] || null; }, [art,n]);
  const fountain = await propOf('prop_fountain', 2);   // the near-left one
  const tree = await propOf('prop_cherry', 0);
  let f = await into(fountain.x - 6, fountain.y + 30, 'ArrowUp', 1800);
  ok('walking up into a fountain stops at its base', f.y > fountain.y - 4,
     JSON.stringify(f) + ' vs base y=' + fountain.y);
  f = await into(tree.x + 2, tree.y + 36, 'ArrowUp', 1800);
  ok('walking up into a cherry tree stops at its trunk', f.y > tree.y - 6,
     JSON.stringify(f) + ' vs base y=' + tree.y);
  f = await into(160, 100, 'ArrowUp', 2400);
  ok('you cannot walk into the pool', await onMask(), JSON.stringify(f));

  // flowers must NOT block
  // A flower patch has no footprint at all, so the only honest test is to ask
  // the collision code directly rather than to infer it from a walk that other
  // props are also constraining.
  const blocked = (x,y)=>page.evaluate(([x,y])=>{
    const props = NEWSEY_STORY.ROOMS.garden.props;
    let hit=false;
    props.forEach(p=>{ if(!p.base) return;
      if (p.base.w!==undefined){ if(Math.abs(x-p.x)<p.base.w/2 && Math.abs(y-p.y)<p.base.h/2) hit=true; }
      else { const dx=(x-p.x)/p.base.rx, dy=(y-p.y)/p.base.ry; if(dx*dx+dy*dy<1) hit=true; } });
    return hit;
  },[x,y]);
  ok('flower patches block nothing', !(await blocked(84,96)) && !(await blocked(236,104)));
  ok('a fountain base does block', await blocked(96,108));
  const wall = await propOf('prop_wall', 0);
  ok('the wall does block', await blocked(wall.x, wall.y - 2),
     'wall at ' + wall.x + ',' + wall.y);
  ok('the gap in the wall does not', !(await blocked(162, wall.y - 2)));

  // the way out
  await page.evaluate(()=>__newseyDebug.enterRoom('garden'));
  await page.waitForTimeout(250);
  await until('ArrowDown', 'The Anarchy Garden');
  ok('the path through the wall leads back out', (await room())==='The Lounge', await room());

  await page.evaluate(()=>__newseyDebug.enterRoom('garden'));
  await page.waitForTimeout(500);
  await page.locator('#scene').screenshot({path: OUT+'/garden-final.png'});
  console.log(fails?`\n${fails} FAILED`:'\nall passed');
  await browser.close(); server.close(); process.exit(fails?1:0);
})();

// PREDICTION AGAINST THE GAME: node survivor_predcheck.js DIR[:SUFFIX]... over a fight run's artifacts (frames-*, death-*): for each decision the board it was made on against the real
// board at that clock -- the decisions whose predicted garbage is 6+ cells over the real one, and why.
var cp=require('child_process'),v8=require('v8');var E='/home/user/GameCreator/games/the-game/ai/eval';var PA=require(E+'/../../pa-engine.js'),CK=require(E+'/survivor_checks.js');
function z(f){return cp.execSync('zcat '+f+' 2>/dev/null; true',{maxBuffer:1e9}).toString().trim().split('\n').filter(x=>x.slice(-1)==='}');}
var T={n:0,garbMore:0,panelsMore:0,both:0,neither:0},ex=0;
process.argv.slice(2).forEach(function(pair){var dir=pair.split(':')[0],suf=pair.split(':')[1]||'';
 var d=JSON.parse(z(dir+'/death-WasmAgro_CPU'+suf+'.jsonl.gz').pop());var F=z(dir+'/frames-WasmAgro_CPU'+suf+'.jsonl.gz').map(JSON.parse);
 function realAt(c){var cur=null;for(var i=0;i<F.length;i++){if(F[i].clock>c)break;if(F[i].grid)cur=F[i];}if(!cur)return null;var t=0,g=0,p=0;cur.grid.split('\n').forEach(function(r){var n=+r.slice(0,3);if(!n)return;var b=r.slice(3);for(var c=0;c<6;c++){var ch=b[c*2];if(ch==='G')g++;else if(ch&&ch!==' '&&ch!=='.')p++;}if(/[1-9G]/.test(b))t=Math.max(t,n);});return {top:t,g:g,p:p};}
 var A={};d.asked.forEach(q=>A[q.id]=q);
 d.decided.forEach(function(x){var q=A[x.id];if(!q)return;var b=PA.revive(v8.deserialize(Buffer.from(q.board,'base64')));var real=realAt(b.clock);if(!real)return;
  var pt=CK.fullTop(b);if(pt-real.top<3)return;var pg=0,pp=0;for(var r=1;r<b.panels.length;r++)for(var c=1;c<=6;c++){var p=b.panels[r]&&b.panels[r][c];if(!p)continue;if(p.isGarbage)pg++;else if(p.color)pp++;}
  T.n++;var gm=pg-real.g>=6,pm=pp-real.p>=6;if(gm&&pm)T.both++;else if(gm)T.garbMore++;else if(pm)T.panelsMore++;else T.neither++;
  if(ex++<4)console.log('clock',b.clock,'lead',x.at-x.now,'predicted garbage cells',pg,'real',real.g,'| predicted panels',pp,'real',real.p,'| arrivals',JSON.stringify(q.arrivals).slice(0,100),'incoming',(b.incoming||[]).length);});});
console.log(JSON.stringify(T));

// HOW FAR AWAY IS THE NEXT CHAIN? Run: node chain_reach.js
//
// THE QUESTION THIS SETTLES. Scoring a move on its FULLY RESOLVED board
// should make lookahead unnecessary for any chain that fires now: the
// cascade is already in the number. So if depth 2 buys nothing, either the
// resolve is not really cascading, or the chains it would find are further
// away than one extra ply. This measures both, on the game's own 84 chain
// puzzles, in under a second.
//
// ANSWER, 2026-09-12:
//   Q1  a swap that sets off a 3-link cascade reports chainLength 3 and
//       combos 3+3+3 from ONE resolve() at depth 1. The cascade is seen
//       whole. Nothing is missing there.
//   Q2  fewest swaps before a 2+ link chain exists at all:
//           1 swap   18 puzzles     <- depth 1 already takes all 18
//           2 swaps   8 puzzles     <- the entire ceiling on depth 2
//           3 swaps   4 puzzles
//           4+/never 54 puzzles
//
// So depth 2 is not failing. Its best possible gain is 8 boards out of 84,
// and the seed-to-seed spread on this benchmark is 19-22, which swallows it.
// Reaching the other 54 means searching four-plus swaps ahead: ~30 legal
// swaps a ply is ~810,000 boards per decision against an 85ms budget, so
// that door is closed by arithmetic, not by tuning.
//
// Which is the reference's point in ../PUYO_REFERENCE.md: Tier 2 is search
// AND named chain templates, "it does not discover chain shapes, it is told
// them". You cannot search your way to a chain that is four swaps out; you
// price how close the board is to a shape you already know.
var path=require('path'), fs=require('fs');
var DIR='/home/user/GameCreator/games/the-game/ai/eval';
require(path.join(DIR,'..','..','panel-engine.js'));
require(path.join(DIR,'..','..','panel-cpu.js'));
var LogicalBoard=globalThis.PanelCpu.LogicalBoard;
var W=6,H=12;
var FILE='/home/user/panel-game/client/assets/default_data/puzzles/Puzzles.json';
function puzzles(){var j=JSON.parse(fs.readFileSync(FILE,'utf8')),o=[];
 (function w(n,t){(n['Puzzle Sets']||[]).forEach(function(s){w(s,t.concat(s['Set Name']||'?'));});
 (n['Puzzles']||[]).forEach(function(p){o.push({set:t.join('/'),p:p});});})(j,[]);return o;}
function boardFrom(st){var s=String(st).replace(/\s+/g,'');if(/[^0-9]/.test(s))return null;
 while(s.length%W)s='0'+s;var rows=[];for(var i=0;i<s.length;i+=W)rows.push(s.slice(i,i+W));
 var g=[];for(var r=0;r<=H;r++){g[r]=[];for(var c=1;c<=W;c++)g[r][c]=0;}
 for(var k=0;k<rows.length;k++){var row=rows.length-k;if(row>H)continue;
  for(var c2=1;c2<=W;c2++){var d=Number(rows[k][c2-1]);g[row][c2]=(d===8||d===9)?-2:d;}}
 return new LogicalBoard(W,H,9,g,{});}

var chains=puzzles().filter(function(x){return x.p['Puzzle Type']==='chain';});

// ---- Q1 ----
var deep=null;
chains.forEach(function(x){ if(deep) return; var b=boardFrom(x.p.Stack); if(!b) return;
  b.legalSwaps().forEach(function(m){ if(deep) return;
    var t=b.clone(); t.swap(m[0],m[1]); var r=t.resolve();
    if(r.chainLength>=3) deep={set:x.set.split('/').pop(),m:m,r:r,b:b}; }); });
if(deep){
  console.log('Q1  ' + deep.set + ': swap ' + JSON.stringify(deep.m) +
    ' -> resolve() reports chainLength ' + deep.r.chainLength +
    ', combos ' + deep.r.comboSizes.join('+') +
    ', ' + deep.r.garbage.length + ' garbage blocks sent.');
  console.log('    So a cascade that fires NOW is seen whole, in one call, at depth 1.');
}

// ---- Q2: minimum swaps to make a chain appear, brute force ----
function minSwapsToChain(b, limit){
  var seen={}, frontier=[b];
  for (var d=1; d<=limit; d++){
    var next=[];
    for (var i=0;i<frontier.length;i++){
      var cur=frontier[i], legal=cur.legalSwaps();
      for (var j=0;j<legal.length;j++){
        var t=cur.clone(); t.swap(legal[j][0],legal[j][1]);
        var r=t.resolve();
        if (r.chainLength>=2) return d;
        if (d<limit){
          var key=t.grid.map(function(row){return row.join(',');}).join('|');
          if(!seen[key]){ seen[key]=1; next.push(t); }
        }
      }
    }
    frontier=next;
    if(!frontier.length) break;
  }
  return null;
}

var hist={}, none=0, n=0;
chains.forEach(function(x){
  var b=boardFrom(x.p.Stack); if(!b) return; n++;
  var d=minSwapsToChain(b,3);
  if(d===null){ none++; } else { hist[d]=(hist[d]||0)+1; }
});
console.log('\nQ2  fewest swaps needed before a 2+ link chain fires, over ' + n + ' chain puzzles:');
Object.keys(hist).sort().forEach(function(k){ console.log('      ' + k + ' swap(s): ' + hist[k]); });
console.log('      more than 3 (or never): ' + none);

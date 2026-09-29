// THE INVARIANT, TESTED WHERE IT CAN HOLD: no opponent, so no incoming garbage.
// A vector chooses how the bot attacks and defends; on a board nobody is
// attacking, no vector should be able to kill it.
require('/home/user/GameCreator/games/the-game/panel-engine.js');
require('/home/user/GameCreator/games/the-game/panel-cpu.js');
var B = require('/home/user/GameCreator/games/the-game/ai/eval/bitbot.js');
var BF = require('/home/user/GameCreator/games/the-game/ai/eval/bitfeatures.js');
var P = globalThis.PanelEngine, KEYS = BF.keys();
function vec(seed){var w={},x=seed;for(var i=0;i<KEYS.length;i++){x=(x*1103515245+12345)&0x7fffffff;w[KEYS[i]]=Math.round(((x/0x7fffffff)*2-1)*100);}return w;}
var VEC=[['STARTER',null],['ZERO',{}]];
for (var v=1;v<=4;v++) VEC.push(['rand'+v, vec(v*7919)]);
var dead=0, runs=0;
VEC.forEach(function(V){
  var line=V[0].padEnd(8);
  [101,103,105,107].forEach(function(sd){
    var st=new P.Stack({level:10,seed:sd,countdown:false});
    var o={allowRaise:true}; if(V[1]) o.weights=V[1];
    var b=new B(st,o);
    var f=0;
    for(;f<30000&&!st.gameOver;f++){ b.update(); st.run(); st.takeDeliverableGarbage(); st.drainEvents(); }
    runs++; if(st.gameOver) dead++;
    line += ' ' + sd + ':' + (st.gameOver?('DEAD@'+f):'alive');
  });
  console.log(line);
});
console.log('\ninvariant: ' + dead + ' deaths in ' + runs + ' solo games');
if (dead) { console.log(dead + ' FAILURES -- a weight vector killed the bot with nobody attacking it'); process.exit(1); }
console.log('invariant: OK');

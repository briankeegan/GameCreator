#!/usr/bin/env node
// GARBAGE THE GAME HOLDS BACK is not landed on the board a decision is made on (survivor_shared.js land's hold, survivor_match.js held),
// and a stack's own garbage queue is a readiness arrival the engine accepts (survivor_think.js readyArr).
//
//   node survivor_held.test.js
var assert = require('assert'), path = require('path');
var PA = require(path.join(__dirname, '..', '..', 'pa-engine.js')), SH = require('./survivor_shared.js');
var M = require('./survivor_match.js').Match;
var st = PA.puzzle('123456');
var chainPiece = { width: 6, height: 1, isChain: true, isMetal: false, frameEarned: 0, finalized: false };
var comboPiece = { width: 6, height: 1, isChain: false, isMetal: false, frameEarned: 0, finalized: true };
var pend = [{ at: 0, g: chainPiece, capped: false }, { at: 0, g: comboPiece, capped: false }];
var before = st.panels.length;
SH.land(st, pend, function (a) { return a.g.isChain && a.g.finalized === false; });
assert.strictEqual(pend.length, 1, 'the chain piece still on its way, the combo piece landed');
assert.strictEqual(pend[0].g, chainPiece);
var all = [{ at: 0, g: chainPiece, capped: false }];
SH.land(PA.puzzle('123456'), all);
assert.strictEqual(all.length, 0, 'with no hold, as before, it lands');
// the match's own test, on a profile that asks for it
var held = M.prototype.held;
function matchWith(heldChain) { return { L: { profile: { attack: { heldChain: heldChain } } }, held: held }; }
assert.strictEqual(matchWith(true).held({ g: chainPiece }), true, 'an unfinalized chain piece is held');
assert.strictEqual(matchWith(true).held({ g: Object.assign({}, chainPiece, { finalized: true }) }), false, 'a finalized one lands');
assert.strictEqual(matchWith(true).held({ g: comboPiece }), false, 'a combo piece lands');
assert.strictEqual(matchWith(false).held({ g: chainPiece }), false, 'a profile without heldChain lands everything, as before');
console.log('survivor_held: ok');

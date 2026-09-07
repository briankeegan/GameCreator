// Faithful port of LÖVE2D's love.math.RandomGenerator (xorshift64*, seeded
// via Thomas Wang's 64-bit hash) -- the real engine's actual color RNG,
// confirmed via its public source (love2d/love, src/modules/math/
// RandomGenerator.cpp + RandomGenerator.h + wrap_RandomGenerator.lua).
// This is what panel-engine.js's own mulberry32 substitute (its own
// comment: "so a duel replays identically from a seed -- Math.random
// would make the smoke test unreproducible") is NOT compatible with --
// see FINDINGS.md Round 6 for why that blocks real-match-replay
// reproduction, and Round 7 for this port closing that gap.
//
// Algorithm (all three pieces confirmed against LÖVE's actual source,
// not guessed):
//   1. setSeed(seed): state = wangHash64(seed), repeated if the result
//      is 0 (xorshift cannot run from a zero state).
//   2. rand(): the xorshift* step --
//        state ^= state >> 12; state ^= state << 25; state ^= state >> 27
//        return state * 2685821657736338717   (mod 2^64 throughout)
//   3. random() -> double in [0,1): take rand()'s top 52 bits
//      (rand() >> 12), OR into IEEE-754 exponent bits for [1,2), bit-cast
//      to double, subtract 1.
//   4. random(min,max) (wrap_RandomGenerator.lua's getrandom): floor(r *
//      (max - min + 1)) + min, r = random() from (3).
"use strict";

var MASK64 = (1n << 64n) - 1n;

function wangHash64(key) {
  key = ((~key) + (key << 21n)) & MASK64;
  key = (key ^ (key >> 24n)) & MASK64;
  key = ((key + (key << 3n)) + (key << 8n)) & MASK64;
  key = (key ^ (key >> 14n)) & MASK64;
  key = ((key + (key << 2n)) + (key << 4n)) & MASK64;
  key = (key ^ (key >> 28n)) & MASK64;
  key = (key + (key << 31n)) & MASK64;
  return key;
}

var XORSHIFT_MULT = 2685821657736338717n;

function RandomGenerator(seed) {
  this.setSeed(seed);
}

RandomGenerator.prototype.setSeed = function (seed) {
  var s = BigInt(Math.trunc(seed)) & MASK64;
  do {
    s = wangHash64(s);
  } while (s === 0n);
  this.state = s;
};

RandomGenerator.prototype.rand = function () {
  var s = this.state;
  s = (s ^ (s >> 12n)) & MASK64;
  s = (s ^ (s << 25n)) & MASK64;
  s = (s ^ (s >> 27n)) & MASK64;
  this.state = s;
  return (s * XORSHIFT_MULT) & MASK64;
};

var buf = new ArrayBuffer(8);
var dv = new DataView(buf);
var EXP_BITS = 0x3FFn << 52n;

// double in [0,1)
RandomGenerator.prototype.randomFloat = function () {
  var r = this.rand();
  var bits = EXP_BITS | (r >> 12n);
  dv.setBigUint64(0, bits, true);
  return dv.getFloat64(0, true) - 1.0;
};

// Matches wrap_RandomGenerator.lua's getrandom(r, l, u) exactly,
// including its floor-based rounding (not a round-to-nearest).
RandomGenerator.prototype.random = function (min, max) {
  var r = this.randomFloat();
  if (max !== undefined) {
    return Math.floor(r * (max - min + 1)) + min;
  } else if (min !== undefined) {
    return Math.floor(r * min) + 1;
  }
  return r;
};

module.exports = { RandomGenerator: RandomGenerator, wangHash64: wangHash64 };

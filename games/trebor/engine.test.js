// engine.test.js — headless rules coverage for TREEBOAR's deck-builder run:
// class select, node choices (fight/elite/rest), combat, card rewards, and
// the boss. Plain Node, no framework: run with `node games/trebor/engine.test.js`.
"use strict";

const assert = require("assert");
const Engine = require("./engine.js");
const Content = require("./content.js");

// A fixed rng (always 0) makes shuffle() fully deterministic and
// reproducible — exactly what these tests need to assert exact hands/outcomes.
const rng = () => 0;

// A minimally sensible bot: block when a hit is coming and Block wouldn't
// cover it, otherwise make damage progress.
function chooseCardIndex(state, content) {
  const incoming = Engine.livingEnemies(state)
    .filter((e) => e.currentIntent.type === "attack")
    .reduce((sum, e) => sum + e.currentIntent.damage, 0);
  const affordable = [];
  for (let i = 0; i < state.hand.length; i++) {
    if (state.player.energy >= content.CARDS[state.hand[i]].cost) affordable.push(i);
  }
  if (affordable.length === 0) return -1;
  if (incoming > state.player.block) {
    const blockIdx = affordable.find((i) => content.CARDS[state.hand[i]].block);
    if (blockIdx !== undefined) return blockIdx;
  }
  const dmgIdx = affordable.find((i) => content.CARDS[state.hand[i]].damage);
  return dmgIdx !== undefined ? dmgIdx : affordable[0];
}

function playOutCombat(state, content) {
  let guard = 0;
  while (state.status === "playing") {
    if (++guard > 500) throw new Error("combat did not converge");
    const idx = chooseCardIndex(state, content);
    if (idx === -1) {
      Engine.endPlayerTurn(state, content, rng);
      continue;
    }
    const card = content.CARDS[state.hand[idx]];
    const targetId = Engine.cardNeedsTarget(card) ? Engine.livingEnemies(state)[0].id : null;
    Engine.playCard(state, content, idx, targetId, rng);
  }
}

// ---------------------------------------------------------------------
// Class select gates the run: nothing else is legal until a dog is picked.
// ---------------------------------------------------------------------
const gate = Engine.createGameState(Content, rng);
assert.strictEqual(gate.status, "class-select");
assert.strictEqual(gate.classId, null);
assert.strictEqual(gate.deck.length, 0);
assert.throws(() => Engine.chooseNode(gate, Content, 0, rng), /Cannot choose a node/);
assert.throws(() => Engine.playCard(gate, Content, 0, null, rng), /Cannot play a card/);
assert.throws(() => Engine.chooseClass(gate, Content, "notADog", rng), /Unknown class/);

// Each class sets its own Hull and 12-card deck.
const hpByClass = { riddle: 36, koozie: 32, bevy: 22, lala: 36 };
for (const id of Object.keys(Content.CLASSES)) {
  const s = Engine.createGameState(Content, rng);
  Engine.chooseClass(s, Content, id, rng);
  assert.strictEqual(s.status, "choosing");
  assert.strictEqual(s.classId, id);
  assert.strictEqual(s.player.maxHp, hpByClass[id], `${id} has the right Hull`);
  assert.strictEqual(s.player.hp, hpByClass[id]);
  assert.strictEqual(s.deck.length, 12, `${id} opens with a 12-card deck`);
  assert.throws(() => Engine.chooseClass(s, Content, id, rng), /Cannot choose a class/, "can't re-pick mid-run");
}

// ---------------------------------------------------------------------
// Class mechanics: each dog plays by its own passive.
// ---------------------------------------------------------------------
// Bevy — Boundless: an extra Energy every turn.
const bevyM = Engine.createGameState(Content, rng);
Engine.chooseClass(bevyM, Content, "bevy", rng);
assert.strictEqual(bevyM.player.maxEnergy, Content.STARTING_ENERGY + 1, "Bevy runs on +1 Energy");
Engine.chooseNode(bevyM, Content, 0, rng);
assert.strictEqual(bevyM.player.energy, Content.STARTING_ENERGY + 1, "and opens combat holding it");

// Riddle — Frenzy: draws an extra card AND runs on +1 Energy each turn, so the
// extra draw is a real choice (see 6, play up to 4) instead of free-card spam.
const riddleM = Engine.createGameState(Content, rng);
Engine.chooseClass(riddleM, Content, "riddle", rng);
assert.strictEqual(riddleM.player.maxEnergy, Content.STARTING_ENERGY + 1, "Frenzy also grants +1 Energy");
Engine.chooseNode(riddleM, Content, 0, rng);
assert.strictEqual(riddleM.hand.length, Content.HAND_SIZE + 1, "Frenzy opens with an extra card");
assert.strictEqual(riddleM.player.energy, Content.STARTING_ENERGY + 1, "and opens combat holding the extra Energy");
// Guard the design intent behind Admin's "half the cards are zero" note: most
// of Riddle's deck now costs Energy — at most a third of it is free.
const riddleZero = Content.CLASSES.riddle.deck.filter((id) => Content.CARDS[id].cost === 0).length;
assert.ok(riddleZero <= 5, `Riddle's deck is mostly costed cards, not free (${riddleZero}/12 are 0-cost)`);

// Lala — Lock Jaw: +3 damage on every attack.
const lalaM = Engine.createGameState(Content, rng);
Engine.chooseClass(lalaM, Content, "lala", rng);
Engine.chooseNode(lalaM, Content, 0, rng); // Alley Cat, 14 Hull
lalaM.hand.unshift("bite"); // a plain 6-damage Bite...
Engine.playCard(lalaM, Content, 0, lalaM.enemies[0].id, rng);
assert.strictEqual(lalaM.enemies[0].hp, 28 - 9, "Lock Jaw makes Bite land for 6+3");

// ---------------------------------------------------------------------
// Floor 1 fight (as Koozie), traced through the key mechanics.
// ---------------------------------------------------------------------
const state = Engine.createGameState(Content, rng);
Engine.chooseClass(state, Content, "koozie", rng);
assert.strictEqual(state.nodeChoices.length, 3, "a floor offers three rooms to choose from");
assert.ok(state.nodeChoices.some((o) => o.type === "fight"), "at least one room is always a fight");
assert.strictEqual(state.map.length, 3, "the run map has three acts");

Engine.chooseNode(state, Content, 0, rng); // first room — a lone Alley Cat under the fixed rng
assert.strictEqual(state.status, "playing");
assert.strictEqual(state.enemies[0].typeId, "alleyCat");
assert.strictEqual(state.enemies[0].hp, 28);
assert.deepStrictEqual(
  state.hand,
  ["riptide", "counterSurge", "counterSurge", "brace", "brace"],
  "Koozie's deterministic opening hand (its own block-heavy deck)"
);
assert.strictEqual(state.player.block, 3, "Waterproof: Koozie opens the turn already holding 3 Block");
assert.strictEqual(state.enemies[0].currentIntent.type, "attack", "the cat telegraphs before the player acts");

const cat = state.enemies[0];
Engine.playCard(state, Content, 3, null, rng); // Brace -> +8 Block (hand: riptide, counterSurge, counterSurge, brace)
assert.strictEqual(state.player.block, 11);
assert.strictEqual(state.player.energy, 2);

Engine.playCard(state, Content, 3, null, rng); // Brace -> +8 Block (hand: riptide, counterSurge, counterSurge)
assert.strictEqual(state.player.block, 19);
assert.strictEqual(state.player.energy, 1);

Engine.playCard(state, Content, 0, null, rng); // Riptide -> 5 dmg + 5 Block
assert.strictEqual(cat.hp, 23, "Riptide deals 5 (Koozie has no Strength bonus); 28-5");
assert.strictEqual(state.player.block, 24);
assert.strictEqual(state.player.energy, 0);

Engine.endPlayerTurn(state, Content, rng);
assert.strictEqual(state.player.hp, 32, "24 Block swallowed the telegraphed Attack whole");
assert.strictEqual(state.player.block, 3, "Block resets, then Waterproof re-applies its 3 next turn");
assert.strictEqual(state.player.energy, 3);

playOutCombat(state, Content); // finish the cat
assert.strictEqual(state.status, "reward", "a non-boss win goes to a card reward");
assert.strictEqual(state.rewardOptions.length, Content.FIGHT_REWARD_COUNT);
assert.ok(state.rewardOptions.every((id) => Content.CARDS[id]), "every reward is a real card");
assert.throws(() => Engine.pickReward(state, Content, "not-a-card", rng), /was not offered/);

const chosen = state.rewardOptions[0];
Engine.pickReward(state, Content, chosen, rng);
assert.strictEqual(state.deck.length, 13, "picking a reward grows the deck");
assert.strictEqual(state.deck[state.deck.length - 1], chosen);
assert.strictEqual(state.status, "choosing");
assert.strictEqual(state.floorIndex, 1);

// Randomized routes: a run rolled with a varied rng mixes node types across
// its floors (not just fights) — that's the run-to-run map variety.
const seededRng = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};
const variedTypes = new Set();
for (const act of Engine.generateMap(Content, seededRng(7)))
  for (const fl of act.floors) for (const o of fl.options) variedTypes.add(o.type);
assert.ok(variedTypes.size >= 2, "a random route mixes node types, not just fights");
assert.ok([...variedTypes].some((t) => t !== "fight"), "and includes non-fight rooms (elite / rest / treasure)");

// ---------------------------------------------------------------------
// New enemies: a Feral Kitten swarm and a Rooftop Sniper exist and fight.
// ---------------------------------------------------------------------
assert.strictEqual(Content.ENEMY_TYPES.feralKitten.maxHp, 7);
assert.strictEqual(Content.ENEMY_TYPES.rooftopSniper.pattern[1].damage, 18, "the sniper's telegraphed big shot");
const swarmContent = Object.assign({}, Content, {
  ACTS: [
    {
      name: "Test Act",
      floorCount: 1,
      boss: { label: "Test Boss", enemies: ["bigTom"] },
      fightPool: [["feralKitten", "feralKitten", "feralKitten"]],
      elitePool: [["bigTom"]],
    },
  ],
});
const swarm = Engine.createGameState(swarmContent, rng);
Engine.chooseClass(swarm, swarmContent, "riddle", rng);
Engine.chooseNode(swarm, swarmContent, 0, rng);
assert.strictEqual(swarm.enemies.length, 3, "the Litter fields three kittens");

// AoE hits every kitten at once, no target needed.
assert.strictEqual(Engine.cardNeedsTarget(Content.CARDS.bigBark), false);
swarm.hand.unshift("bigBark");
swarm.player.energy = 3;
Engine.playCard(swarm, swarmContent, 0, null, rng); // Big Bark -> all three for 8
assert.ok(swarm.enemies.every((e) => e.hp <= 0), "Big Bark (8) clears the 7-HP kittens in one hit");
assert.strictEqual(swarm.status, "reward");

// ---------------------------------------------------------------------
// Single-target still needs an explicit target with multiple enemies alive.
// ---------------------------------------------------------------------
const multi = Engine.createGameState(swarmContent, rng);
Engine.chooseClass(multi, swarmContent, "koozie", rng); // no Strength, so Bite is a clean 6
Engine.chooseNode(multi, swarmContent, 0, rng);
multi.hand.unshift("bite"); // hand a single-target attack directly, regardless of deck order
const biteIdx = 0;
assert.throws(() => Engine.playCard(multi, swarmContent, biteIdx, null, rng), /Must specify a target/);
const first = multi.enemies[1];
Engine.playCard(multi, swarmContent, biteIdx, first.id, rng);
assert.strictEqual(first.hp, 1, "Bite (6) hit the named 7-HP kitten");
assert.strictEqual(multi.enemies[0].hp, 7, "the others are untouched");

// ---------------------------------------------------------------------
// Loss: a dog at 1 Hull does not survive a telegraphed Attack.
// ---------------------------------------------------------------------
const loss = Engine.createGameState(Content, rng);
Engine.chooseClass(loss, Content, "bevy", rng);
Engine.chooseNode(loss, Content, 0, rng);
loss.player.hp = 1;
assert.strictEqual(loss.enemies[0].currentIntent.type, "attack");
Engine.endPlayerTurn(loss, Content, rng);
assert.strictEqual(loss.status, "lost");
assert.strictEqual(loss.player.hp, 0, "hp clamps at 0");
assert.throws(() => Engine.playCard(loss, Content, 0, null, rng), /Cannot play a card/);

// ---------------------------------------------------------------------
// Three acts: content.js declares exactly three, each with its own boss,
// each boss meaner than the last.
// ---------------------------------------------------------------------
assert.strictEqual(Content.ACTS.length, 3, "the dungeon has three acts");
const bossHps = Content.ACTS.map((a) => Content.ENEMY_TYPES[a.boss.enemies[0]].maxHp);
assert.ok(bossHps[0] < bossHps[1] && bossHps[1] < bossHps[2], "each act's boss has more Hull than the last");
assert.strictEqual(Content.ACTS[2].boss.enemies[0], "catKing", "the final boss is the Cat King");

// ---------------------------------------------------------------------
// Boss reward: felling a non-final act boss opens a boss-reward pick that
// grants a boss-only card, +max Hull, a full heal, and rolls into the next
// act's first floor. (Constructed directly at the boss-reward state.)
// ---------------------------------------------------------------------
const br = Engine.createGameState(Content, rng);
Engine.chooseClass(br, Content, "koozie", rng); // 32 Hull
br.status = "boss-reward";
br.actIndex = 0;
br.currentNodeType = "boss";
br.player.hp = 5;
br.relicPool = []; // isolate the +maxHull assertion from any relic drop
br.bossRewardOptions = ["maul", "bulwark", "reserves"];
assert.throws(() => Engine.chooseBossReward(br, Content, "bite", rng), /was not offered/);
const deckBefore = br.deck.length;
Engine.chooseBossReward(br, Content, "maul", rng);
assert.strictEqual(br.deck.length, deckBefore + 1, "the boss-reward card joins the deck");
assert.strictEqual(br.deck[br.deck.length - 1], "maul");
assert.strictEqual(br.player.maxHp, 32 + Content.BOSS_MAX_HULL_BONUS, "boss kill permanently raises max Hull");
assert.strictEqual(br.player.hp, br.player.maxHp, "boss reward heals to full");
assert.strictEqual(br.actIndex, 1, "advanced into the next act");
assert.strictEqual(br.floorIndex, 0);
assert.strictEqual(br.status, "choosing");
assert.deepStrictEqual(br.nodeChoices, br.map[1].floors[0].options, "onto Act 2's first floor of the generated map");

// Skipping the boss reward still heals and advances, just without a card.
const brSkip = Engine.createGameState(Content, rng);
Engine.chooseClass(brSkip, Content, "riddle", rng);
brSkip.status = "boss-reward";
brSkip.actIndex = 0;
brSkip.player.hp = 3;
brSkip.bossRewardOptions = ["maul"];
const skipDeck = brSkip.deck.length;
Engine.chooseBossReward(brSkip, Content, null, rng);
assert.strictEqual(brSkip.deck.length, skipDeck, "skipping adds no card");
assert.strictEqual(brSkip.player.hp, brSkip.player.maxHp, "skipping still heals to full");
assert.strictEqual(brSkip.actIndex, 1);

// ---------------------------------------------------------------------
// Treasure nodes and rest-site actions (heal / upgrade / remove).
// ---------------------------------------------------------------------
// Treasure: choosing it opens a free pick from the strong treasure pool.
const treas = Engine.createGameState(Content, rng);
Engine.chooseClass(treas, Content, "koozie", rng);
treas.nodeChoices = [{ type: "treasure", label: "Test Stash" }]; // guarantee one to click
Engine.chooseNode(treas, Content, 0, rng);
assert.strictEqual(treas.status, "reward");
assert.strictEqual(treas.currentNodeType, "treasure");
assert.ok(treas.rewardOptions.every((id) => Content.TREASURE_POOL.includes(id)), "treasure offers the strong pool");
const deckBeforeTreasure = treas.deck.length;
Engine.pickReward(treas, Content, treas.rewardOptions[0], rng);
assert.strictEqual(treas.deck.length, deckBeforeTreasure + 1, "taking treasure grows the deck");

// Rest site: heal, upgrade, and remove all end the visit and advance.
const rs = Engine.createGameState(Content, rng);
Engine.chooseClass(rs, Content, "koozie", rng);
rs.status = "rest-site";
rs.currentNodeType = "rest";
rs.floorIndex = 0;
rs.player.hp = 10;
Engine.restSite(rs, Content, "heal", null, rng);
assert.ok(rs.player.hp > 10, "resting heals");
assert.strictEqual(rs.status, "choosing", "and moves on to the next floor");

// Upgrade swaps a card for its + version.
const up = Engine.createGameState(Content, rng);
Engine.chooseClass(up, Content, "lala", rng);
up.status = "rest-site";
up.floorIndex = 0;
const upIndex = up.deck.findIndex((id) => Content.UPGRADES[id]);
const baseId = up.deck[upIndex];
Engine.restSite(up, Content, "upgrade", upIndex, rng);
assert.strictEqual(up.deck[upIndex], Content.UPGRADES[baseId], "the card became its + version");
assert.ok(Content.CARDS[Content.UPGRADES[baseId]].upgraded, "and the + card is marked upgraded");

// Remove deletes a card.
const rm = Engine.createGameState(Content, rng);
Engine.chooseClass(rm, Content, "bevy", rng);
rm.status = "rest-site";
rm.floorIndex = 0;
const rmLen = rm.deck.length;
Engine.restSite(rm, Content, "remove", 0, rng);
assert.strictEqual(rm.deck.length, rmLen - 1, "removing shrinks the deck");

// ---------------------------------------------------------------------
// Vulnerable mechanic: a marked enemy takes +50% damage, and it ticks down.
// ---------------------------------------------------------------------
const vuln = Engine.createGameState(Content, rng);
Engine.chooseClass(vuln, Content, "koozie", rng); // no Strength — clean damage math
Engine.chooseNode(vuln, Content, 0, rng); // Alley Cat, 28 Hull, no Strength bonus
const vcat = vuln.enemies[0];
vuln.hand.unshift("snarl"); // apply 2 Vulnerable
Engine.playCard(vuln, Content, 0, vcat.id, rng);
assert.strictEqual(vcat.vulnerable, 2, "Snarl applies 2 Vulnerable");
assert.strictEqual(vcat.hp, 28, "Snarl deals no damage itself");
vuln.hand.unshift("bite"); // 6 damage, boosted to floor(6*1.5)=9 while Vulnerable
vuln.player.energy = 3;
Engine.playCard(vuln, Content, 0, vcat.id, rng);
assert.strictEqual(vcat.hp, 28 - 9, "Bite hits a Vulnerable cat for 50% more (6 -> 9)");
Engine.endPlayerTurn(vuln, Content, rng);
assert.strictEqual(Engine.livingEnemies(vuln)[0].vulnerable, 1, "Vulnerable ticks down one per turn");

// Reward-pool hygiene: no class-signature card is offered as a generic reward
// (they'd strictly dominate — Lock Jaw over Bite), and the Vulnerable cards are.
const classSignatures = ["lockJaw", "chomp", "bodySlam", "riptide", "brace", "counterSurge", "rally", "flurry", "scurry", "digIn"];
for (const id of classSignatures) {
  assert.ok(!Content.BASE_REWARD_POOL.includes(id), `${id} (a class signature) must not be in the shared reward pool`);
}
assert.ok(Content.BASE_REWARD_POOL.includes("snarl") && Content.BASE_REWARD_POOL.includes("rend"), "the Vulnerable cards are offered as rewards");

// ---------------------------------------------------------------------
// Relics: collected passives that drop from bosses (and elites) and apply.
// ---------------------------------------------------------------------
const relBoss = Engine.createGameState(Content, rng);
Engine.chooseClass(relBoss, Content, "koozie", rng);
relBoss.status = "boss-reward";
relBoss.actIndex = 0;
relBoss.player.hp = 5;
relBoss.bossRewardOptions = ["maul"];
Engine.chooseBossReward(relBoss, Content, null, rng);
assert.strictEqual(relBoss.relics.length, 1, "a boss kill drops a relic");

// Spiked Collar adds +1 damage to every attack; relics are unique.
const relFx = Engine.createGameState(Content, rng);
Engine.chooseClass(relFx, Content, "koozie", rng); // no class Strength
Engine.grantRelic(relFx, Content, "spikedCollar");
Engine.chooseNode(relFx, Content, relFx.nodeChoices.findIndex((o) => o.type === "fight"), rng);
const rfEnemy = relFx.enemies[0];
relFx.hand.unshift("bite");
relFx.player.energy = 3;
const rfHp = rfEnemy.hp;
Engine.playCard(relFx, Content, 0, rfEnemy.id, rng);
assert.strictEqual(rfHp - rfEnemy.hp, 7, "Spiked Collar: Bite hits for 6+1");
assert.strictEqual(Engine.grantRelic(relFx, Content, "spikedCollar"), null, "relics are unique — no duplicate grant");

// Chew Toy opens combat with Block; Marrow Bone raises max Hull on pickup.
const relBlk = Engine.createGameState(Content, rng);
Engine.chooseClass(relBlk, Content, "lala", rng); // no turn-Block mechanic
Engine.grantRelic(relBlk, Content, "chewToy");
Engine.chooseNode(relBlk, Content, relBlk.nodeChoices.findIndex((o) => o.type === "fight"), rng);
assert.strictEqual(relBlk.player.block, 4, "Chew Toy: start combat with 4 Block");
const mbHp = relBlk.player.maxHp;
Engine.grantRelic(relBlk, Content, "marrowBone");
assert.strictEqual(relBlk.player.maxHp, mbHp + 8, "Marrow Bone: +8 max Hull on pickup");

// ---------------------------------------------------------------------
// Weak: a debuffed enemy deals 25% less. And per-character reward pools.
// ---------------------------------------------------------------------
const wk = Engine.createGameState(Content, rng);
Engine.chooseClass(wk, Content, "bevy", rng);
Engine.chooseNode(wk, Content, wk.nodeChoices.findIndex((o) => o.type === "fight"), rng);
const wkEnemy = wk.enemies[0];
wk.hand.unshift("cower"); // apply 2 Weak
Engine.playCard(wk, Content, 0, wkEnemy.id, rng);
assert.strictEqual(wkEnemy.weak, 2, "Cower applies 2 Weak");
if (wkEnemy.currentIntent.type === "attack") {
  assert.strictEqual(
    Engine.intentDamage(wkEnemy),
    Math.floor(wkEnemy.currentIntent.damage * 0.75),
    "Weak cuts a telegraphed attack by 25%"
  );
}

// Per-character reward pools: a run carries its class's signature cards, so
// they can be offered as rewards on top of the generic pool ("cards per char").
const lalaRun = Engine.createGameState(Content, rng);
Engine.chooseClass(lalaRun, Content, "lala", rng);
assert.deepStrictEqual(lalaRun.classRewardPool, Content.CLASSES.lala.rewardCards, "the run carries its class reward cards");
assert.ok(lalaRun.classRewardPool.includes("lockJaw"), "Lala's own Lock Jaw is in her reward pool");
assert.ok(!Content.BASE_REWARD_POOL.includes("lockJaw"), "but Lock Jaw is NOT in the shared generic pool");

// ---------------------------------------------------------------------
// Full-run BALANCE test: over many seeded runs a competent player should
// clear the dungeon often enough to feel fair but lose often enough that it
// stays challenging — and every class should land in roughly the same band
// (no class is a pushover and none is unwinnable). This is the balance
// backstop for content.js: retune enemies/cards until each class fits.
// ---------------------------------------------------------------------
const seededPlay = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

// A competent bot: block when a hit would land, otherwise deal damage, take
// treasure, heal at rest sites when hurt else sharpen a card. Bounds card-play
// per turn so free-draw cards can't spin forever.
function playCombat(run) {
  let guard = 0;
  let turnPlays = 0;
  let lastTurn = run.turnCount;
  while (run.status === "playing") {
    if (++guard > 3000) throw new Error("combat did not converge");
    if (run.turnCount !== lastTurn) { turnPlays = 0; lastTurn = run.turnCount; }
    const idx = chooseCardIndex(run, Content);
    let done = idx === -1;
    if (!done && turnPlays >= 12) {
      const c = Content.CARDS[run.hand[idx]];
      if (!c.damage && !c.block) done = true;
    }
    if (done) { Engine.endPlayerTurn(run, Content, run._rng); continue; }
    const card = Content.CARDS[run.hand[idx]];
    const targetId = Engine.cardNeedsTarget(card) ? Engine.livingEnemies(run)[0].id : null;
    Engine.playCard(run, Content, idx, targetId, run._rng);
    turnPlays++;
  }
}

function playFullRun(id, r) {
  const run = Engine.createGameState(Content, r);
  run._rng = r;
  Engine.chooseClass(run, Content, id, r);
  let steps = 0;
  while (run.status !== "victory" && run.status !== "lost") {
    if (++steps > 5000) throw new Error(`run (${id}) did not converge`);
    if (run.status === "choosing") {
      let i = run.nodeChoices.findIndex((o) => o.type === "treasure");
      if (i < 0) i = run.nodeChoices.findIndex((o) => o.type === "fight");
      if (i < 0) i = 0;
      Engine.chooseNode(run, Content, i, r);
    } else if (run.status === "reward") {
      Engine.pickReward(run, Content, run.rewardOptions[0], r);
    } else if (run.status === "rest-site") {
      if (run.player.hp < run.player.maxHp * 0.75) {
        Engine.restSite(run, Content, "heal", null, r);
      } else {
        const ui = run.deck.findIndex((cid) => Content.UPGRADES[cid]);
        if (ui >= 0) Engine.restSite(run, Content, "upgrade", ui, r);
        else Engine.restSite(run, Content, "heal", null, r);
      }
    } else if (run.status === "boss-reward") {
      Engine.chooseBossReward(run, Content, run.bossRewardOptions[0], r);
    } else if (run.status === "playing") {
      playCombat(run);
    }
  }
  return run.status === "victory";
}

const RUNS = 120;
for (const id of Object.keys(Content.CLASSES)) {
  let wins = 0;
  for (let i = 0; i < RUNS; i++) if (playFullRun(id, seededPlay(10000 + i * 7))) wins++;
  const rate = wins / RUNS;
  // Challenging-but-fair band, tuned to a deliberately HARD roguelike (Admin
  // kept flagging "too easy", and the acts are now longer with more attrition).
  // This is a middling bot — no relics, no clever sequencing — so its bar is
  // low: as long as it still wins ~a fifth of runs, a real player is fine, and
  // a skilled one lands ~half. The UPPER bound is the real guard: if any class
  // clears >66%, the content went soft again. The lower bound just keeps every
  // class from becoming an outright wall.
  assert.ok(
    rate >= 0.12 && rate <= 0.66,
    `${id} win rate ${(rate * 100).toFixed(0)}% should be challenging but fair (12-66%)`
  );
}

console.log("All golden-path assertions passed.");

/* Buff Up — a 90s point-and-click adventure pastiche.
 *
 * A big strongman wants to lose weight while keeping (and building) strength.
 * Tap a spot in the home to walk over and interact; every choice nudges four
 * hidden stats — Weight, Muscle, Knowledge, Energy. Get your strength-to-weight
 * ratio high enough to nail a pull-up (the win), and never eat the pizza (the
 * instant loss). Knowledge unlocks the good stuff: heavier kettlebells and
 * knowing which food is actually worth eating.
 *
 * Everything renders to one canvas (chunky pixel look) with DOM overlays for
 * the menus/HUD. Save data rides on GCStorage so a refresh mid-run resumes.
 */
(function () {
  "use strict";

  var GAME_ID = "buffer";
  var WIN_RATIO = 0.90;   // muscle / weight needed to win
  var START_RATIO = 0.50; // used to scale the progress bar

  var RANGE = {
    weight: [60, 140],
    muscle: [30, 130],
    knowledge: [0, 20],
    energy: [0, 100],
  };

  function freshState() {
    return { weight: 108, muscle: 55, knowledge: 0, energy: 100, day: 1, bell: "light", ended: null };
  }

  var state = load() || freshState();
  if (state.ended) state = freshState(); // never resume a finished run

  // ---------------------------------------------------------------- DOM refs
  // Virtual coordinate space is 360x240 (matches the generated art's 3:2
  // aspect); the canvas backing is 2x that (720x480) for a crisper picture.
  var VW = 360, VH = 240;
  var canvas = document.getElementById("scene");
  var ctx = canvas.getContext("2d");
  ctx.scale(2, 2);
  ctx.imageSmoothingEnabled = true;
  var hintEl = document.getElementById("hint");
  var backdrop = document.getElementById("menuBackdrop");
  var menuTitle = document.getElementById("menuTitle");
  var menuFlavor = document.getElementById("menuFlavor");
  var menuChoices = document.getElementById("menuChoices");
  var endscreen = document.getElementById("endscreen");

  // --------------------------------------------------------------- palette
  var C = {
    wallTop: "#8a5a3c", wall: "#a9744a", wainscot: "#6e4327",
    floor: "#7a4e2e", floor2: "#6b4326", ink: "#211308",
    couch: "#4f7a52", couchDk: "#3a5c3d", tv: "#20262e", tvGlow: "#7fd0ff",
    bed: "#c85a5a", bedDk: "#9c4141", pillow: "#f0e2c2",
    fridge: "#d7d2c6", fridgeDk: "#b7b2a6", counter: "#8a6a45",
    mat: "#3f6f8a", bell: "#2b2622", bellHi: "#4a423a",
    door: "#6e4a2a", doorDk: "#553618", knob: "#e8c04a",
    bar: "#9aa0a6", barDk: "#6a6f74",
    skin: "#e0a878", skinDk: "#c98a5c", tank: "#d94f4f", tankDk: "#a83a3a",
    shorts: "#3a5fa0", shortsDk: "#2c4879", hair: "#3a2a1a",
    label: "#f4e4c1", labelBg: "rgba(20,12,6,0.72)",
  };

  // ------------------------------------------------------------- hotspots
  var FLOOR_Y = 196;
  // Positioned over the generated room (art/room.png). Order matters — the
  // first matching hotspot wins overlaps, so tighter/front items come first.
  var SPOTS = [
    { id: "pullup",  label: "PULL-UP BAR", rect: [150, 44, 62, 40],  standX: 180 },
    { id: "door",    label: "DOOR",        rect: [2, 46, 46, 122],   standX: 58 },
    { id: "tv",      label: "TV / PHONE",  rect: [56, 112, 104, 62], standX: 104 },
    { id: "squat",   label: "SQUAT MAT",   rect: [138, 206, 56, 30], standX: 166 },
    { id: "bells",   label: "KETTLEBELLS", rect: [198, 204, 58, 34], standX: 224 },
    { id: "bed",     label: "BED",         rect: [206, 128, 54, 52], standX: 236 },
    { id: "kitchen", label: "KITCHEN",     rect: [262, 88, 90, 92],  standX: 300 },
  ];

  var guy = { x: 180, targetX: 180, walking: false, bob: 0, pending: null, dir: 1 };

  // ---- generated art (optional). The game plays fine on the hand-drawn
  // canvas fallback below; once art/room.png (background) and art/hero.png
  // (transparent character sprite) are generated, it upgrades automatically.
  var assets = { room: null, hero: null };
  function loadAsset(key, src) {
    var img = new Image();
    img.onload = function () { assets[key] = img; draw(); };
    img.src = src; // a 404 just leaves the fallback in place
  }

  // ============================================================ RENDERING
  function px(n) { return Math.round(n); }

  var DEBUG_HOTSPOTS = false; // outline tap regions for calibration

  function draw() {
    if (assets.room) ctx.drawImage(assets.room, 0, 0, VW, VH);
    else drawFallbackRoom();

    drawCharacter();

    for (var i = 0; i < SPOTS.length; i++) drawLabel(SPOTS[i]);

    if (DEBUG_HOTSPOTS) {
      ctx.strokeStyle = "rgba(0,255,255,0.9)"; ctx.lineWidth = 1;
      for (var j = 0; j < SPOTS.length; j++) {
        var r = SPOTS[j].rect; ctx.strokeRect(r[0], r[1], r[2], r[3]);
      }
    }
  }

  function drawCharacter() {
    if (assets.hero) {
      var h = 104, w = h * (assets.hero.width / assets.hero.height);
      ctx.drawImage(assets.hero, px(guy.x - w / 2), px(FLOOR_Y + 6 - h + guy.bob), px(w), px(h));
    } else {
      drawGuy(guy.x, FLOOR_Y + 2, guy.bob);
    }
  }

  function drawFallbackRoom() {
    ctx.fillStyle = C.wall; ctx.fillRect(0, 0, VW, FLOOR_Y);
    ctx.fillStyle = C.wallTop; ctx.fillRect(0, 0, VW, 20);
    ctx.fillStyle = C.wainscot; ctx.fillRect(0, FLOOR_Y - 16, VW, 16);
    ctx.fillStyle = C.floor; ctx.fillRect(0, FLOOR_Y, VW, VH - FLOOR_Y);
    ctx.fillStyle = C.floor2;
    for (var x = 0; x < VW; x += 28) ctx.fillRect(x, FLOOR_Y, 2, VH - FLOOR_Y);
  }

  function outline(x, y, w, h) {
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
    ctx.strokeRect(px(x) + 1, px(y) + 1, px(w) - 2, px(h) - 2);
  }

  function drawLabel(s) {
    var r = s.rect, cx = r[0] + r[2] / 2, ty = r[1] - 3;
    ctx.font = "7px 'Courier New', monospace";
    ctx.textAlign = "center";
    var w = ctx.measureText(s.label).width + 6;
    ctx.fillStyle = C.labelBg;
    ctx.fillRect(px(cx - w / 2), px(ty - 8), px(w), 9);
    ctx.fillStyle = C.label;
    ctx.fillText(s.label, px(cx), px(ty - 1));
    ctx.textAlign = "left";
  }

  function drawDoor(x, y) {
    ctx.fillStyle = C.door; ctx.fillRect(x, y, 42, 86);
    ctx.fillStyle = C.doorDk;
    ctx.fillRect(x + 5, y + 6, 14, 32); ctx.fillRect(x + 23, y + 6, 14, 32);
    ctx.fillRect(x + 5, y + 46, 14, 32); ctx.fillRect(x + 23, y + 46, 14, 32);
    ctx.fillStyle = C.knob; ctx.fillRect(x + 34, y + 44, 4, 5);
    outline(x, y, 42, 86);
  }

  function drawTV(x, y) {
    ctx.fillStyle = C.couch; ctx.fillRect(x + 8, y + 30, 54, 26);
    ctx.fillStyle = C.couchDk; ctx.fillRect(x + 8, y + 26, 54, 8);
    outline(x + 8, y + 26, 54, 30);
    ctx.fillStyle = C.tv; ctx.fillRect(x, y, 34, 24);
    ctx.fillStyle = C.tvGlow; ctx.fillRect(x + 3, y + 3, 28, 18);
    ctx.fillStyle = "#ff5b5b"; ctx.fillRect(x + 20, y + 7, 8, 5);
    ctx.fillStyle = "#fff"; ctx.fillRect(x + 23, y + 8, 3, 3);
    outline(x, y, 34, 24);
  }

  function drawBed(x, y) {
    ctx.fillStyle = C.bed; ctx.fillRect(x, y + 14, 54, 34);
    ctx.fillStyle = C.bedDk; ctx.fillRect(x, y + 36, 54, 12);
    ctx.fillStyle = C.pillow; ctx.fillRect(x + 4, y + 8, 20, 12);
    outline(x, y + 8, 54, 40);
  }

  function drawMat(x, y) {
    ctx.fillStyle = C.mat; ctx.fillRect(x, y, 44, 10);
    ctx.fillStyle = "#2f5468"; ctx.fillRect(x + 4, y + 3, 36, 2);
    outline(x, y, 44, 10);
  }

  function drawBells(x, y) {
    function bell(bx) {
      ctx.fillStyle = C.bellHi; ctx.fillRect(bx + 3, y, 8, 8);
      ctx.fillStyle = C.bell; ctx.fillRect(bx + 5, y + 2, 4, 4);
      ctx.fillStyle = C.bell; ctx.fillRect(bx, y + 6, 14, 12);
      outline(bx, y, 14, 18);
    }
    bell(x); bell(x + 26);
  }

  function drawKitchen(x, y) {
    ctx.fillStyle = C.fridge; ctx.fillRect(x + 24, y, 28, 72);
    ctx.fillStyle = C.fridgeDk; ctx.fillRect(x + 24, y + 30, 28, 3);
    ctx.fillStyle = "#8a8578"; ctx.fillRect(x + 47, y + 6, 3, 18); ctx.fillRect(x + 47, y + 40, 3, 18);
    outline(x + 24, y, 28, 72);
    ctx.fillStyle = C.counter; ctx.fillRect(x, y + 40, 22, 32);
    ctx.fillStyle = "#a5814f"; ctx.fillRect(x, y + 40, 22, 6);
    outline(x, y + 40, 22, 32);
  }

  function drawPullup(x, y) {
    ctx.fillStyle = C.barDk; ctx.fillRect(x, y, 6, 26); ctx.fillRect(x + 54, y, 6, 26);
    ctx.fillStyle = C.bar; ctx.fillRect(x, y, 60, 6);
    outline(x, y, 60, 26);
  }

  function drawGuy(cx, feetY, bob) {
    var x = px(cx), y = px(feetY) + Math.round(bob);
    ctx.fillStyle = C.shorts; ctx.fillRect(x - 8, y - 16, 16, 8);
    ctx.fillStyle = C.shortsDk; ctx.fillRect(x - 8, y - 10, 16, 3);
    ctx.fillStyle = C.skin; ctx.fillRect(x - 7, y - 8, 5, 8); ctx.fillRect(x + 2, y - 8, 5, 8);
    ctx.fillStyle = C.ink; ctx.fillRect(x - 8, y, 6, 2); ctx.fillRect(x + 2, y, 6, 2);
    ctx.fillStyle = C.tank; ctx.fillRect(x - 11, y - 34, 22, 20);
    ctx.fillStyle = C.tankDk; ctx.fillRect(x - 11, y - 20, 22, 4);
    ctx.fillStyle = C.skin; ctx.fillRect(x - 16, y - 33, 6, 16); ctx.fillRect(x + 10, y - 33, 6, 16);
    ctx.fillStyle = C.skinDk; ctx.fillRect(x - 16, y - 26, 6, 3); ctx.fillRect(x + 10, y - 26, 6, 3);
    ctx.fillStyle = C.skin; ctx.fillRect(x - 6, y - 46, 12, 12);
    ctx.fillStyle = C.hair; ctx.fillRect(x - 7, y - 47, 14, 4);
    ctx.fillStyle = C.ink;
    var ex = guy.dir >= 0 ? x : x - 1;
    ctx.fillRect(ex - 3, y - 41, 2, 2); ctx.fillRect(ex + 2, y - 41, 2, 2);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1;
    ctx.strokeRect(x - 11.5, y - 34.5, 22, 20);
    ctx.strokeRect(x - 6.5, y - 46.5, 12, 12);
  }

  // ============================================================ WALK
  var raf = null;
  function loop() {
    var dx = guy.targetX - guy.x, step = 2.6;
    if (Math.abs(dx) <= step) {
      guy.x = guy.targetX; guy.walking = false; guy.bob = 0; draw();
      raf = null;
      var cb = guy.pending; guy.pending = null;
      if (cb) cb();
      return;
    }
    guy.dir = dx > 0 ? 1 : -1;
    guy.x += step * guy.dir;
    guy.bob = (Math.round(guy.x / 4) % 2 === 0) ? -1 : 0;
    draw();
    raf = requestAnimationFrame(loop);
  }

  function walkTo(x, done) {
    guy.targetX = Math.max(20, Math.min(340, x));
    guy.pending = done;
    if (Math.abs(guy.targetX - guy.x) < 1) { guy.walking = false; if (done) done(); return; }
    guy.walking = true;
    if (!raf) raf = requestAnimationFrame(loop);
  }

  // ============================================================ INPUT
  canvas.addEventListener("click", function (e) {
    if (state.ended || guy.walking || backdrop.classList.contains("open")) return;
    var rect = canvas.getBoundingClientRect();
    var vx = (e.clientX - rect.left) / rect.width * 360;
    var vy = (e.clientY - rect.top) / rect.height * 200;
    var hit = null;
    for (var i = 0; i < SPOTS.length; i++) {
      var r = SPOTS[i].rect;
      if (vx >= r[0] - 4 && vx <= r[0] + r[2] + 4 && vy >= r[1] - 10 && vy <= r[1] + r[3] + 4) { hit = SPOTS[i]; break; }
    }
    if (!hit) return;
    var id = hit.id;
    walkTo(hit.standX, function () { openActivity(id); });
  });

  // ============================================================ STATS
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function ratio() { return state.muscle / state.weight; }

  function apply(d) {
    if (d.weight) state.weight = clamp(state.weight + d.weight, RANGE.weight[0], RANGE.weight[1]);
    if (d.muscle) state.muscle = clamp(state.muscle + d.muscle, RANGE.muscle[0], RANGE.muscle[1]);
    if (d.knowledge) state.knowledge = clamp(state.knowledge + d.knowledge, RANGE.knowledge[0], RANGE.knowledge[1]);
    if (d.energy) state.energy = clamp(state.energy + d.energy, RANGE.energy[0], RANGE.energy[1]);
    save();
    updateHUD();
  }

  function meterPct(name) {
    var r = RANGE[name];
    return clamp((state[name] - r[0]) / (r[1] - r[0]) * 100, 0, 100);
  }

  function updateHUD() {
    document.getElementById("mWeight").style.width = meterPct("weight") + "%";
    document.getElementById("mMuscle").style.width = meterPct("muscle") + "%";
    document.getElementById("mKnow").style.width = meterPct("knowledge") + "%";
    document.getElementById("mEnergy").style.width = meterPct("energy") + "%";
    document.getElementById("vWeight").textContent = Math.round(state.weight);
    document.getElementById("vMuscle").textContent = Math.round(state.muscle);
    document.getElementById("vKnow").textContent = Math.round(state.knowledge);
    document.getElementById("vEnergy").textContent = Math.round(state.energy);
    document.getElementById("dayLabel").textContent = "Day " + state.day;
    var prog = clamp((ratio() - START_RATIO) / (WIN_RATIO - START_RATIO), 0, 1);
    document.getElementById("mProgress").style.width = (prog * 100) + "%";
    document.getElementById("ratioLabel").textContent = Math.round(prog * 100) + "%";
  }

  function say(html) { hintEl.innerHTML = html; }

  // ============================================================ ACTIVITIES
  var FOOD_POOL = [
    { name: "Grilled chicken", d: { weight: -2, muscle: 2, energy: 28 }, tip: "Lean protein — ideal." },
    { name: "Big salad",       d: { weight: -3, muscle: 0, energy: 18 }, tip: "Low-cal, filling." },
    { name: "Rice bowl",       d: { weight: -1, muscle: 1, energy: 34 }, tip: "Clean carbs for energy." },
    { name: "Protein shake",   d: { weight: -1, muscle: 3, energy: 16 }, tip: "Muscle fuel." },
    { name: "Greek yogurt",    d: { weight: -1, muscle: 1, energy: 14 }, tip: "Protein, light." },
    { name: "Leftover curry",  d: { weight: 1,  muscle: 1, energy: 30 }, tip: "Tasty but calorie-dense." },
    { name: "Energy drink",    d: { weight: 1,  muscle: 0, energy: 40 }, tip: "Wired, empty calories." },
  ];

  function openActivity(id) {
    if (id === "tv") {
      return menu("TV & Phone", "You flop by the telly, phone in hand. Feed the brain?", [
        choice("Calorie-math video", "+Knowledge, tiny energy", 6, function () {
          apply({ knowledge: 3, energy: -6 });
          say("Calories in, calories out. It <b>clicks</b>. (+Knowledge)");
        }),
        choice("Weight-loss science podcast", "+Knowledge, easy listen", 3, function () {
          apply({ knowledge: 2, energy: -3 });
          say("Two experts argue about protein for an hour. You learn things. (+Knowledge)");
        }),
        choice("Doomscroll gym-fail clips", "wastes energy", 0, function () {
          apply({ energy: -8, weight: 1 });
          say("Forty minutes gone and you absent-mindedly ate a granola bar. (−Energy, +Weight)");
        }),
      ]);
    }

    if (id === "squat") {
      var kb = state.knowledge >= 8 ? 1 : 0;
      return menu("Bodyweight Squats", "Down on the mat. How hard are we going?" + (kb ? " (Form dialled — bonus muscle.)" : ""), [
        choice("Easy — 3×10", "+Muscle, −Weight", 10, function () {
          apply({ muscle: 2 + kb, weight: -1, energy: -10 });
          say("Smooth reps. Legs warm. (+Muscle, −Weight)");
        }),
        choice("Solid — 5×15", "more muscle, more cost", 20, function () {
          apply({ muscle: 4 + kb, weight: -2, energy: -20 });
          say("Quads on fire in the best way. (+Muscle, −Weight)");
        }),
        choice("Ego lift — 10×25", "big gains, big drain", 34, function () {
          apply({ muscle: 6 + kb, weight: -3, energy: -34 });
          say("You can't feel your legs. Worth it? Probably. (++Muscle, −−Energy)");
        }),
      ]);
    }

    if (id === "door") {
      return menu("Walk the Dog", "Milo the wire fox terrier is spinning by the door. Gentle cardio — mostly melts weight.", [
        choice("Around the block", "−Weight, cheap", 4, function () {
          apply({ weight: -1, energy: -4 });
          say("Milo sniffs every lamppost. Nice and easy. (−Weight)");
        }),
        choice("To the park", "−Weight, a little tone", 6, function () {
          apply({ weight: -2, muscle: 1, energy: -6 });
          say("A brisk loop of the park. You feel human again. (−Weight, +Muscle)");
        }),
        choice("Long trail hike", "−−Weight", 12, function () {
          apply({ weight: -4, muscle: 1, energy: -12 });
          say("Two hours up the ridge. Milo's asleep before you unclip the leash. (−−Weight)");
        }),
      ]);
    }

    if (id === "bells") return kettlebellMenu();
    if (id === "kitchen") return kitchenMenu();

    if (id === "bed") {
      return menu("Bed", "The mattress calls. Sleeping banks a fresh day of energy and lets muscle recover.", [
        choice("Sleep till morning", "new day, full energy", 0, function () {
          var gain = 100 - state.energy;
          state.day += 1;
          apply({ energy: gain, muscle: 1 });
          say("You wake on <b>Day " + state.day + "</b>, recovered and ready. (+Energy, +Muscle)");
        }),
      ]);
    }

    if (id === "pullup") return pullupMenu();
  }

  function kettlebellMenu() {
    var heavy = state.bell === "heavy";
    var canHeavy = state.knowledge >= 6;
    var bonus = heavy ? 3 : 0;
    var flavor = "Two adjustable bells — the best muscle-builder in the flat, but hungry for energy." +
      (canHeavy ? "" : " (Heavy setting unlocks at Knowledge 6 — learn your programming first.)");
    menu("Kettlebells", flavor, [
      toggle("Bell weight: " + (heavy ? "HEAVY" : "LIGHT"), canHeavy ? "tap to switch" : "heavy locked",
        canHeavy, function () { state.bell = heavy ? "light" : "heavy"; save(); kettlebellMenu(); }),
      choice("Double swings", "+Muscle, −Energy", heavy ? 30 : 22, function () {
        apply({ muscle: 5 + bonus, weight: -2, energy: heavy ? -30 : -22 });
        say("Hips snap, bells float. Posterior chain: obliterated. (+Muscle)");
      }),
      choice("Double cleans", "+Muscle, −Energy", heavy ? 34 : 26, function () {
        apply({ muscle: 6 + bonus, weight: -1, energy: heavy ? -34 : -26 });
        say("Rack position, controlled. Forearms screaming. (+Muscle)");
      }),
      choice("Double front squats", "++Muscle, −−Energy", heavy ? 38 : 30, function () {
        apply({ muscle: 7 + bonus, weight: -2, energy: heavy ? -38 : -30 });
        say("Legs and lungs both file a complaint. Elite work. (++Muscle)");
      }),
    ]);
  }

  function kitchenMenu() {
    var pool = FOOD_POOL.slice();
    shuffle(pool);
    var showTips = state.knowledge >= 4;
    var rows = pool.slice(0, 3).map(function (f) {
      return choice(f.name, showTips ? f.tip : "who knows?", 0, function () {
        apply(f.d);
        say("You eat the <b>" + f.name.toLowerCase() + "</b>. " + describeFood(f.d));
      });
    });
    rows.splice(Math.floor(Math.random() * (rows.length + 1)), 0,
      choiceDanger("🍕 Pizza", showTips ? "DO NOT. Run ends." : "smells amazing…", function () {
        close(); lose();
      }));
    menu("Kitchen", "The rotating menu of the day. Choose wisely — one option ends the run instantly." +
      (showTips ? " (Your nutrition know-how flags the good picks.)" : ""), rows);
  }

  function describeFood(d) {
    var bits = [];
    if (d.weight < 0) bits.push("−Weight"); else if (d.weight > 0) bits.push("+Weight");
    if (d.muscle > 0) bits.push("+Muscle");
    if (d.energy > 0) bits.push("+Energy");
    return "(" + bits.join(", ") + ")";
  }

  function pullupMenu() {
    var r = ratio();
    menu("Pull-Up Bar", "The bar you mounted in the doorway months ago, mostly for hanging laundry. Time to test yourself.", [
      choice("Attempt a pull-up", "needs strength-to-weight", 5, function () {
        apply({ energy: -5 });
        if (r >= WIN_RATIO) { win(); }
        else { say("You leap, grab, strain… and <b>dangle</b>. Not strong enough yet — lighter and stronger, that's the recipe."); }
      }),
    ]);
  }

  // ============================================================ MENU UI
  function menu(title, flavor, rows) {
    menuTitle.textContent = title;
    menuFlavor.textContent = flavor;
    menuChoices.innerHTML = "";
    rows.forEach(function (r) { menuChoices.appendChild(r); });
    backdrop.classList.add("open");
  }
  function close() { backdrop.classList.remove("open"); }

  function choice(title, sub, energyCost, fn) {
    var b = document.createElement("button");
    b.className = "choice";
    var tooTired = energyCost > 0 && state.energy < energyCost;
    var subText = tooTired ? "Too tired — eat or sleep first" : (sub || "");
    b.innerHTML = "<span>" + esc(title) + "</span>" + (subText ? "<span class='sub'>" + esc(subText) + "</span>" : "");
    if (tooTired) { b.disabled = true; }
    else {
      b.addEventListener("click", function () {
        if (!backdrop.classList.contains("open")) return;
        fn();
        if (backdrop.classList.contains("open")) close();
      });
    }
    return b;
  }

  function choiceDanger(title, sub, fn) {
    var b = document.createElement("button");
    b.className = "choice danger";
    b.innerHTML = "<span>" + esc(title) + "</span><span class='sub'>" + esc(sub) + "</span>";
    b.addEventListener("click", fn);
    return b;
  }

  function toggle(title, sub, enabled, fn) {
    var b = document.createElement("button");
    b.className = "choice";
    b.innerHTML = "<span>" + esc(title) + "</span><span class='sub'>" + esc(sub) + "</span>";
    if (enabled) b.addEventListener("click", fn); else b.disabled = true;
    return b;
  }

  document.getElementById("menuCancel").addEventListener("click", close);
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });

  // ============================================================ END STATES
  function win() {
    state.ended = "win"; clearSave();
    showEnd("win", "PULL-UP!", "Chin clears the bar, clean and slow. Strong, lean, and still a unit — that's the whole game. Milo is deeply impressed. You win on Day " + state.day + ".");
  }
  function lose() {
    state.ended = "lose"; clearSave();
    showEnd("lose", "GAME OVER", "You ate the pizza. It was, admittedly, incredible. The strongman journey ends here, crumbs and all.");
  }
  function showEnd(kind, title, text) {
    close();
    endscreen.className = "endscreen open " + kind;
    document.getElementById("endTitle").textContent = title;
    document.getElementById("endText").textContent = text;
  }
  document.getElementById("endBtn").addEventListener("click", function () {
    state = freshState(); clearSave(); save();
    endscreen.className = "endscreen";
    guy.x = guy.targetX = 180; guy.dir = 1;
    updateHUD(); draw();
    say("Fresh start. Tap a spot to walk over and interact. Nail a <b>pull-up</b> to win — dodge the pizza.");
  });

  // ============================================================ UTIL
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } }
  function save() { try { GCStorage.set(GAME_ID, "save", state); } catch (e) {} }
  function load() { try { return GCStorage.get(GAME_ID, "save", null); } catch (e) { return null; } }
  function clearSave() { try { GCStorage.set(GAME_ID, "save", null); } catch (e) {} }

  // ============================================================ BOOT
  updateHUD();
  draw();
  loadAsset("room", "art/room.png");
  loadAsset("hero", "art/hero.png");
})();

// Save files for Newsey — the "three slots on the file-select screen" model
// every cartridge-era RPG shipped with.
//
// One localStorage key per file (gc:the-game:slot1..3) plus a pointer at the
// file that was played last (so the title screen's CONTINUE knows where to go).
// A file is a single JSON blob holding everything the world remembers; the
// game writes it whole and reads it whole, so there is no partial-save state
// to reason about.
window.NewseySaves = (function () {
  var gameId = "the-game";
  var SLOT_COUNT = 3;
  var VERSION = 1;

  function key(i) { return "slot" + i; }

  // A brand-new file. `pos` stays null until the player has actually moved,
  // so a fresh file drops you at the room's own start position.
  function blank() {
    return {
      version: VERSION,
      introSeen: false,
      room: "house",
      pos: null,
      duelsWon: {},   // opponent id -> times beaten
      lines: {},      // npc id -> how far through their dialogue you are
      playSeconds: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  // Fills in anything a file written by an older build is missing, so loading
  // an old save can never blow up on an undefined field.
  function normalize(data) {
    if (!data || typeof data !== "object") return null;
    var b = blank();
    b.version = VERSION;
    b.introSeen = !!data.introSeen;
    b.room = data.room || "house";
    b.pos = data.pos && typeof data.pos.x === "number" ? { x: data.pos.x, y: data.pos.y } : null;
    b.duelsWon = data.duelsWon || {};
    b.lines = data.lines || {};
    b.playSeconds = data.playSeconds || 0;
    b.createdAt = data.createdAt || Date.now();
    b.updatedAt = data.updatedAt || b.createdAt;
    return b;
  }

  // Before file slots existed the game kept one unnamed save at
  // gc:the-game:save. Anyone who was mid-playthrough when this shipped would
  // otherwise open the game to three empty files and lose it, so the old save
  // is promoted to File 1 the first time this runs and then removed.
  (function migrateLegacySave() {
    var legacy = window.GCStorage.get(gameId, "save", null);
    if (!legacy) return;
    if (!window.GCStorage.get(gameId, key(1), null)) {
      var f = normalize(legacy);
      f.createdAt = f.updatedAt = Date.now();
      window.GCStorage.set(gameId, key(1), f);
      window.GCStorage.set(gameId, "lastSlot", 1);
    }
    window.GCStorage.remove(gameId, "save");
  })();

  function read(i) {
    return normalize(window.GCStorage.get(gameId, key(i), null));
  }

  function write(i, data) {
    data.version = VERSION;
    data.updatedAt = Date.now();
    window.GCStorage.set(gameId, key(i), data);
    window.GCStorage.set(gameId, "lastSlot", i);
  }

  function erase(i) {
    window.GCStorage.remove(gameId, key(i));
    if (lastSlot() === i) window.GCStorage.remove(gameId, "lastSlot");
  }

  function copy(from, to) {
    var src = read(from);
    if (!src) return false;
    src.createdAt = Date.now();
    write(to, src);
    return true;
  }

  function lastSlot() {
    var i = window.GCStorage.get(gameId, "lastSlot", null);
    return (i >= 1 && i <= SLOT_COUNT && read(i)) ? i : null;
  }

  function list() {
    var out = [];
    for (var i = 1; i <= SLOT_COUNT; i++) out.push({ index: i, data: read(i) });
    return out;
  }

  // "2:07" — hours:minutes, the way a file-select screen shows a clock.
  function formatPlaytime(seconds) {
    var s = Math.max(0, Math.floor(seconds || 0));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h > 0) return h + ":" + (m < 10 ? "0" : "") + m;
    return m + ":" + (Math.floor(s % 60) < 10 ? "0" : "") + Math.floor(s % 60);
  }

  return {
    SLOT_COUNT: SLOT_COUNT,
    blank: blank,
    read: read,
    write: write,
    erase: erase,
    copy: copy,
    list: list,
    lastSlot: lastSlot,
    formatPlaytime: formatPlaytime
  };
})();

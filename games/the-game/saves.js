// Save files for Newsey — the "three slots on the file-select screen" model
// every cartridge-era RPG shipped with.
//
// The slot mechanics (which localStorage keys, which slot was played last,
// copy/erase/list) now live in shared/save-slots.js, generic enough for any
// game that wants a file-select screen instead of one bare GCStorage key.
// This file is what's left once that's factored out: Newsey's own save
// SHAPE (blank()/normalize()), its version stamp, and a one-time migration
// of the pre-slot single save that predates shared/save-slots.js entirely.
window.NewseySaves = (function () {
  var gameId = "the-game";
  var VERSION = 1;

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
      flags: {},      // one-off story switches, e.g. chuckIn once you let him in
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
    b.flags = data.flags || {};
    b.playSeconds = data.playSeconds || 0;
    b.createdAt = data.createdAt || Date.now();
    b.updatedAt = data.updatedAt || b.createdAt;
    return b;
  }

  var slots = window.GCSaveSlots.create(gameId, { slots: 3, blank: blank, normalize: normalize });

  // Before file slots existed the game kept one unnamed save at
  // gc:the-game:save. Anyone who was mid-playthrough when this shipped would
  // otherwise open the game to three empty files and lose it, so the old save
  // is promoted to File 1 the first time this runs and then removed. This
  // predates shared/save-slots.js (a NEW game consuming that module has no
  // such legacy key), so it stays here rather than in the shared module.
  (function migrateLegacySave() {
    var legacy = window.GCStorage.get(gameId, "save", null);
    if (!legacy) return;
    if (!slots.read(1)) {
      var f = normalize(legacy);
      f.createdAt = f.updatedAt = Date.now();
      slots.write(1, f);
    }
    window.GCStorage.remove(gameId, "save");
  })();

  function write(i, data) {
    data.version = VERSION;
    slots.write(i, data);
  }

  return {
    SLOT_COUNT: slots.SLOT_COUNT,
    blank: blank,
    read: slots.read,
    write: write,
    erase: slots.erase,
    copy: slots.copy,
    list: slots.list,
    lastSlot: slots.lastSlot,
    formatPlaytime: window.GCSaveSlots.formatPlaytime
  };
})();

// Slot-based save files: N localStorage "cartridges" plus a pointer at the
// slot that was played last, for a title screen's CONTINUE to know where to
// go. A slot is a single JSON blob a game writes and reads whole — there is
// no partial-save state to reason about.
//
// Extracted from Newsey's (games/the-game/saves.js) file-select model, the
// only game in this repo that had gone further than a handful of loose
// GCStorage keys (dog-punk, hypergolic-hull, trebor each just call
// GCStorage.get/set directly, key by key, with no shared shape or
// migration). Most games don't need slots at all — this is for the ones
// that do, opted into per-game rather than forced on everyone.
//
// The SHAPE of a save is yours: this module owns the slot mechanics (which
// localStorage keys, which slot was played last, copy/erase/list), not the
// fields inside a save. Supply a blank() describing a new file, and
// optionally a normalize() that coerces a loaded file into your current
// shape — the same trick Newsey uses instead of a per-version transform
// table: normalize() always rebuilds from blank() and copies over only
// what's present and valid, so a file from an older build with missing or
// renamed fields just gets defaults instead of throwing. If your shape
// needs a version stamp for migrations, put it in blank()/normalize()
// yourself; this module doesn't assume every game wants one.
//
// Usage:
//   const SAVES = GCSaveSlots.create("my-game", {
//     slots: 3,                        // how many cartridges (default 3)
//     blank: () => ({ room: "start", pos: null, flags: {} }),   // required
//     normalize: (data) => ({ ...blankShape, ...data }),        // optional
//   });
//   const file = SAVES.read(1) || SAVES.blank();
//   file.room = "kitchen";
//   SAVES.write(1, file);
//   SAVES.list().forEach(({ index, data }) => ...);   // data is null if empty
window.GCSaveSlots = {
  create(gameId, opts) {
    opts = opts || {};
    const SLOT_COUNT = opts.slots || 3;
    const blank = opts.blank;
    if (typeof blank !== "function") {
      throw new Error(`GCSaveSlots.create("${gameId}", ...) needs a blank() function describing a new file's shape`);
    }
    const normalize = opts.normalize || ((data) => Object.assign({}, blank(), data));

    const key = (i) => "slot" + i;

    function read(i) {
      const data = window.GCStorage.get(gameId, key(i), null);
      return data ? normalize(data) : null;
    }

    function write(i, data) {
      data.updatedAt = Date.now();
      window.GCStorage.set(gameId, key(i), data);
      window.GCStorage.set(gameId, "lastSlot", i);
    }

    function erase(i) {
      window.GCStorage.remove(gameId, key(i));
      if (lastSlot() === i) window.GCStorage.remove(gameId, "lastSlot");
    }

    function copy(from, to) {
      const src = read(from);
      if (!src) return false;
      src.createdAt = Date.now();
      write(to, src);
      return true;
    }

    function lastSlot() {
      const i = window.GCStorage.get(gameId, "lastSlot", null);
      return (i >= 1 && i <= SLOT_COUNT && read(i)) ? i : null;
    }

    function list() {
      const out = [];
      for (let i = 1; i <= SLOT_COUNT; i++) out.push({ index: i, data: read(i) });
      return out;
    }

    return { SLOT_COUNT, blank, read, write, erase, copy, list, lastSlot };
  },

  // "2:07" — hours:minutes, the way a file-select screen shows a clock.
  // A plain helper rather than something create() hands back, since only
  // saves with a playSeconds-style field tend to need it.
  formatPlaytime(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h > 0) return h + ":" + (m < 10 ? "0" : "") + m;
    const sec = Math.floor(s % 60);
    return m + ":" + (sec < 10 ? "0" : "") + sec;
  },
};

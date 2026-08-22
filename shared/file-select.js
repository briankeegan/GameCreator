// A cartridge-era "SELECT FILE" screen: PLAY / COPY / ERASE modes over N
// save slots from shared/save-slots.js.
//
// WHY THIS EXISTS. Extracted from Newsey's own menu.js — the first game in
// this repo to go past a single checkpoint save to a real file-select
// screen. The MODE state machine and the copy/erase interaction (pick a
// slot, confirm, call SAVES.erase()/copy()) never once touch a save's
// SHAPE — they only call the slot mechanics save-slots.js already owns.
// Leaving that logic to be reinvented per game is the same gap
// shared/title-screen.js closed for the boot screen: a game with its own
// multi-slot save was going to have to build mode-switching and a
// copy/erase confirmation flow from nothing, the same way Dog Punk's first
// title screen had to build a whole screen from nothing.
//
// What stays YOURS: what a slot actually LOOKS like inside the list (room
// name, playtime, whatever stats this game tracks) — via renderSlotBody,
// same division of labour as save-slots.js owning slot mechanics but not a
// save's shape.
//
// Usage:
//   const FILES = GCFileSelect.create(gameId, {
//     saves: SAVES,                                    // from GCSaveSlots.create(...)
//     listEl: document.getElementById("fileList"),
//     noteEl: document.getElementById("fileNote"),      // optional
//     modeButtons: document.querySelectorAll("#menuFiles .mode-btn"),  // optional, data-mode="play|copy|erase"
//     renderSlotBody: (slot) => "...",                  // slot = {index, data}; data is null if empty
//     onPlay: (index, isNew) => { ...begin this file... },
//     confirm: (text, yesLabel, fn) => { ...call fn() only if the player confirms... },  // optional, defaults to window.confirm
//     notes: { play: "...", copy: "...", copyPicked: (from) => "...", erase: "..." },    // optional, overrides the default note text per mode
//     onRender: () => { ...update anything outside listEl that depends on mode/slots... },  // optional
//     onMessage: (text) => { ...show a toast, however this game shows one... },            // optional
//   });
//   FILES.render();          // (re)draws the list — call whenever this screen is shown
//   FILES.setMode("play");   // switch mode and re-render
//   FILES.mode();            // current mode
window.GCFileSelect = {
  create(gameId, opts) {
    opts = opts || {};
    const saves = opts.saves;
    if (!saves) {
      throw new Error(`GCFileSelect.create("${gameId}", ...) needs saves (a GCSaveSlots instance)`);
    }
    const listEl = opts.listEl;
    if (!listEl) {
      throw new Error(`GCFileSelect.create("${gameId}", ...) needs a listEl to render slot buttons into`);
    }
    const noteEl = opts.noteEl || null;
    const modeButtons = opts.modeButtons || [];
    const renderSlotBody = opts.renderSlotBody || ((slot) => (slot.data ? "File " + slot.index : "— EMPTY —"));
    const onPlay = opts.onPlay || (() => {});
    const confirmFn = opts.confirm || ((text, yesLabel, fn) => { if (window.confirm(text)) fn(); });
    const notes = opts.notes || {};

    let mode = "play";
    let copySource = null;

    function noteFor() {
      if (mode === "copy") {
        return copySource
          ? (notes.copyPicked ? notes.copyPicked(copySource) : `Now pick where to copy File ${copySource}.`)
          : (notes.copy || "Pick the file to copy.");
      }
      if (mode === "erase") return notes.erase || "Pick a file to erase. This can't be undone.";
      return notes.play || "Pick a file to play. An empty file starts a new game.";
    }

    function render() {
      listEl.innerHTML = "";
      saves.list().forEach((slot) => {
        const btn = document.createElement("button");
        btn.className = "file-slot" + (slot.data ? "" : " empty") + (copySource === slot.index ? " selected" : "");

        const num = document.createElement("span");
        num.className = "file-num";
        num.textContent = slot.index;
        btn.appendChild(num);

        const body = document.createElement("span");
        body.className = "file-body";
        const content = renderSlotBody(slot);
        if (content instanceof Node) body.appendChild(content);
        else body.textContent = content;
        btn.appendChild(body);

        btn.addEventListener("click", () => pick(slot));
        listEl.appendChild(btn);
      });
      if (noteEl) noteEl.textContent = noteFor();
      for (const b of modeButtons) b.classList.toggle("on", b.dataset.mode === mode);
      if (opts.onRender) opts.onRender();
    }

    const say = (text) => { if (opts.onMessage) opts.onMessage(text); };

    function pick(slot) {
      if (mode === "erase") {
        if (!slot.data) { say("That file is already empty."); return; }
        confirmFn(`Erase File ${slot.index}? Everything on it is gone for good.`, "ERASE", () => {
          saves.erase(slot.index);
          say(`File ${slot.index} erased.`);
          render();
        });
        return;
      }
      if (mode === "copy") {
        if (copySource === null) {
          if (!slot.data) { say("Nothing on that file to copy."); return; }
          copySource = slot.index;
          render();
          return;
        }
        if (slot.index === copySource) { copySource = null; render(); return; }
        const doCopy = () => {
          saves.copy(copySource, slot.index);
          say(`Copied to File ${slot.index}.`);
          copySource = null;
          mode = "play";
          render();
        };
        if (slot.data) confirmFn(`File ${slot.index} already has a game on it. Overwrite it?`, "OVERWRITE", doCopy);
        else doCopy();
        return;
      }
      // play
      onPlay(slot.index, !slot.data);
    }

    function setMode(next) {
      mode = next;
      copySource = null;
      render();
    }

    for (const b of modeButtons) {
      b.addEventListener("click", () => setMode(b.dataset.mode));
    }

    return { render, setMode, mode: () => mode };
  },
};

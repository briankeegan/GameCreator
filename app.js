// Landing page: reads games.json and renders one card per game. Adding a
// game to the site is "add an entry to games.json" — this file never
// changes.
const gridEl = document.getElementById("gameGrid");
const loadingNoteEl = document.getElementById("loadingNote");

function cardFor(game) {
  const a = document.createElement("a");
  a.className = "gc-card";
  a.href = `games/${game.id}/index.html`;

  if (game.icon) {
    const img = document.createElement("img");
    img.className = "gc-card-icon";
    img.src = game.icon;
    img.alt = "";
    a.appendChild(img);
  }

  const h2 = document.createElement("h2");
  h2.textContent = game.name;
  a.appendChild(h2);

  if (game.tagline) {
    const p = document.createElement("p");
    p.textContent = game.tagline;
    a.appendChild(p);
  }

  return a;
}

fetch("games.json")
  .then((res) => res.json())
  .then((data) => {
    const games = data.games || [];
    gridEl.innerHTML = "";
    if (games.length === 0) {
      const empty = document.createElement("p");
      empty.className = "gc-empty";
      empty.textContent = "No games yet — add one to games.json to see it here.";
      gridEl.appendChild(empty);
      return;
    }
    for (const game of games) gridEl.appendChild(cardFor(game));
  })
  .catch(() => {
    loadingNoteEl.textContent = "Couldn't load the game list. Try reloading.";
  });

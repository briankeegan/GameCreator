const GAME_ID = "sample-clicker";

const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const clickBtn = document.getElementById("clickBtn");
const resetBtn = document.getElementById("resetBtn");

let score = GCStorage.get(GAME_ID, "score", 0);
let best = GCStorage.get(GAME_ID, "best", 0);

function render() {
  scoreEl.textContent = String(score);
  bestEl.textContent = String(best);
}

clickBtn.addEventListener("click", () => {
  score += 1;
  if (score > best) {
    best = score;
    GCStorage.set(GAME_ID, "best", best);
  }
  GCStorage.set(GAME_ID, "score", score);
  render();
});

resetBtn.addEventListener("click", () => {
  score = 0;
  GCStorage.set(GAME_ID, "score", score);
  render();
});

render();

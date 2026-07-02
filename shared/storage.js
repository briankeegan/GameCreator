// Namespaced localStorage so every game's save data lives in its own slot
// on a shared origin, with no chance of two games' keys colliding. Values
// can be anything JSON-serializable — a single number or a large nested
// object — each game shapes its own save data however it needs to.
//
// Usage: GCStorage.set("my-game", "best", 42)
//        GCStorage.get("my-game", "best", 0)
window.GCStorage = {
  key(gameId, key) {
    return `gc:${gameId}:${key}`;
  },
  get(gameId, key, fallback) {
    try {
      const raw = localStorage.getItem(this.key(gameId, key));
      return raw === null ? fallback : JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  },
  set(gameId, key, value) {
    try {
      localStorage.setItem(this.key(gameId, key), JSON.stringify(value));
    } catch (err) {
      // Storage full or private browsing — the value just won't persist.
    }
  },
  remove(gameId, key) {
    try {
      localStorage.removeItem(this.key(gameId, key));
    } catch (err) {
      // ignore
    }
  },
};

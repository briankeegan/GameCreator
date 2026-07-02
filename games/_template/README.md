# Starting a new game

1. Copy this whole folder: `cp -r games/_template games/your-game-id`
   (use lowercase-with-dashes for the id — it becomes part of the URL).
2. In `index.html`: replace `TEMPLATE_GAME_NAME` and `TEMPLATE_GAME_ID`
   (search for both, a handful of spots each — title, nav script data
   attributes, manifest link).
3. In `manifest.webmanifest`: replace `TEMPLATE_GAME_NAME` and the theme
   color if you want a different one.
4. Build your game in `app.js` / `style.css` / the `<main>` in `index.html`.
   That's the only code you need to touch — the header bar (with the "All
   Games" link and chat button), install banner, and offline support all
   come from `../../shared/` already wired up.
5. Save progress with `window.GCStorage`:
   ```js
   GCStorage.set("your-game-id", "best", 42);
   GCStorage.get("your-game-id", "best", 0); // -> 42, or 0 if never saved
   ```
   The value can be any JSON-serializable thing — a number, or a big object
   if your game's save data is more complex.
6. Replace the icons in `icons/` (192, 512, and 180 px PNGs).
7. In `sw.js`, change the cache name and asset list to match your files.
8. Add your game to the root `games.json` so it shows up on the landing page.
9. Give it a chat thread — see the root `README.md`, step 5.

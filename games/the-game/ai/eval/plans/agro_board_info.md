# Plan: board info (not implemented)

Read the same way for **both** boards. Each answers a different question.

| | Question it answers | How it's measured | Values |
|---|---|---|---|
| **Topped out** | Is it dying right now? | A panel or garbage in the top row | yes / no |
| **Stop time** | How long is it safe? | Frames left frozen | frames |
| **Height** | How close to the top? | Tallest column, garbage included | rows (tall at 9+) |
| **Material** | What does it have to break garbage with? | Panels **below** the garbage, counted one by one. Panels trapped above a slab don't count — they can't be used until that slab is gone. No garbage: every panel counts | 0–72 panels |
| **Contact** | Where can the garbage be broken from? | Columns whose panels reach right up to the bottom of the garbage. A slab resting on 2 columns can only be broken from those 2 | 0–6 columns (only with garbage on the board) |
| **Evenness** | How easy is it to build a match? | Tallest panel column minus lowest | rows (0 = flat) |
| **Break ready** | Can it answer the next block the moment it lands? | A match that will touch the block, reachable before it lands | yes / no |
| **Garbage coming** | What's about to hit? | Each block: size, when it lands, stop time it gives. Total rows coming | light (≤ 8 rows) / heavy (> 8) |

Why these don't repeat:
- **Height vs material** — a tall stack can be mostly garbage with few panels under it.
- **Material vs contact** — plenty of panels, but if they don't reach the slab they can't break it.
- **Contact vs evenness** — contact is about the garbage; evenness is about the panels, with or without garbage.

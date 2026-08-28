# Base rules for anything that generates art

Five rules. Every one of them was learned by losing something, and every one is
CHECKED by `.github/scripts/check_generators.mjs`, gated in `pages.yml`, so a
new generator cannot quietly skip one.

Read this before writing a new generator or a new Action that makes images.
The three existing front doors — `generate_row.py`, `room.py`, `tileset.py` —
plus `generate_portrait.py` are the worked examples.

---

## 1. Go through the one transport

`.github/art/imagegen.py` is the only place an image request is built and sent.
It validates every setting against what the API actually accepts, so a wrong
value fails loudly instead of being silently ignored, and it picks the backend
(the in-run broker if one is listening, otherwise `OPENAI_API_KEY` — a model is
never handed the key).

Going through it is also how a generator inherits rules 2 and 3 for free.

Two Actions still curl the API directly, because they use the multipart
`/v1/images/edits` endpoint that `imagegen.py`'s JSON `build_request()` does not
cover: `generate-walksheet.yml` and `generate-referenced-asset.yml`. Unifying
that transport is real work, not yet done. Until it is, those two carry rule 2
by hand — and the checker requires it of them by name, so the exemption cannot
spread by copy-paste.

## 2. Never pay for the same picture twice

An image is billed the instant the API returns it. Everything after — cutting,
cropping, verifying, committing, pushing — is free. So any failure downstream of
the generation used to cost a whole new picture, and **a new one is never the
same picture**, which is worse than the outage: you cannot go back and look at
what you had.

`.github/art/vault.py` fixes this. `restore` before spending, `save` the instant
the picture exists — before anything that can fail. Raws live on an orphan
`art-vault` branch, which nothing deploys and no gate reads, so a raw pushed
seconds after generation cannot reach the site before a checker has seen it.

`--force` / `force: true` skips the restore on purpose: that is exactly what
asking for a NEW picture means.

This is inside `imagegen.generate()`, not in each front door, and that placement
is the rule. It began as two hand-wired calls in one generator, which is the
same mistake as that generator having had no front door in the first place: a
rule that each caller has to remember separately is a rule that will be missing
from one of them.

Three separate failures cost real money before this existed: a sheet that failed
`verify_sheet.py` died with the runner; a cancelled job never reached its commit
step; and twelve portraits generated correctly and were lost to an unstaged file
blocking the push.

## 3. A committing job commits what IT made, and discards the rest — loudly

Stage the files this run produced, by name. Do not `git add` a directory: a
batch of jobs running at once will sweep up each other's work.

Then **report and discard anything still in the tree**. `git pull --rebase`
refuses outright on a dirty tree, and a job that has already committed what it
came to keep has no use for what is left. This is the rule that does not depend
on anyone predicting which file a future tool writes — the prediction that
failed and cost twelve pictures, when `imagegen.py`'s own `generated.json`
provenance manifest went unstaged and the retry loop reported it as a "push
race" five times over.

Print the leftovers before discarding them. A stray write is still a bug in
whatever wrote it; it should just no longer be able to destroy anything.

## 4. A never-fail component needs someone else to ask whether it works

`vault.py` never fails its caller, deliberately: losing the safety net must not
also lose the art it is protecting. That is correct, and it makes the vault the
one tool whose failure is INVISIBLE — it duly broke on its first run (worktree
created under `.git/`, which git refuses), reported success, and saved nothing.
Nobody would have found out until the next time something was lost, which is
exactly when it is meant to be there.

So `.github/scripts/vault.test.sh` proves a real round-trip on every push:
save, delete, restore, compare bytes. Any component built not to fail needs the
same treatment.

## 5. The prompt comes from a file, and the subject from a spec

The recipe lives in exactly one canonical prompt file (`walkgrid_prompt.txt`,
`attacksheet_prompt.txt`, `walksheet_prompt.txt`, `portrait_prompt.txt`,
`room_prompts/`, `tileset_prompts/`). Edit it there and every future generation
inherits the fix. A prompt retyped into an Action drifts from the standard it
came from, and nothing notices.

WHO is being drawn comes from `characters.<id>` in the game's `art-style.json`,
built by `generate_row.spec_to_prompt()` — the same function for the walk sheet
and the portrait, which is what makes them the same person. **No spec, no
generation**: a character without one is refused, because the spec has to exist
before the art or there is nothing to check the art against afterwards.

For an adapted game, a spec also records where each detail CAME from
(`plotQuote`, and `source: "plot" | "design"` per material) — see
`check_character_specs.mjs`. Art is regenerated from specs, so an invented
detail becomes canon on the next regeneration.

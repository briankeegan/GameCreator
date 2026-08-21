#!/usr/bin/env node
"use strict";
/**
 * Shrink a Clubhouse thread before it is handed to the run's model.
 *
 * WHY. The whole thread went into every run, verbatim. Dog Punk's is ~60
 * comments and many of them are long — several are Claude's own multi-paragraph
 * "here is what shipped and why" replies. That is a large input paid for on
 * every run, and a message that fails and retries pays it three times over. The
 * account's API budget went in a day.
 *
 * WHAT IT KEEPS. The last few messages verbatim, because that is what the run
 * is actually answering and the exact words matter. Everything older is
 * compressed by HAIKU — the cheapest model available — into a brief of what the
 * game is, what has been asked for, what shipped, and what is still outstanding.
 * Old thread text is background: the run needs to know a rat sheet was
 * regenerated onto the standard, not the four paragraphs explaining it.
 *
 * IT MUST NEVER BREAK A RUN. Every failure path — no key, API down, bad
 * response, timeout — falls back to a plain tail of the thread and exits 0. A
 * summariser that can block answering a message is worse than an expensive
 * prompt.
 *
 *   node compress-history.js < thread.txt > brief.txt
 *
 * Env: ANTHROPIC_API_KEY (required for the summary; without it, tail only)
 *      GC_HISTORY_KEEP    verbatim messages to keep (default 6)
 *      GC_HISTORY_BUDGET  bytes below which nothing is compressed (default 12000)
 */

const SEP = "\n\n---\n\n";
// 10, not 6. The run has to work out which messages are still unanswered, and
// it does that from the verbatim section — so that section must reliably reach
// back past the last "**Claude says:**" reply. Tonight's thread had five
// consecutive user messages with only failure notices between them; six would
// have cut into the middle of that. Ten messages is still a ~10x saving on a
// thread this size, and being cheap is not worth answering half a question.
const KEEP = parseInt(process.env.GC_HISTORY_KEEP || "10", 10);
const BUDGET = parseInt(process.env.GC_HISTORY_BUDGET || "12000", 10);
const MODEL = "claude-haiku-4-5-20251001";

function read(stream) {
  return new Promise((res) => {
    let d = "";
    stream.setEncoding("utf8");
    stream.on("data", (c) => (d += c));
    stream.on("end", () => res(d));
  });
}

async function summarise(text) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const body = JSON.stringify({
    model: MODEL,
    max_tokens: 900,
    messages: [{
      role: "user",
      content:
        "Below is the older part of a chat thread between a game's owner and an " +
        "automated assistant that builds the game. Summarise it as a briefing for " +
        "the assistant's next run, in under 400 words. Cover, in this order: what " +
        "the game is and its current state; decisions and preferences the owner " +
        "has stated (these are standing instructions, keep them exact); what has " +
        "shipped; and anything explicitly left outstanding or promised. Drop " +
        "narration, apologies, and explanations of how things were fixed. Write " +
        "plain prose, no preamble.\n\n" + text,
    }],
  });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body,
      signal: ctl.signal,
    });
    if (!res.ok) {
      console.error(`[compress] HTTP ${res.status} — falling back to a plain tail`);
      return null;
    }
    const data = await res.json();
    const out = (data.content || []).map((c) => c.text || "").join("").trim();
    return out || null;
  } catch (e) {
    console.error(`[compress] ${e.message} — falling back to a plain tail`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  const raw = await read(process.stdin);
  if (raw.length <= BUDGET) {
    process.stdout.write(raw);
    console.error(`[compress] ${raw.length}B is under the ${BUDGET}B budget — left alone`);
    return;
  }
  const parts = raw.split(SEP);
  const head = parts.length > KEEP ? parts.slice(0, parts.length - KEEP) : [];
  const tail = parts.slice(-KEEP);
  let brief = null;
  if (head.length) brief = await summarise(head.join(SEP));

  const out = [];
  if (brief) {
    out.push("=== EARLIER IN THIS THREAD (summarised — the owner's stated");
    out.push("preferences below are standing instructions) ===");
    out.push(brief);
  } else if (head.length) {
    out.push(`=== ${head.length} earlier message(s) omitted ===`);
  }
  out.push(`\n=== THE LAST ${tail.length} MESSAGES, VERBATIM ===`);
  out.push(tail.join(SEP));
  const result = out.join("\n");
  process.stdout.write(result);
  console.error(
    `[compress] ${raw.length}B -> ${result.length}B ` +
    `(${brief ? "summarised" : "tail only"}; ${head.length} older, ${tail.length} kept verbatim)`
  );
})();

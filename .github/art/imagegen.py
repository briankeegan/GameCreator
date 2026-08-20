"""One image-generation transport, shared by every front door in this repo.

`generate_row.py` (characters) and `room.py generate` (rooms) both call this,
so a rule added here — the retry policy, where the key may live, what counts as
a written file — holds for both without being written twice. The repo has been
bitten twice by the same recipe existing in two places and drifting; this is
the fix applied to the part that talks to the network.

TWO TRANSPORTS, chosen automatically, because the callers run in different
places and neither should have to care:

  * a BROKER on 127.0.0.1:8791 — the Clubhouse autopilot starts one
    (.github/autopilot/image-broker.js). It holds the OpenAI key, which the
    model in that run deliberately does not have, and caps generations per run.
    If it is listening, it wins.
  * OPENAI_API_KEY — what a workflow_dispatch Action has, as a repo secret.

A model is never handed the key in either case. Set GC_IMAGE_BROKER to point
at a broker somewhere else.
"""

import base64
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
BROKER = os.environ.get('GC_IMAGE_BROKER', 'http://127.0.0.1:8791')


def broker_health():
    try:
        with urllib.request.urlopen(f'{BROKER}/health', timeout=2) as r:
            return json.loads(r.read())
    except Exception:
        return None


def _via_broker(prompt, out_rel, size, quality):
    # No "game" field on purpose: the broker would prepend its own art-style
    # framing, and every prompt that reaches here was already built from that
    # same art-style.json by its front door.
    payload = json.dumps({'prompt': prompt, 'output_path': out_rel,
                          'size': size, 'quality': quality}).encode()
    req = urllib.request.Request(f'{BROKER}/generate', data=payload,
                                 headers={'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            body = json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = json.loads(e.read() or b'{}')
        sys.exit(f'broker refused: {body.get("error", e)}')
    print(f'generated via broker ({body.get("remaining", "?")} generation(s) left this run)')


def _via_openai(prompt, out_abs, size, quality):
    key = os.environ['OPENAI_API_KEY']
    payload = json.dumps({'model': 'gpt-image-1', 'prompt': prompt,
                          'size': size, 'quality': quality, 'n': 1}).encode()
    # A rejected request is not billed, so retrying a rate limit costs nothing
    # — it just stops a batch failing against the per-minute image cap.
    for attempt in range(1, 7):
        req = urllib.request.Request('https://api.openai.com/v1/images/generations',
                                     data=payload,
                                     headers={'Authorization': f'Bearer {key}',
                                              'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                data = json.loads(r.read())
            break
        except urllib.error.HTTPError as e:
            body = (e.read() or b'').decode()
            if e.code == 429 or e.code >= 500:
                wait = attempt * 15
                print(f'rate-limited/transient (HTTP {e.code}, attempt {attempt}) — '
                      f'retrying in {wait}s', file=sys.stderr)
                time.sleep(wait)
                continue
            sys.exit(f'OpenAI API error (HTTP {e.code}): {body[:400]}')
    else:
        sys.exit('Still rate-limited after retries — try again later.')
    out_abs.write_bytes(base64.b64decode(data['data'][0]['b64_json']))
    print(f'generated via OpenAI -> {out_abs}')


def generate(prompt, out_rel, size='1536x1024', quality='medium', force=False):
    """Generate one image to a repo-relative path. Returns False if skipped."""
    out_abs = ROOT / out_rel
    if out_abs.exists() and out_abs.stat().st_size and not force:
        print(f'{out_rel} already exists — skipping (pass force to regenerate). '
              'Nothing was billed.')
        return False
    out_abs.parent.mkdir(parents=True, exist_ok=True)
    if broker_health():
        _via_broker(prompt, out_rel, size, quality)
    elif os.environ.get('OPENAI_API_KEY'):
        _via_openai(prompt, out_abs, size, quality)
    else:
        sys.exit('No image backend: start the broker '
                 '(.github/autopilot/image-broker.js) or set OPENAI_API_KEY. '
                 'A model is never given the key directly.')
    if not out_abs.exists() or not out_abs.stat().st_size:
        sys.exit(f'the backend reported success but wrote nothing to {out_rel}')
    return True

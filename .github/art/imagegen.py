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
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
BROKER = os.environ.get('GC_IMAGE_BROKER', 'http://127.0.0.1:8791')


def status(line):
    """Announce a step to whoever is watching, if anyone is.

    GC_STATUS_HOOK points at a script that posts progress somewhere a human can
    see it — in the Clubhouse autopilot that is a live-updating comment on the
    thread's PR. Unset (a person at a terminal, an Action), this just prints.

    The point of doing it HERE rather than having the model narrate: a line
    only appears because an image was actually requested. A model describing
    its own progress is the report that has already proved untrustworthy —
    earlier autopilot runs reported success on art that never changed.
    """
    print(f'[art] {line}', flush=True)
    hook = os.environ.get('GC_STATUS_HOOK')
    if not hook:
        return
    try:
        subprocess.run([hook, line], timeout=30, check=False)
    except Exception as e:                              # never fail a run over a status line
        print(f'[art] (status hook failed: {e})', file=sys.stderr)

def broker_health():
    try:
        with urllib.request.urlopen(f'{BROKER}/health', timeout=2) as r:
            return json.loads(r.read())
    except Exception:
        return None


# WHAT THE API ACCEPTS. Checked against the docs, not remembered. Anything not
# in here is rejected before a request is made, because the API ignores
# unknown fields silently — a typo would mean generating at the wrong settings
# for weeks and never being told.
ALLOWED = {
    "model": {"gpt-image-1", "gpt-image-2"},
    # gpt-image-2 also takes 2048x2048 and "auto"; gpt-image-1 does not.
    "size": {"gpt-image-1": {"1024x1024", "1024x1536", "1536x1024"},
             "gpt-image-2": {"1024x1024", "1024x1536", "1536x1024", "2048x2048", "auto"}},
    "quality": {"low", "medium", "high", "auto"},
    # "auto" is gpt-image-2 only.
    "background": {"transparent", "opaque", "auto"},
    "output_format": {"png", "jpeg", "webp"},
    "moderation": {"auto", "low"},          # gpt-image-2 only
}


def build_request(cfg, prompt):
    """Turn a generation profile into the exact API payload, or fail loudly.

    THE POINT OF THIS FUNCTION. The two transports used to build their own
    payloads, and they drifted: the broker sent `background` and the direct
    OpenAI path did not, so the same profile produced different images
    depending on who was asking — which is precisely what a shared transport
    was written to prevent. Now both call this.
    """
    model = cfg.get("model", "gpt-image-1")
    if model not in ALLOWED["model"]:
        raise ValueError(f'unknown model {model!r}; the API takes {sorted(ALLOWED["model"])}')
    payload = {"model": model, "prompt": prompt, "n": 1}

    size = cfg.get("size", "1024x1024")
    if size not in ALLOWED["size"][model]:
        raise ValueError(f'{model} does not take size {size!r}; it takes '
                         f'{sorted(ALLOWED["size"][model])}')
    payload["size"] = size

    for key in ("quality", "background", "output_format", "moderation"):
        val = cfg.get(key)
        if val is None:
            continue
        if val not in ALLOWED[key]:
            raise ValueError(f'{key}={val!r} is not accepted; the API takes '
                             f'{sorted(ALLOWED[key])}')
        if val == "auto" and model == "gpt-image-1" and key in ("background", "size"):
            raise ValueError(f'{key}="auto" is gpt-image-2 only')
        if key == "moderation" and model == "gpt-image-1":
            raise ValueError("moderation is gpt-image-2 only")
        payload[key] = val

    # background: transparent needs a format that HAS transparency.
    if payload.get("background") == "transparent" and payload.get("output_format", "png") == "jpeg":
        raise ValueError('background="transparent" needs output_format png or webp, not jpeg')
    return payload


def _via_broker(prompt, out_rel, cfg):
    # SEND THE MODEL. It used to be stripped here on the belief that the broker
    # owned it — and the broker had it hardcoded, so a Clubhouse run silently
    # generated on a different model from an Action running the same profile.
    # Both halves of a shared transport have to agree about who decides; the
    # caller decides, and the broker adds only the credential and the cap.
    payload = dict(build_request(cfg, prompt))
    payload.update({"output_path": out_rel,
                    "transparent": cfg.get("background") == "transparent"})
    # No "game" field on purpose: the broker would prepend its own art-style
    # framing, and every prompt that reaches here was already built from that
    # same art-style.json by its front door.
    req = urllib.request.Request(f'{BROKER}/generate', data=json.dumps(payload).encode(),
                                 headers={'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            body = json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = json.loads(e.read() or b'{}')
        sys.exit(f'broker refused: {body.get("error", e)}')
    print(f'generated via broker ({body.get("remaining", "?")} generation(s) left this run)')


def _via_openai(prompt, out_abs, cfg):
    key = os.environ['OPENAI_API_KEY']
    payload = json.dumps(build_request(cfg, prompt)).encode()
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


def generate(prompt, out_rel, size='1536x1024', quality='medium', force=False,
             background=None, model='gpt-image-1', output_format=None, moderation=None):
    """Generate one image to a repo-relative path. Returns False if skipped.

    Every caller passes settings from .github/art/profiles.py, keyed by what is
    being drawn. Nothing here decides them; this decides only how the request is
    made and that both transports make it identically.
    """
    cfg = {"model": model, "size": size, "quality": quality}
    for k, v in (("background", background), ("output_format", output_format),
                 ("moderation", moderation)):
        if v is not None:
            cfg[k] = v
    build_request(cfg, prompt)          # validate BEFORE anything is billed

    out_abs = ROOT / out_rel
    if out_abs.exists() and out_abs.stat().st_size and not force:
        print(f'{out_rel} already exists — skipping (pass force to regenerate). '
              'Nothing was billed.')
        return False
    out_abs.parent.mkdir(parents=True, exist_ok=True)
    if broker_health():
        _via_broker(prompt, out_rel, cfg)
    elif os.environ.get('OPENAI_API_KEY'):
        _via_openai(prompt, out_abs, cfg)
    else:
        sys.exit('No image backend: start the broker '
                 '(.github/autopilot/image-broker.js) or set OPENAI_API_KEY. '
                 'A model is never given the key directly.')
    if not out_abs.exists() or not out_abs.stat().st_size:
        sys.exit(f'the backend reported success but wrote nothing to {out_rel}')

    # RECORD WHAT DREW IT. Two sheets of one character generated on different
    # models are visibly two different styles standing next to each other —
    # Beverly's walk came off gpt-image-1 and her attack off gpt-image-2, and
    # the difference is obvious the moment she swings. Nothing could see that:
    # the colour check compares palettes, and both sheets were on-palette.
    #
    # The provenance is the one thing that makes it decidable, and it is free
    # to write down at the moment of generation. verify_sheet.py reads it.
    try:
        man_path = out_abs.parent / 'generated.json'
        man = json.loads(man_path.read_text()) if man_path.exists() else {}
        man[out_abs.name] = {k: v for k, v in cfg.items() if k != 'prompt'}
        man_path.write_text(json.dumps(man, indent=1, sort_keys=True) + '\n')
    except Exception as e:
        print(f'(could not record provenance: {e})', file=sys.stderr)
    return True


# ONE-OFF / FREEFORM CLI. The front door for art that is not a character row,
# a room pass, or a tile sheet — a title screen, a flat icon, a card. Exists so
# "Generate image" and "Generate game asset" (the two Actions for exactly that
# kind of one-off art) call THIS instead of hand-rolling their own curl+jq.
#
# They used to. Both had their own retry loop, both had `model: "gpt-image-1"`
# typed into a jq filter, and both were invisible to everything this file now
# does: request validation against what the API actually accepts, one place
# that decides the model, and the provenance manifest. A prompt built two
# different ways calling two different HTTP clients is exactly the kind of
# divergence this repo keeps finding the expensive way.
def _cli():
    import argparse
    ap = argparse.ArgumentParser(description=__doc__ or 'Generate one image.')
    ap.add_argument('--prompt', required=True)
    ap.add_argument('--output', required=True, help='repo-relative output path')
    ap.add_argument('--size', default='1024x1024')
    ap.add_argument('--quality', default='medium', choices=['low', 'medium', 'high', 'auto'])
    ap.add_argument('--background', choices=['transparent', 'opaque', 'auto'])
    ap.add_argument('--model', default=None,
                    help='defaults to profiles.py MODEL — the one place that decides it')
    ap.add_argument('--force', action='store_true')
    a = ap.parse_args()

    # REFUSE TO OWN A FRONT DOOR'S TERRITORY. art-src/ is exclusively where
    # generate_row.py, room.py and tileset.py write and read from — a
    # character row, a room pass, and a tile sheet all live there, and only
    # those three scripts know how to build the right prompt for one, wire in
    # the character spec, pick the right verification flags, and retry a
    # rejected attempt. A freeform call that happened to write into art-src/
    # would produce a file that LOOKS like a properly-generated row but has
    # none of that behind it — never checked, never retried, invisible to the
    # gates that only look inside sheets built through the real pipeline.
    #
    # This is not a style guideline, it is a hard stop: don't ask the model to
    # remember which door to use when the path alone already says.
    out_parts = pathlib.PurePosixPath(a.output.replace('\\', '/')).parts
    if 'art-src' in out_parts:
        sys.exit(
            f'{a.output} is inside an art-src/ directory, which belongs to the front '
            'doors, not this freeform CLI:\n'
            '  a character row  -> .github/art/generate_row.py --game <id> --character '
            '<id> --view front|side|back\n'
            '  a room pass      -> .github/art/room.py generate <gameDir> <room> '
            'scene|plate|props\n'
            '  a tile sheet     -> .github/art/tileset.py generate <gameDir> '
            'ground|objects\n'
            'Use imagegen.py directly only for art with no front door — an icon, a '
            'title screen, a logo.')

    model = a.model
    if not model:
        try:
            sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
            import profiles
            model = profiles.MODEL
        except Exception:
            model = 'gpt-image-1'

    ok = generate(a.prompt, a.output, size=a.size, quality=a.quality,
                 force=a.force, background=a.background, model=model)
    if not ok:
        return   # already exists, not forced — not an error
    print(f'wrote {a.output}')


if __name__ == '__main__':
    _cli()

#!/usr/bin/env python3
"""Tests for THE MONEY PATH: what happens around an image generation.

    python3 .github/scripts/generation.test.py

Every test here corresponds to a way real, paid-for art was lost, and none of
them spend anything or need an API key — the backend is replaced with a stub
that counts calls, which is the whole point: the assertions are about WHETHER
the API would be called, and that is exactly the question money depends on.

Why this exists on top of vault.test.sh: that one proves vault.py round-trips in
isolation, and it passed the whole time the vault was silently doing nothing
inside imagegen.generate(). A unit test of the safety net is not a test that the
net is attached.
"""

import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

ART = pathlib.Path(__file__).resolve().parents[1] / 'art'
FAILS = []


def check(name, cond, detail=''):
    print(f'{"PASS" if cond else "FAIL"}  {name}' + (f'  — {detail}' if detail and not cond else ''))
    if not cond:
        FAILS.append(name)


def fake_repo():
    """A throwaway repo with a throwaway remote, shaped like a CI checkout."""
    tmp = pathlib.Path(tempfile.mkdtemp(prefix='gc-gen-test-'))
    subprocess.run(['git', 'init', '-q', '--bare', '-b', 'main', str(tmp / 'remote.git')], check=True)
    work = tmp / 'work'
    subprocess.run(['git', 'init', '-q', '-b', 'main', str(work)], check=True)
    for k, v in (('user.email', 't@example.com'), ('user.name', 'test')):
        subprocess.run(['git', 'config', k, v], cwd=work, check=True)
    subprocess.run(['git', 'remote', 'add', 'origin', f'file://{tmp}/remote.git'], cwd=work, check=True)
    (work / '.github' / 'art').mkdir(parents=True)
    (work / 'games' / 'g' / 'art-src').mkdir(parents=True)
    for f in ('vault.py', 'imagegen.py', 'profiles.py'):
        shutil.copy(ART / f, work / '.github' / 'art' / f)
    (work / 'README.md').write_text('seed\n')
    subprocess.run(['git', 'add', '-A'], cwd=work, check=True)
    subprocess.run(['git', 'commit', '-qm', 'seed'], cwd=work, check=True)
    subprocess.run(['git', 'push', '-q', 'origin', 'main'], cwd=work, check=True)
    return tmp, work


def load_imagegen(work, calls):
    """Import the real imagegen from `work`, with the backend stubbed out."""
    for mod in ('imagegen', 'vault', 'profiles'):
        sys.modules.pop(mod, None)
    sys.path.insert(0, str(work / '.github' / 'art'))
    import imagegen                                   # noqa: E402
    sys.path.pop(0)

    def stub(prompt, out_abs, cfg):
        calls.append(str(out_abs))
        pathlib.Path(out_abs).write_bytes(b'FRESH-GENERATION')

    imagegen.broker_health = lambda: False            # never reach the broker
    imagegen._via_openai = stub                       # never reach the API
    os.environ['OPENAI_API_KEY'] = 'test-not-a-real-key'
    return imagegen


def main():
    tmp, work = fake_repo()
    cwd = os.getcwd()
    try:
        os.chdir(work)
        calls = []
        imagegen = load_imagegen(work, calls)
        rel = 'games/g/art-src/hero_raw.png'
        target = work / rel
        args = dict(size='1024x1024', quality='medium', background='opaque',
                    model='gpt-image-2', kind='icon')

        # 1. A FIRST GENERATION SPENDS, AND IS BANKED IMMEDIATELY.
        # The save has to happen inside generate(), before the caller gets a
        # chance to cut, verify, commit or push — every one of which has lost a
        # picture at least once.
        ok = imagegen.generate('a hero', rel, **args)
        check('a first generation calls the backend', len(calls) == 1, f'calls={len(calls)}')
        check('a first generation returns True', ok is True)
        check('the raw is banked by generate() itself, not by the caller',
              subprocess.run(['git', 'cat-file', '-e', f'origin/art-vault:{rel}'],
                             cwd=work, capture_output=True).returncode == 0,
              'nothing reached the art-vault branch')

        # 2. THE PICTURE IS DESTROYED — a failed check, a cancelled job, a lost
        #    push. THE RE-RUN MUST NOT SPEND.
        original = target.read_bytes()
        target.unlink()
        calls.clear()
        ok = imagegen.generate('a hero', rel, **args)
        check('a re-run after the art is lost does NOT call the backend',
              len(calls) == 0, f'it spent again: calls={len(calls)}')
        check('a re-run reports success so the caller carries on', ok is True)
        check('the restored bytes are the picture that was paid for',
              target.exists() and target.read_bytes() == original)

        # 3. force MUST STILL BUY A NEW PICTURE. Sometimes new art is the point,
        #    and a cache that cannot be overridden is its own kind of broken.
        calls.clear()
        imagegen.generate('a hero', rel, force=True, **args)
        check('force=True bypasses the vault and generates fresh', len(calls) == 1,
              f'calls={len(calls)}')

        # 4. A FILE ALREADY ON DISK IS NEVER RE-BOUGHT EITHER.
        calls.clear()
        imagegen.generate('a hero', rel, **args)
        check('an existing local file is not re-generated', len(calls) == 0)

        # 5. PROVENANCE IS STILL RECORDED. verify_sheet.py reads it to catch two
        #    sheets of one character drawn by different models.
        man = work / 'games/g/art-src/generated.json'
        check('generated.json records what drew it',
              man.exists() and 'hero_raw.png' in json.loads(man.read_text()))

        # 6. THE VAULT LIVES ON AN ORPHAN BRANCH, so a raw pushed seconds after
        #    generation — before any checker has looked at it — cannot reach
        #    main, Pages, or any gate.
        parents = subprocess.run(['git', 'rev-list', '--count', 'origin/art-vault'],
                                 cwd=work, capture_output=True, text=True)
        main_sha = subprocess.run(['git', 'rev-parse', 'origin/main'],
                                  cwd=work, capture_output=True, text=True).stdout.strip()
        merge = subprocess.run(['git', 'merge-base', '--is-ancestor', main_sha, 'origin/art-vault'],
                               cwd=work, capture_output=True)
        check('the vault branch carries no project history', parents.stdout.strip() != '',
              'could not read art-vault')
        check('main is not an ancestor of the vault (it is an orphan)',
              merge.returncode != 0)

        # 7. A VAULT MISS MUST NOT BE FATAL. Nothing saved yet is the normal
        #    state of every first generation, and must never stop art being made.
        calls.clear()
        ok = imagegen.generate('a second thing', 'games/g/art-src/other_raw.png', **args)
        check('a vault miss still generates normally', len(calls) == 1 and ok is True)
    finally:
        os.chdir(cwd)
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    if FAILS:
        print(f'{len(FAILS)} FAILED: ' + ', '.join(FAILS))
        sys.exit(1)
    print('generation money-path OK — a lost picture is never bought twice, '
          'and force still buys a new one.')


if __name__ == '__main__':
    main()

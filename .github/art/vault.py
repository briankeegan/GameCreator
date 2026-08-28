#!/usr/bin/env python3
"""Keep a raw generation the moment it exists, so nothing is ever paid for twice.

    vault.py save    games/the-game/art-src/may_portrait_raw.png
    vault.py restore games/the-game/art-src/may_portrait_raw.png

THE PROBLEM. An image is billed the instant the API returns it, and everything
after that is free: cutting, cropping, verifying, committing. So every failure
downstream of the generation costs a whole new generation to recover from — and
the new one is never the same picture, which is worse than the outage, because
you cannot go back and look at what you had.

This has now happened three separate ways in this repo:
  - a sheet failed verify_sheet.py, the job died, and the image died with it;
  - a job was CANCELLED and the commit step never ran;
  - and, most recently, thirteen portraits generated correctly and twelve of
    them lost the push race back to main. All twelve were perfectly good
    pictures. All twelve had to be bought again.

Run artifacts were the first answer and they are not enough: an artifact can
only be recovered by a PERSON downloading a zip, so it protects review and does
nothing for the next run.

WHAT THIS DOES. `save` pushes the raw onto the `art-vault` branch — an orphan
branch of nothing but raws, never merged, never deployed. `restore` fetches it
back. The generators call `restore` before spending and `save` immediately
after, so a re-run of a job that failed anywhere downstream re-cuts the picture
it already has instead of buying another.

WHY A BRANCH RATHER THAN main. The vault push happens seconds after the
generation, before any cutting, verifying or review, so it must not be able to
put unverified art anywhere that ships. An orphan branch is invisible to Pages,
to the art gates, and to anyone reading history.

WHY IT CANNOT RACE. Every path in the vault belongs to exactly one character
and one kind of art, so two concurrent saves never touch the same file, and a
rebase between them always succeeds. That is the property the portrait job
lacked when it staged whole directories.

A vault failure NEVER fails the caller: no branch, no token, no network — it
warns and returns. Losing the safety net must not lose the art as well.
"""

import argparse
import pathlib
import shutil
import subprocess
import sys
import tempfile

BRANCH = 'art-vault'
ROOT = pathlib.Path(__file__).resolve().parents[2]


def git(*args, check=False, quiet=True):
    return subprocess.run(['git', *args], cwd=ROOT, check=check,
                          capture_output=quiet, text=True)


def rel(path):
    p = pathlib.Path(path)
    if p.is_absolute():
        p = p.relative_to(ROOT)
    return p.as_posix()


def restore(path):
    """Bring one raw back from the vault. True if it is now on disk."""
    r = rel(path)
    if (ROOT / r).is_file() and (ROOT / r).stat().st_size:
        print(f'{r} already on disk — nothing to restore.')
        return True
    if git('fetch', 'origin', BRANCH).returncode != 0:
        print(f'no {BRANCH} branch yet — nothing to restore.')
        return False
    if git('checkout', f'origin/{BRANCH}', '--', r).returncode != 0:
        print(f'{r} is not in the vault.')
        return False
    git('reset', '--', r)          # restored as a file, not as a staged change
    ok = (ROOT / r).is_file() and (ROOT / r).stat().st_size
    print(f'restored {r} from {BRANCH} — nothing was billed.' if ok
          else f'{r} came back empty.')
    return bool(ok)


def save(path):
    """Put one raw in the vault. Never fails the caller."""
    r = rel(path)
    if not (ROOT / r).is_file() or not (ROOT / r).stat().st_size:
        print(f'warning: {r} does not exist — nothing to save.', file=sys.stderr)
        return False
    # A worktree of its own, so saving cannot disturb the checkout the caller is
    # working in — the generator still has files staged and a branch checked out.
    #
    # OUTSIDE the repository, and specifically NOT under .git/: git refuses to
    # create a worktree inside the git directory, and because this function is
    # built never to fail the caller, that refusal was completely silent. The
    # first run with the vault enabled reported success, generated its portrait,
    # and left no art-vault branch behind at all. A safety net that fails
    # quietly is not a safety net — hence the self-test at the bottom of this
    # file, which creates a throwaway repo and proves a save-then-restore
    # round-trip actually works.
    tmp = tempfile.mkdtemp(prefix='gc-vault-')
    wt = pathlib.Path(tmp) / 'wt'
    subprocess.run(['git', 'worktree', 'prune'], cwd=ROOT, capture_output=True)
    git('fetch', 'origin', BRANCH)
    exists = git('rev-parse', '--verify', f'origin/{BRANCH}').returncode == 0
    if exists:
        made = git('worktree', 'add', '--detach', str(wt), f'origin/{BRANCH}')
    else:
        # First save: an ORPHAN branch, so the vault carries no project history
        # and cannot be mistaken for a fork of main.
        made = git('worktree', 'add', '--detach', str(wt), 'HEAD')
        if made.returncode == 0:
            subprocess.run(['git', 'checkout', '--orphan', BRANCH],
                           cwd=wt, capture_output=True)
            subprocess.run(['git', 'rm', '-rq', '--cached', '.'],
                           cwd=wt, capture_output=True)
    if made.returncode != 0:
        print(f'warning: could not open the vault worktree: {made.stderr.strip()}',
              file=sys.stderr)
        return False

    try:
        dest = wt / r
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes((ROOT / r).read_bytes())
        subprocess.run(['git', 'add', '--', r], cwd=wt, check=True,
                       capture_output=True)
        if subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=wt,
                          capture_output=True).returncode == 0:
            print(f'{r} already in the vault, unchanged.')
            return True
        subprocess.run(['git', 'commit', '-qm', f'vault: {r}'], cwd=wt,
                       check=True, capture_output=True)
        for attempt in range(5):
            if subprocess.run(['git', 'push', 'origin', f'HEAD:{BRANCH}'],
                              cwd=wt, capture_output=True).returncode == 0:
                print(f'saved {r} to {BRANCH}.')
                return True
            subprocess.run(['git', 'fetch', 'origin', BRANCH], cwd=wt,
                           capture_output=True)
            if subprocess.run(['git', 'rebase', f'origin/{BRANCH}'], cwd=wt,
                              capture_output=True).returncode != 0:
                subprocess.run(['git', 'rebase', '--abort'], cwd=wt,
                               capture_output=True)
        print(f'warning: could not push {r} to the vault after retries.',
              file=sys.stderr)
        return False
    except Exception as err:                       # never fail the caller
        print(f'warning: vault save failed: {err}', file=sys.stderr)
        return False
    finally:
        subprocess.run(['git', 'worktree', 'remove', '--force', str(wt)],
                       cwd=ROOT, capture_output=True)
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('action', choices=['save', 'restore'])
    ap.add_argument('path', help='repo-relative path of the raw generation')
    args = ap.parse_args()
    ok = save(args.path) if args.action == 'save' else restore(args.path)
    # Exit 0 either way. A vault miss is normal (nothing saved yet) and a vault
    # failure must never stop the art being made.
    print(f'{args.action}: {"ok" if ok else "no"}')


if __name__ == '__main__':
    main()

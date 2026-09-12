# Helper for chips.test.sh: copy verify_chips.js with one exact substitution,
# so a test can put a fixed staging bug back. Kept as a file because the
# strings involved contain the characters every sed delimiter wants.
import io, sys
src, dst, old, new = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
s = io.open(src, encoding='utf-8').read()
if old not in s:
    sys.stderr.write('chipbreak: anchor not found, the test is stale:\n  ' + old + '\n')
    sys.exit(2)
io.open(dst, 'w', encoding='utf-8').write(s.replace(old, new, 1))

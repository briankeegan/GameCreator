// RECOVER A CHECKPOINT WHOSE FILENAME MOVED OUT FROM UNDER IT.
//
// train.js hashes the run's fingerprint into the checkpoint filename, so a
// run finds its own resume point and nothing else's. The consequence nobody
// thought about until it happened: CHANGING HOW THE FINGERPRINT IS SPELLED
// RENAMES EVERY EXISTING CHECKPOINT OUT OF EXISTENCE. The file is still
// there, still committed, still holding a whole population — it just is not
// at the name the run now looks under, so the run opens a brand new search
// at generation 0 and reports nothing wrong, because as far as it can tell
// nothing is.
//
// That is what happened on 2026-09-16 when OBJECTIVE and ALLOW_RAISE were
// added INTO the middle of the list instead of appended: an empty element
// still contributes its separator, 'a|b' became 'a||b', and every run's
// filename moved. train.js was fixed the same day (the base list is frozen
// now, new fields append and only when they are on) — but the fix only
// stops it happening again. It does not carry the stranded populations
// across, and five runs' worth were sitting in files nothing would ever
// open again.
//
// So: this reads every checkpoint in the directory, works out what its
// config WOULD hash to under the current spelling, and writes it there.
// Three historical spellings are understood — the original, and the two
// broken ones — because a checkpoint records its own fingerprint inside the
// file, which is enough to recover the config from any of them.
//
// IT NEVER LOWERS A GENERATION. The runs are live while this runs: a job
// holds its population in memory and snapshots every 30 generations, so a
// target file can be AHEAD of the orphan by the time this executes.
// Overwriting it would throw away more than it recovered. A target at or
// past the orphan's generation is left exactly alone.
//
// Dry run by default; --apply writes.

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var DIR = __dirname;

// The three spellings, reduced to the config they all describe.
//
//   original  cem|EF|GENS|POP|MODE|BRAIN|TRAINED|LEVEL|SEED|DEPTH|BEAM|
//             rise?|density?|SEEDS|KEYS
//   broken A  ...|TRAINED|OBJECTIVE|LEVEL|... plus an empty allowRaise slot
//   broken B  ...as A, with the slot filled in as 'allowRaise'
//   current   original, then 'objective=X' and 'allowRaise' APPENDED, each
//             only when it is not the default
//
// Fields 0..10 never moved, and KEYS is always last before the appended
// tail, so the only ambiguity is the flags between BEAM and SEEDS — and
// those are recognised by value ('rise', 'density'), not by position.
function parse(fingerprint) {
    var p = String(fingerprint).split('|');
    var objective = 'score', allowRaise = false;

    while (p.length && (p[p.length - 1] === 'allowRaise' ||
                        /^objective=/.test(p[p.length - 1]))) {
        var tail = p.pop();
        if (tail === 'allowRaise') allowRaise = true;
        else objective = tail.slice('objective='.length);
    }
    if (p[7] === 'score' || p[7] === 'survival') { objective = p[7]; p.splice(7, 1); }
    var mid = p.indexOf('allowRaise');
    if (mid > 10) { allowRaise = true; p.splice(mid, 1); }

    var flags = p.slice(11, p.length - 2);
    return {
        head: p.slice(0, 11),                 // cem .. BEAM
        rise: flags.indexOf('rise') !== -1,
        density: flags.indexOf('density') !== -1,
        seeds: p[p.length - 2],
        keys: p[p.length - 1],
        objective: objective,
        allowRaise: allowRaise
    };
}

// The current spelling, and the only place in this file that knows it.
// Kept identical to train.js's fingerprint() by migrate.test.js, which asks
// train.js itself rather than trusting this copy.
function spell(cfg) {
    var fp = cfg.head.concat([cfg.rise ? 'rise' : '', cfg.density ? 'density' : '',
                              cfg.seeds, cfg.keys]);
    if (cfg.objective !== 'score') fp.push('objective=' + cfg.objective);
    if (cfg.allowRaise) fp.push('allowRaise');
    return fp.join('|');
}

function nameFor(mode, fingerprint) {
    var tag = crypto.createHash('sha1').update(fingerprint).digest('hex').slice(0, 10);
    return '.train-checkpoint.' + mode + '.' + tag + '.json';
}

function plan(dir) {
    var out = [];
    fs.readdirSync(dir).forEach(function (f) {
        var m = /^\.train-checkpoint\.([^.]+)\.[0-9a-f]{10}\.json$/.exec(f);
        if (!m) return;
        var ck;
        try { ck = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
        catch (e) { out.push({ file: f, verdict: 'unreadable', detail: e.message }); return; }
        if (!ck.fingerprint) { out.push({ file: f, verdict: 'unreadable', detail: 'no fingerprint' }); return; }

        var want = spell(parse(ck.fingerprint));
        var target = nameFor(m[1], want);
        if (target === f) { out.push({ file: f, verdict: 'current', generation: ck.generation }); return; }

        var entry = { file: f, target: target, generation: ck.generation,
                      fingerprint: want, verdict: 'migrate' };
        if (fs.existsSync(path.join(dir, target))) {
            var at;
            try { at = JSON.parse(fs.readFileSync(path.join(dir, target), 'utf8')).generation; }
            catch (e) { at = -1; }
            entry.targetGeneration = at;
            // The live run wins ties. Equal generations mean the same work,
            // and replacing it buys nothing while risking everything.
            if (at >= ck.generation) entry.verdict = 'behind';
        }
        out.push(entry);
    });
    return out;
}

function apply(dir, entries) {
    entries.filter(function (e) { return e.verdict === 'migrate'; }).forEach(function (e) {
        var ck = JSON.parse(fs.readFileSync(path.join(dir, e.file), 'utf8'));
        ck.fingerprint = e.fingerprint;
        var tmp = path.join(dir, e.target + '.tmp');
        fs.writeFileSync(tmp, JSON.stringify(ck));
        fs.renameSync(tmp, path.join(dir, e.target));   // atomic, same reason train.js does it
    });
}

module.exports = { parse: parse, spell: spell, nameFor: nameFor, plan: plan, apply: apply };

if (require.main === module) {
    var dir = process.argv.indexOf('--dir') !== -1 ? process.argv[process.argv.indexOf('--dir') + 1] : DIR;
    var entries = plan(dir);
    var doIt = process.argv.indexOf('--apply') !== -1;
    entries.sort(function (a, b) { return a.verdict.localeCompare(b.verdict); });
    entries.forEach(function (e) {
        if (e.verdict === 'current') return;
        if (e.verdict === 'unreadable') { console.log('?? ' + e.file + ' — ' + e.detail); return; }
        if (e.verdict === 'behind') {
            console.log('   ' + e.file + ' gen ' + e.generation + ' — target already at ' +
                        e.targetGeneration + ', left alone');
            return;
        }
        console.log((doIt ? '-> ' : '   would ') + e.file + ' gen ' + e.generation +
                    ' -> ' + e.target +
                    (e.targetGeneration === undefined ? ' (new)' : ' (was gen ' + e.targetGeneration + ')'));
    });
    var n = entries.filter(function (e) { return e.verdict === 'migrate'; }).length;
    if (doIt) { apply(dir, entries); console.log(n + ' recovered'); return; }

    // THE GATE. A stranded population is invisible by construction — the run
    // that lost it opens a new search and says nothing — so the only moment
    // anyone can be told is the push that changed the spelling. --check makes
    // that push go red instead of quietly costing a day of generations.
    if (process.argv.indexOf('--check') !== -1) {
        if (n === 0) { console.log('no stranded checkpoints'); return; }
        console.log('\n' + n + ' checkpoint(s) hold a population at a name no run will open.');
        console.log('The fingerprint spelling changed. Recover them before this ships:');
        console.log('  node games/the-game/ai/eval/migrate_checkpoints.js --apply');
        process.exit(1);
    }
    console.log(n + ' recoverable — re-run with --apply');
}

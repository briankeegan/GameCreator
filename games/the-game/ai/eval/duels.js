// FAN A LIST OF DUELS ACROSS CORES.
//
//   runDuels(jobs, opts, shards, cb[, testHooks])
//     jobs   [{ a: weights, b: weights, seed }]
//     cb     (err, results) — results in THE SAME ORDER as jobs
//
// The face-off and the held-out check are about 42 duels a leg and both ran
// one at a time in the parent, while the island workers that had just
// finished sat idle. They are independent duels decided up front, so they
// shard.
//
// ORDER IS THE CONTRACT. The caller matches a result to its job by index —
// the face-off tallies wins per champion that way, and the face-off decides
// which island is snapshotted and whose weights migrate. Results are placed
// back at their original index, never appended as they complete.
//
// A SHORT RESULT IS AN ERROR, NEVER A TALLY. If a shard dies, the face-off
// must not quietly crown whoever happened to come back; the callback gets an
// error and the leg fails loudly.
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

function runDuels(jobs, opts, shards, cb, hooks) {
    if (!jobs || !jobs.length) return cb(null, []);
    hooks = hooks || {};
    var worker = hooks.forceWorker || path.join(__dirname, 'duel_worker.js');
    var n = Math.max(1, Math.min(shards || 1, jobs.length));
    var results = new Array(jobs.length);
    var left = n, failed = null;
    var stamp = process.pid + '.' + Date.now() + '.' + Math.floor(Math.random() * 1e6);

    for (var s = 0; s < n; s++) {
        (function (s) {
            // Round-robin, so every shard gets a comparable mix rather than
            // one shard drawing all the long games.
            var idx = [], mine = [];
            for (var j = s; j < jobs.length; j += n) { idx.push(j); mine.push(jobs[j]); }

            // Scratch files live beside this module, never os.tmpdir().
            var jf = path.join(__dirname, '.duels.' + stamp + '.' + s + '.in.json');
            var of = path.join(__dirname, '.duels.' + stamp + '.' + s + '.out.json');
            function scrub() {
                try { fs.unlinkSync(jf); } catch (e) { /* already gone */ }
                try { fs.unlinkSync(of); } catch (e) { /* already gone */ }
            }

            try {
                fs.writeFileSync(jf, JSON.stringify(mine));
            } catch (e) {
                failed = failed || ('duel shard ' + s + ' could not be written: ' + e.message);
                if (--left === 0) cb(failed, results);
                return;
            }

            var env = {};
            for (var k in process.env) if (process.env.hasOwnProperty(k)) env[k] = process.env[k];
            env.GC_DUEL_OPTS = JSON.stringify(opts || {});

            var child = cp.fork(worker, [jf, of], { env: env, silent: false });
            child.on('error', function (e) {
                failed = failed || ('duel shard ' + s + ' failed to start: ' + e.message);
            });
            child.on('exit', function (code) {
                if (code !== 0) {
                    failed = failed || ('duel shard ' + s + ' exited ' + code);
                } else {
                    try {
                        var got = JSON.parse(fs.readFileSync(of, 'utf8'));
                        if (got.length !== idx.length) {
                            failed = failed || ('duel shard ' + s + ' returned ' + got.length +
                                                ' of ' + idx.length + ' duels');
                        } else {
                            for (var q = 0; q < idx.length; q++) results[idx[q]] = got[q];
                        }
                    } catch (e) {
                        failed = failed || ('duel shard ' + s + ' result unreadable: ' + e.message);
                    }
                }
                scrub();
                if (--left === 0) cb(failed, results);
            });
        })(s);
    }
}

module.exports = { runDuels: runDuels };

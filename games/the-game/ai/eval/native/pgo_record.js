// node pgo_record.js OUT.bin DRILL SEED FRAMES: plays a pa_drill and writes every decision's inputs.
var fs = require('fs'), path = require('path');
var out = process.argv[2], nat = require(path.join(__dirname, '..', 'bitnative.js'));
nat.record(true);
process.argv.splice(2, 1);
process.on('exit', function () {
  var recs = nat.recorded(), parts = [], h = Buffer.alloc(4);
  h.writeInt32LE(recs.length); parts.push(h);
  recs.forEach(function (r) { r.forEach(function (b) { var l = Buffer.alloc(4); l.writeInt32LE(b.length); parts.push(l, Buffer.from(b)); }); });
  fs.writeFileSync(out, Buffer.concat(parts));
});
require(path.join(__dirname, '..', 'pa_drill.js'));

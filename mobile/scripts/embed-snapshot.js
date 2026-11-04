// Copies src/snapshot.js into the iPhone widget as a Swift string, so the widget works things out with the same code.
// Run: npm run embed (after changing src/snapshot.js). `--check` only fails if the copy is out of date.
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src', 'snapshot.js'), 'utf8').replace(/\r\n/g, '\n');
const OUT = path.join(ROOT, 'targets', 'widget', 'SnapshotSource.swift');
if (src.includes('"""#') || src.includes('\\#')) throw new Error('src/snapshot.js has """# or \\# in it, which would end the Swift raw string');
const swift = '// Made by scripts/embed-snapshot.js from src/snapshot.js. Don’t edit it here: change that file and run `npm run embed`.\n'
  + 'let snapshotSource = #"""\n' + src + '"""#\n';

if (process.argv.includes('--check')) {
  const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (now !== swift) { console.error('targets/widget/SnapshotSource.swift is out of date: run npm run embed'); process.exit(1); }
  console.log('SnapshotSource.swift matches src/snapshot.js');
} else {
  fs.writeFileSync(OUT, swift);
  console.log('Wrote ' + path.relative(ROOT, OUT));
}

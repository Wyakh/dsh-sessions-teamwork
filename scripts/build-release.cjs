'use strict';
// Dependency-free, deterministic npm-compatible ustar/gzip archive. No install hooks or network.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { gzipSync, gunzipSync } = require('node:zlib');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const checkOnly = process.argv.includes('--check');
assert(process.argv.slice(2).every(arg => arg === '--check'), 'Only --check is supported.');
assert.equal(manifest.version, '0.6.0');
assert.equal(manifest.license, 'MIT');
assert.equal(manifest.engines.dsh, '0.2.2-rc.5');
assert(!manifest.scripts && !manifest.dependencies && !manifest.optionalDependencies, 'No lifecycle scripts or private dependency tree.');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const selected = new Set(['package.json', 'LICENSE', 'README.md']);
for (const entry of manifest.files) {
  assert(!entry.includes('..') && !entry.includes('\\') && !path.isAbsolute(entry), 'Unsafe files entry.');
  if (entry === 'locale/*.json') for (const name of fs.readdirSync(path.join(root, 'locale')).sort()) { if (name.endsWith('.json')) selected.add('locale/' + name); }
  else { assert(!entry.includes('*'), 'Unsupported files wildcard.'); selected.add(entry); }
}
const files = [...selected].sort();
const forbiddenPath = /(?:^|\/)(?:\.git|\.local-dev|node_modules|tests|scripts|release|\.env)(?:\/|$)|(?:AGENTS|CLAUDE)\.md$/i;
const privateText = /[A-Z]:[\\/]Users[\\/][^\s<>"']+|\/(?:home|Users)\/[A-Za-z0-9_.-]+\/|-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----|\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9_-]{24,}|session-[0-9a-f]{8}-[0-9a-f-]{20,}/i;
const records = files.map(name => {
  assert(!forbiddenPath.test(name), 'Private/development path in archive: ' + name);
  const target = path.join(root, name), actual = fs.realpathSync(target), relative = path.relative(fs.realpathSync(root), actual);
  assert(!relative.startsWith('..') && !path.isAbsolute(relative), 'Source escapes repository.');
  assert(fs.lstatSync(target).isFile(), 'Only regular files may be packed.');
  const bytes = fs.readFileSync(target);
  // .gitattributes preserves exact bytes, including the tested runtime's historical line endings.
  assert(!privateText.test(bytes.toString('utf8')), 'Potential private content; inspect before publication: ' + name);
  return { name, bytes, sha256: sha(bytes) };
});
// Fixed uid/gid/mode/mtime; simple ASCII paths all fit the ustar name field.
function tarEntry(name, bytes) {
  const header = Buffer.alloc(512);
  assert(Buffer.byteLength(name) < 100, 'Archive name too long.');
  header.write(name, 0, 100, 'utf8');
  const octal = (value, offset, size) => { const valueText = value.toString(8).padStart(size - 1, '0') + '\0'; assert.equal(valueText.length, size); header.write(valueText, offset, size, 'ascii'); };
  octal(0o644, 100, 8); octal(0, 108, 8); octal(0, 116, 8); octal(bytes.length, 124, 12); octal(0, 136, 12);
  header.fill(32, 148, 156); header[156] = 48;
  header.write('ustar\0', 257, 6, 'ascii'); header.write('00', 263, 2, 'ascii');
  const sum = header.reduce((a, n) => a + n, 0);
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]);
}
const tar = Buffer.concat([...records.map(record => tarEntry('package/' + record.name, record.bytes)), Buffer.alloc(1024)]);
const archive = gzipSync(tar, { level: 9 });
assert.deepEqual(gunzipSync(archive), tar);
const archiveName = 'session-coordination-' + manifest.version + '.tgz';
const inventory = {
  package: manifest.name, version: manifest.version, license: manifest.license, dsh: manifest.engines.dsh,
  archive: archiveName, sha256: sha(archive), bytes: archive.length, format: 'npm-compatible ustar+gzip',
  files: records.map(({ name, bytes, sha256 }) => ({ path: name, bytes: bytes.length, sha256 })),
};
const outputs = [[archiveName, archive], ['manifest.json', Buffer.from(JSON.stringify(inventory, null, 2) + '\n')], ['SHA256SUMS', Buffer.from(inventory.sha256 + '  ' + archiveName + '\n')]];
const out = path.join(root, 'release');
if (!checkOnly) fs.mkdirSync(out, { recursive: true });
for (const [name, bytes] of outputs) {
  const target = path.join(out, name);
  if (checkOnly) assert.deepEqual(fs.readFileSync(target), bytes, 'Stale release output: ' + name);
  else fs.writeFileSync(target, bytes);
}
console.log(JSON.stringify({ checked: checkOnly, package: manifest.name, version: manifest.version, files: files.length, bytes: archive.length, sha256: inventory.sha256 }));

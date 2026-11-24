'use strict';
// Repository-relative paths only; generated data never belongs to the active DSH profile.
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const runtime = path.join(__dirname, '.runtime');
const results = path.join(__dirname, '.results');
function resultPath(suite) { fs.mkdirSync(results, { recursive: true }); return path.join(results, suite + '.json'); }
function ownedMutation(relative) { const value = relative.split(path.sep).join('/'); return value === 'tests/.runtime' || value === 'tests/.results' || value.startsWith('tests/.runtime/') || value.startsWith('tests/.results/'); }
module.exports = { root, runtime, results, resultPath, ownedMutation };

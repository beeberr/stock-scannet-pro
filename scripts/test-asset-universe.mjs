import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/assetUniverse.ts', import.meta.url), 'utf8');
const rows = [...source.matchAll(/^\s*\['([^']+)',\s*'[^']+',\s*'([^']+)',\s*'[^']+'\],?$/gm)];
const symbols = rows.map(([, symbol]) => symbol);
const categories = rows.map(([, , category]) => category);

assert.equal(rows.length, 45, 'Expected 45 configured assets plus five reserved slots.');
assert.equal(new Set(symbols).size, rows.length, 'Asset symbols must be unique.');
assert.ok(rows.length <= 50, 'Configured assets must never exceed the hard cap of 50.');
for (const [category, expected] of [['מניה', 20], ['סחורה', 8], ['מדד', 8], ['קרן סל', 9]]) {
  assert.equal(categories.filter(value => value === category).length, expected, `Unexpected count for ${category}`);
}
const connectedBlock = source.match(/CURRENTLY_CONNECTED_SYMBOLS\s*=\s*\[([^\]]+)\]/);
assert.ok(connectedBlock, 'Connected-symbol declaration must exist.');
const connected = [...connectedBlock[1].matchAll(/'([^']+)'/g)].map(([, symbol]) => symbol);
for (const symbol of connected) assert.ok(symbols.includes(symbol), `${symbol} must exist in the configured universe.`);
assert.equal(connected.length, 8, 'Only the eight currently integrated symbols are marked connected.');
console.log('PASS asset universe: 45 configured, five reserved, maximum 50, unique symbols and source coverage verified.');

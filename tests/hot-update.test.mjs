import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const scriptUrl = new URL('../scripts/hot-update.ps1', import.meta.url);

test('hot update script is exposed through package scripts', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

  assert.equal(packageJson.scripts['hot:update'], 'powershell -ExecutionPolicy Bypass -File scripts/hot-update.ps1');
  assert.equal(packageJson.scripts['hot:update:dry'], 'powershell -ExecutionPolicy Bypass -File scripts/hot-update.ps1 -DryRun');
});

test('hot update script syncs TT install without requiring git publish', () => {
  assert.equal(existsSync(scriptUrl), true);
  const script = readFileSync(scriptUrl, 'utf8');

  assert.match(script, /tauritavern-runtime\.json/);
  assert.match(script, /default-user[\\/]extensions[\\/]TT-Agent-Plus-777727/);
  assert.match(script, /TT-Agent-Plus-727/);
  assert.match(script, /-DryRun/);
  assert.match(script, /-Prune/);
  assert.match(script, /'scripts'/);
  assert.doesNotMatch(script, /git\s+(commit|push|pull)/i);
});

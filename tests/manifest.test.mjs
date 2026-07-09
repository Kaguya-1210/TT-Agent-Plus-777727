import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('manifest exposes one ST extension entrypoint', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

  assert.equal(manifest.display_name, 'TT-Agent-Plus-727');
  assert.equal(manifest.js, 'index.js');
  assert.equal(manifest.css, 'style.css');
  assert.equal(manifest.homePage, 'https://github.com/Kaguya-1210/TT-Agent-Plus-777727');
});

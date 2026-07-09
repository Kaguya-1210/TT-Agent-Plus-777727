import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

test('manifest exposes one ST extension entrypoint', async () => {
  const manifest = await readJson('../manifest.json');

  assert.equal(manifest.display_name, 'TT-Agent-Plus-727');
  assert.equal(manifest.js, 'index.js');
  assert.equal(manifest.css, 'style.css');
  assert.equal(manifest.homePage, 'https://github.com/Kaguya-1210/TT-Agent-Plus-777727');
});

test('manifest referenced extension assets exist', async () => {
  const manifest = await readJson('../manifest.json');

  await access(new URL(`../${manifest.js}`, import.meta.url));
  await access(new URL(`../${manifest.css}`, import.meta.url));
});

test('package scripts use the node test runner on tests', async () => {
  const packageJson = await readJson('../package.json');

  assert.equal(packageJson.scripts.test, 'node --test tests');
  assert.equal(packageJson.scripts.check, 'node --test tests');
});

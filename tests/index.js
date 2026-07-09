import { readdir } from 'node:fs/promises';

const testsDirectory = new URL('.', import.meta.url);
const testFiles = (await readdir(testsDirectory))
  .filter((file) => file.endsWith('.test.mjs'))
  .sort();

await Promise.all(testFiles.map((file) => import(new URL(file, testsDirectory).href)));

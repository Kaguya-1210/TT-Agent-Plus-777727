import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCharacterWorldInfoRepository,
  createStWorldInfoLoader
} from '../src/characterWorldInfo.js';

function character(data, overrides = {}) {
  return {
    name: 'Mira',
    avatar: 'mira.png',
    data,
    ...overrides
  };
}

test('prefers an embedded character book without loading its named world', async () => {
  let loadCalls = 0;
  const repository = createCharacterWorldInfoRepository({
    getContext: () => ({
      characterId: 0,
      characters: [character({
        character_book: {
          name: 'Mira lore',
          entries: [{ uid: 1, comment: 'Origin', content: '  A traveller.  ' }]
        },
        extensions: { world: 'Should not load' }
      })]
    }),
    loadWorldInfo: async () => {
      loadCalls += 1;
      return { entries: [] };
    }
  });

  assert.deepEqual(await repository.readActive(), {
    characterRef: 'character:mira.png',
    characterName: 'Mira',
    worldRef: 'embedded:character:mira.png',
    worldName: 'Mira lore',
    entries: [{
      uid: '1',
      displayName: 'Origin',
      content: 'A traveller.',
      disabled: false,
      constant: false
    }]
  });
  assert.equal(loadCalls, 0);
});

test('treats an embedded book with empty entries as active', async () => {
  let loadCalls = 0;
  const repository = createCharacterWorldInfoRepository({
    getContext: () => ({
      characters: [character({
        character_book: { entries: [] },
        extensions: { world: 'Named lore' }
      })]
    }),
    loadWorldInfo: async () => {
      loadCalls += 1;
      return { entries: [{ uid: 1 }] };
    }
  });

  const catalog = await repository.readActive();

  assert.equal(catalog.worldName, 'Mira世界书');
  assert.equal(catalog.worldRef, 'embedded:character:mira.png');
  assert.deepEqual(catalog.entries, []);
  assert.equal(loadCalls, 0);
});

test('loads a named character world book when no embedded book exists', async () => {
  let requestedName = '';
  const repository = createCharacterWorldInfoRepository({
    getContext: () => ({
      characters: [character({ extensions: { world: '  Named lore  ' } })]
    }),
    loadWorldInfo: async (name) => {
      requestedName = name;
      return { entries: [{ id: 7, key: 'Fact', content: '  retained  ', enabled: false }] };
    }
  });

  assert.deepEqual(await repository.readActive(), {
    characterRef: 'character:mira.png',
    characterName: 'Mira',
    worldRef: 'named:Named lore',
    worldName: 'Named lore',
    entries: [{
      uid: '7',
      displayName: 'Fact',
      content: 'retained',
      disabled: true,
      constant: false
    }]
  });
  assert.equal(requestedName, 'Named lore');
});

test('keeps the named-world identity when its loader is unavailable', async () => {
  const repository = createCharacterWorldInfoRepository({
    getContext: () => ({
      characters: [character({ extensions: { world: 'Named lore' } })]
    })
  });

  assert.deepEqual(await repository.readActive(), {
    characterRef: 'character:mira.png',
    characterName: 'Mira',
    worldRef: 'named:Named lore',
    worldName: 'Named lore',
    entries: []
  });
});

test('returns an empty catalog when the active character has no bound world', async () => {
  const repository = createCharacterWorldInfoRepository({
    getContext: () => ({ characters: [character({ extensions: { world: '   ' } })] })
  });

  assert.deepEqual(await repository.readActive(), {
    characterRef: 'character:mira.png',
    characterName: 'Mira',
    worldRef: '',
    worldName: '',
    entries: []
  });
});

test('uses characterId then this_chid and builds references from avatar or id', async () => {
  const characters = [
    character({ extensions: {} }, { name: 'First', avatar: '' }),
    character({ extensions: {} }, { name: 'Second', avatar: 'second.png' })
  ];
  const byCharacterId = createCharacterWorldInfoRepository({
    getContext: () => ({ characterId: 1, this_chid: 0, characters })
  });
  const byThisChid = createCharacterWorldInfoRepository({
    getContext: () => ({ this_chid: 0, characters })
  });

  assert.equal((await byCharacterId.readActive()).characterRef, 'character:second.png');
  assert.equal((await byThisChid.readActive()).characterRef, 'character:0');
  assert.equal((await byThisChid.readActive()).characterName, 'First');
});

test('normalizes array and object world book entries into fresh objects', async () => {
  const arrayEntry = { uid: 1, name: 'Array', content: 'one' };
  const objectEntry = { uid: 2, key: ['Alpha', 3, {}, Infinity], content: 'two', constant: true };
  let activeEntries = [arrayEntry];
  const repository = createCharacterWorldInfoRepository({
    getContext: () => ({
      characters: [character({ character_book: { entries: activeEntries } })]
    })
  });

  assert.deepEqual((await repository.readActive()).entries, [{
    uid: '1', displayName: 'Array', content: 'one', disabled: false, constant: false
  }]);
  activeEntries = { alpha: objectEntry };
  assert.deepEqual((await repository.readActive()).entries, [{
    uid: '2', displayName: 'Alpha, 3', content: 'two', disabled: false, constant: true
  }]);
  assert.notEqual((await repository.readActive()).entries[0], objectEntry);
});

test('skips invalid UIDs without calling object stringification', async () => {
  const throwingUid = {
    toString() {
      throw new Error('must not stringify object uid');
    }
  };
  const repository = createCharacterWorldInfoRepository({
    getContext: () => ({
      characters: [character({
        character_book: {
          entries: [
            { uid: throwingUid, content: 'unsafe' },
            { uid: '', id: 9, content: 'fallback id' },
            { uid: NaN, content: 'invalid number' },
            { uid: 4, displayName: 'Valid', content: 'kept' }
          ]
        }
      })]
    })
  });

  assert.deepEqual((await repository.readActive()).entries, [{
    uid: '4', displayName: 'Valid', content: 'kept', disabled: false, constant: false
  }]);
});

test('formats only safe key-array parts and falls back to the UID label', async () => {
  const repository = createCharacterWorldInfoRepository({
    getContext: () => ({
      characters: [character({
        character_book: {
          entries: [
            { uid: 1, key: ['Alpha', 2, {}, NaN, Infinity], content: 'keyed' },
            { uid: 2, key: [], content: 'unnamed', disable: true, enabled: true, constant: true }
          ]
        }
      })]
    })
  });

  assert.deepEqual((await repository.readActive()).entries, [
    { uid: '1', displayName: 'Alpha, 2', content: 'keyed', disabled: false, constant: false },
    { uid: '2', displayName: '条目 2', content: 'unnamed', disabled: true, constant: true }
  ]);
});

test('falls back to an empty context when getContext throws', async () => {
  const repository = createCharacterWorldInfoRepository({
    getContext: () => {
      throw new Error('host unavailable');
    }
  });

  assert.deepEqual(await repository.readActive(), {
    characterRef: 'character:0',
    characterName: '当前角色',
    worldRef: '',
    worldName: '',
    entries: []
  });
});

test('ST loader posts the requested world name with host headers', async () => {
  const requests = [];
  const loader = createStWorldInfoLoader({
    getContext: () => ({ getRequestHeaders: () => ({ Authorization: 'Bearer token' }) }),
    fetchFn: async (...args) => {
      requests.push(args);
      return { ok: true, json: async () => ({ entries: [] }) };
    }
  });

  const result = await loader('  Named lore  ');

  assert.deepEqual(result, { entries: [] });
  assert.deepEqual(requests, [[
    '/api/worldinfo/get',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer token' },
      body: JSON.stringify({ name: 'Named lore' })
    }
  ]]);
});

test('ST loader uses JSON headers after a host header error', async () => {
  let headers;
  const loader = createStWorldInfoLoader({
    getContext: () => ({
      getRequestHeaders() {
        throw new Error('header hook failed');
      }
    }),
    fetchFn: async (_url, options) => {
      headers = options.headers;
      return { ok: true, json: async () => ({}) };
    }
  });

  await loader('Lore');

  assert.deepEqual(headers, { 'Content-Type': 'application/json' });
});

test('ST loader reports unavailable fetch, invalid names, failed responses, and invalid JSON', async () => {
  const unavailable = createStWorldInfoLoader();
  await assert.rejects(() => unavailable('Lore'), /宿主 fetch 不可用/);

  const invalidName = createStWorldInfoLoader({ fetchFn: async () => ({}) });
  await assert.rejects(() => invalidName('  '), /世界书名称不能为空/);

  const failedResponse = createStWorldInfoLoader({
    fetchFn: async () => ({ ok: false, status: 503 })
  });
  await assert.rejects(() => failedResponse('Lore'), /读取角色世界书失败: 503/);

  const missingJson = createStWorldInfoLoader({
    fetchFn: async () => ({ ok: true })
  });
  await assert.rejects(() => missingJson('Lore'), /角色世界书响应无效/);

  const invalidJson = createStWorldInfoLoader({
    fetchFn: async () => ({ ok: true, json: async () => null })
  });
  await assert.rejects(() => invalidJson('Lore'), /角色世界书响应无效/);
});

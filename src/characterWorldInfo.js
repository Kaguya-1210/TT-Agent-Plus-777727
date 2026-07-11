export function createCharacterWorldInfoRepository({ getContext, loadWorldInfo } = {}) {
  return {
    async readActive() {
      const context = safeGetContext(getContext);
      const characterId = activeCharacterId(context);
      const character = characterAt(context.characters, characterId);
      const characterName = nonEmptyString(character?.name, '当前角色');
      const characterRef = activeCharacterRef(character, characterId);
      const data = isRecord(character?.data) ? character.data : {};
      const embeddedBook = isRecord(data.character_book) ? data.character_book : null;

      if (embeddedBook) {
        return {
          characterRef,
          characterName,
          worldRef: `embedded:${characterRef}`,
          worldName: nonEmptyString(embeddedBook.name, `${characterName}世界书`),
          entries: normalizeEntries(embeddedBook.entries)
        };
      }

      const worldName = nonEmptyString(data.extensions?.world, '');
      if (!worldName) {
        return emptyCatalog(characterRef, characterName);
      }

      const catalog = {
        characterRef,
        characterName,
        worldRef: `named:${worldName}`,
        worldName,
        entries: []
      };
      if (typeof loadWorldInfo !== 'function') return catalog;

      const book = await loadWorldInfo(worldName);
      return { ...catalog, entries: normalizeEntries(book?.entries) };
    }
  };
}

export function createStWorldInfoLoader({ fetchFn, getContext } = {}) {
  return async (name) => {
    if (typeof fetchFn !== 'function') throw new Error('宿主 fetch 不可用');

    const worldName = nonEmptyString(name, '');
    if (!worldName) throw new Error('世界书名称不能为空');

    const response = await fetchFn('/api/worldinfo/get', {
      method: 'POST',
      headers: requestHeaders(safeGetContext(getContext)),
      body: JSON.stringify({ name: worldName })
    });
    if (response?.ok !== true) {
      throw new Error(`读取角色世界书失败: ${response?.status}`);
    }
    if (typeof response.json !== 'function') {
      throw new Error('角色世界书响应无效');
    }

    const book = await response.json();
    if (!isRecord(book)) throw new Error('角色世界书响应无效');
    return book;
  };
}

function safeGetContext(getContext) {
  if (typeof getContext !== 'function') return {};
  try {
    const context = getContext();
    return isRecord(context) ? context : {};
  } catch {
    return {};
  }
}

function activeCharacterId(context) {
  return validCharacterId(context.characterId)
    ?? validCharacterId(context.this_chid)
    ?? 0;
}

function validCharacterId(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function characterAt(characters, characterId) {
  if (!characters || (typeof characters !== 'object' && typeof characters !== 'function')) return {};
  try {
    const character = characters[characterId];
    return isRecord(character) ? character : {};
  } catch {
    return {};
  }
}

function activeCharacterRef(character, characterId) {
  const avatar = nonEmptyString(character?.avatar, '');
  return avatar ? `character:${avatar}` : `character:${characterId}`;
}

function emptyCatalog(characterRef, characterName) {
  return { characterRef, characterName, worldRef: '', worldName: '', entries: [] };
}

function normalizeEntries(rawEntries) {
  const entries = Array.isArray(rawEntries)
    ? rawEntries
    : isRecord(rawEntries)
      ? Object.values(rawEntries)
      : [];

  return entries.map(normalizeEntry).filter(Boolean);
}

function normalizeEntry(entry) {
  if (!isRecord(entry)) return null;

  const uid = normalizeUid(entry.uid ?? entry.id);
  if (!uid) return null;

  const content = typeof entry.content === 'string' ? entry.content.trim() : '';
  return {
    uid,
    displayName: displayNameFor(entry, uid),
    content,
    disabled: entry.disable === true || entry.enabled === false,
    constant: entry.constant === true
  };
}

function normalizeUid(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function displayNameFor(entry, uid) {
  const namedValue = firstNonEmptyString(entry.displayName, entry.comment, entry.name);
  if (namedValue) return namedValue;

  const keyName = formatKey(entry.key);
  return keyName || `条目 ${uid}`;
}

function formatKey(key) {
  if (Array.isArray(key)) {
    return key
      .map(safeDisplayPart)
      .filter(Boolean)
      .join(', ');
  }
  return safeDisplayPart(key);
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const normalized = nonEmptyString(value, '');
    if (normalized) return normalized;
  }
  return '';
}

function safeDisplayPart(value) {
  if (typeof value === 'string') return value.trim();
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function requestHeaders(context) {
  try {
    const headers = context.getRequestHeaders?.();
    if (headers && typeof headers === 'object' && !Array.isArray(headers)) return headers;
  } catch {
    // Use JSON headers when the host helper is unavailable or fails.
  }
  return { 'Content-Type': 'application/json' };
}

function nonEmptyString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

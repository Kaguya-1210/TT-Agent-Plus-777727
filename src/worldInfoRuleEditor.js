function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toSearchText(value) {
  try {
    return String(value).trim().toLocaleLowerCase('zh-CN');
  } catch {
    return '';
  }
}

function entryFieldText(entry, field) {
  try {
    return toSearchText(entry[field] ?? '');
  } catch {
    return '';
  }
}

function normalizeUid(value) {
  if (typeof value === 'string') {
    const normalized = String(value).trim();
    return normalized || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function normalizedSelection(selectedUids) {
  if (!Array.isArray(selectedUids)) return [];

  const result = [];
  const seen = new Set();
  for (const uid of selectedUids) {
    const normalized = normalizeUid(uid);
    if (normalized === null || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function visibleUids(visibleEntries) {
  if (!Array.isArray(visibleEntries)) return [];

  const result = [];
  const seen = new Set();
  for (const entry of visibleEntries) {
    if (!isRecord(entry)) continue;
    let uid;
    try {
      uid = normalizeUid(entry.uid);
    } catch {
      uid = null;
    }
    if (uid === null || seen.has(uid)) continue;
    seen.add(uid);
    result.push(uid);
  }
  return result;
}

export function filterCatalogEntries(entries, query) {
  if (!Array.isArray(entries)) return [];

  const safeEntries = entries.filter(isRecord);
  const normalizedQuery = toSearchText(query ?? '');
  if (!normalizedQuery) return safeEntries;

  return safeEntries.filter((entry) => (
    entryFieldText(entry, 'uid').includes(normalizedQuery)
    || entryFieldText(entry, 'displayName').includes(normalizedQuery)
    || entryFieldText(entry, 'content').includes(normalizedQuery)
  ));
}

export function selectVisibleEntries(selectedUids, visibleEntries) {
  const result = normalizedSelection(selectedUids);
  const selected = new Set(result);

  for (const uid of visibleUids(visibleEntries)) {
    if (selected.has(uid)) continue;
    selected.add(uid);
    result.push(uid);
  }
  return result;
}

export function invertVisibleSelection(selectedUids, visibleEntries) {
  const selected = normalizedSelection(selectedUids);
  const selectedSet = new Set(selected);
  const visible = visibleUids(visibleEntries);
  const visibleSet = new Set(visible);
  const result = selected.filter((uid) => !visibleSet.has(uid));

  for (const uid of visible) {
    if (!selectedSet.has(uid)) result.push(uid);
  }
  return result;
}

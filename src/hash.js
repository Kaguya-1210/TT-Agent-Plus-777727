export function hashString(value) {
  const input = String(value ?? '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function hashSource(source) {
  const safeSource = source ?? {};
  return hashString(JSON.stringify({
    kind: safeSource.kind,
    uid: safeSource.uid,
    displayName: safeSource.displayName,
    content: safeSource.content
  }));
}

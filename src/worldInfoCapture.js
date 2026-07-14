import { hashString } from './hash.js';
import { estimateTokens } from './tokenEstimate.js';

const WORLDINFO_SCAN_DONE = 'worldinfo_scan_done';

export function normalizeWorldInfoScan(eventData, options = {}) {
  const source = isRecord(eventData) ? eventData : {};
  const entries = [];
  const seen = new Set();

  for (const [mapKey, rawEntry] of activatedEntryPairs(source?.activated?.entries)) {
    const normalized = normalizeActivatedEntry(mapKey, rawEntry);
    if (!normalized || normalized.disable || !normalized.content) continue;

    const identity = worldInfoSourceIdentity(normalized);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    entries.push(normalized);
  }

  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString();
  const budget = isRecord(source.budget) ? source.budget : {};

  return {
    scopeId: stableChatId(options.scopeId),
    capturedAt: now(),
    entries,
    totalTokens: entries.reduce((total, entry) => total + entry.tokenEstimate, 0),
    budget: {
      current: finiteNumber(budget.current, 0),
      overflowed: budget.overflowed === true
    },
    scan: {
      current: finiteNumber(source?.state?.current, 0),
      next: finiteNumber(source?.state?.next, 0),
      loopCount: finiteNumber(source?.state?.loopCount, 0)
    }
  };
}

export function subscribeWorldInfoScans({ getContext, onCapture, debug, now } = {}) {
  const context = safeGetContext(getContext, debug);
  const eventSource = context?.eventSource;
  if (!eventSource || typeof eventSource.on !== 'function') {
    warn(debug, 'world-info', 'WORLDINFO_SCAN_DONE event source unavailable', {});
    return () => false;
  }

  const eventName = context?.eventTypes?.WORLDINFO_SCAN_DONE ?? WORLDINFO_SCAN_DONE;
  const listener = async (eventData) => {
    try {
      const currentContext = safeGetContext(getContext, debug) ?? context;
      const scopeId = resolveWorldInfoScopeId(currentContext);
      if (!scopeId) {
        warn(debug, 'world-info', '缺少稳定聊天标识，已拒绝捕获世界书数据', {});
        return;
      }
      const capture = normalizeWorldInfoScan(eventData, {
        scopeId,
        now
      });
      if (typeof onCapture === 'function') {
        await onCapture(capture, eventData);
      }
    } catch (error) {
      warn(debug, 'world-info', 'WORLDINFO_SCAN_DONE handling failed', { error: errorMessage(error) });
    }
  };

  try {
    eventSource.on(eventName, listener);
  } catch (error) {
    warn(debug, 'world-info', 'WORLDINFO_SCAN_DONE subscription failed', { error: errorMessage(error) });
    return () => false;
  }

  let active = true;
  return () => {
    if (!active) return false;
    active = false;
    try {
      eventSource.removeListener?.(eventName, listener);
      return true;
    } catch (error) {
      warn(debug, 'world-info', 'WORLDINFO_SCAN_DONE unsubscribe failed', { error: errorMessage(error) });
      return false;
    }
  };
}

export function removeCoveredWorldInfoEntries(eventData, coveredSourceRefs) {
  const covered = new Set(
    (Array.isArray(coveredSourceRefs) ? coveredSourceRefs : [])
      .map(worldInfoSourceIdentity)
      .filter(Boolean)
  );
  if (!covered.size || !isRecord(eventData?.activated)) return 0;

  const activatedEntries = eventData.activated.entries;
  let removed = 0;

  if (activatedEntries instanceof Map) {
    for (const [mapKey, entry] of activatedEntries.entries()) {
      const normalized = normalizeActivatedEntry(mapKey, entry);
      if (normalized && covered.has(worldInfoSourceIdentity(normalized))) {
        activatedEntries.delete(mapKey);
        removed += 1;
      }
    }
    return removed;
  }

  if (Array.isArray(activatedEntries)) {
    const remaining = activatedEntries.filter((entry) => {
      const normalized = normalizeActivatedEntry(null, entry);
      const shouldRemove = normalized && covered.has(worldInfoSourceIdentity(normalized));
      if (shouldRemove) removed += 1;
      return !shouldRemove;
    });
    activatedEntries.splice(0, activatedEntries.length, ...remaining);
    return removed;
  }

  if (isRecord(activatedEntries)) {
    for (const [mapKey, entry] of Object.entries(activatedEntries)) {
      const normalized = normalizeActivatedEntry(mapKey, entry);
      if (normalized && covered.has(worldInfoSourceIdentity(normalized))) {
        delete activatedEntries[mapKey];
        removed += 1;
      }
    }
  }

  return removed;
}

export function worldInfoSourceIdentity(source) {
  if (!isRecord(source)) return '';
  const uid = source.parentUid ?? source.uid ?? source.id;
  if (uid === null || uid === undefined || uid === '') return '';
  const kind = nonEmptyString(source.kind, 'world_info');
  const world = nonEmptyString(source.world, 'unknown');
  return `${kind}\u0000${world}\u0000${String(uid)}`;
}

function activatedEntryPairs(value) {
  if (value instanceof Map) return Array.from(value.entries());
  if (Array.isArray(value)) return value.map((entry) => [null, entry]);
  if (isRecord(value)) return Object.entries(value);
  return [];
}

function normalizeActivatedEntry(mapKey, rawEntry) {
  if (!isRecord(rawEntry)) return null;
  const keyParts = parseMapKey(mapKey, rawEntry.uid ?? rawEntry.id);
  const uid = rawEntry.uid ?? rawEntry.id ?? keyParts.uid;
  if (uid === null || uid === undefined || uid === '') return null;

  const world = nonEmptyString(rawEntry.world, keyParts.world || 'unknown');
  const content = typeof rawEntry.content === 'string' ? rawEntry.content.trim() : '';
  const displayName = firstNonEmptyString(
    rawEntry.displayName,
    rawEntry.comment,
    rawEntry.name,
    Array.isArray(rawEntry.key) ? rawEntry.key.join(', ') : '',
    `${world}#${String(uid)}`
  );
  const normalized = {
    kind: 'world_info',
    world,
    uid,
    displayName,
    content,
    disable: rawEntry.disable === true,
    constant: rawEntry.constant === true,
    position: rawEntry.position ?? null,
    tokenEstimate: estimateTokens(content)
  };

  return {
    ...normalized,
    sourceHash: hashString(JSON.stringify({
      kind: normalized.kind,
      world,
      uid,
      displayName,
      content
    }))
  };
}

function parseMapKey(mapKey, knownUid) {
  if (typeof mapKey !== 'string' || !mapKey) return { world: '', uid: knownUid };
  const suffix = knownUid === null || knownUid === undefined ? '' : `.${String(knownUid)}`;
  if (suffix && mapKey.endsWith(suffix)) {
    return { world: mapKey.slice(0, -suffix.length), uid: knownUid };
  }
  const separator = mapKey.lastIndexOf('.');
  if (separator < 0) return { world: mapKey, uid: knownUid };
  return {
    world: mapKey.slice(0, separator),
    uid: knownUid ?? mapKey.slice(separator + 1)
  };
}

export function resolveWorldInfoScopeId(context) {
  if (!isRecord(context)) return '';
  try {
    const currentChatId = stableChatId(context.getCurrentChatId?.());
    if (currentChatId) return currentChatId;
  } catch {
    // Fall through to stable context fields.
  }
  return stableChatId(context.chatId);
}

function safeGetContext(getContext, debug) {
  if (typeof getContext !== 'function') return null;
  try {
    return getContext() ?? null;
  } catch (error) {
    warn(debug, 'world-info', 'getContext failed during world-info subscription', { error: errorMessage(error) });
    return null;
  }
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function stableChatId(value) {
  const id = firstNonEmptyString(value);
  return id && id !== 'global' ? id : '';
}

function nonEmptyString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function warn(debug, channel, message, details) {
  try {
    debug?.warn?.(channel, message, details);
  } catch {
    // Debug hooks must not break host event handling.
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

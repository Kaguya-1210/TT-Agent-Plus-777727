import { WORLD_INFO_FILTER_MODES } from './constants.js';

export const BUILTIN_ALL_WORLD_INFO_RULE_ID = 'world-info-all';

const DEFAULT_RULE_NAME = '全部条目';
const MAX_RULE_VERSION = 999999;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeEntryUids(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const normalized = [];
  for (const uid of value) {
    if (uid === null || uid === undefined) continue;
    const normalizedUid = String(uid).trim();
    if (!normalizedUid || seen.has(normalizedUid)) continue;
    seen.add(normalizedUid);
    normalized.push(normalizedUid);
  }
  return normalized;
}

export function normalizeWorldInfoRule(input) {
  const source = isRecord(input) ? input : {};
  const id = normalizeString(source.id, BUILTIN_ALL_WORLD_INFO_RULE_ID) || BUILTIN_ALL_WORLD_INFO_RULE_ID;
  const name = normalizeString(source.name, DEFAULT_RULE_NAME) || DEFAULT_RULE_NAME;
  const version = Number.isInteger(source.version)
    && source.version >= 1
    && source.version <= MAX_RULE_VERSION
    ? source.version
    : 1;

  return {
    id,
    name,
    mode: source.mode === WORLD_INFO_FILTER_MODES.INCLUDE
      ? WORLD_INFO_FILTER_MODES.INCLUDE
      : WORLD_INFO_FILTER_MODES.EXCLUDE,
    worldRef: normalizeString(source.worldRef),
    entryUids: normalizeEntryUids(source.entryUids),
    version,
    builtin: source.builtin === true
  };
}

function entryUid(entry) {
  return String(entry?.parentUid ?? entry?.uid ?? entry?.id);
}

export function filterWorldInfoEntries(entries, ruleInput, catalogInput) {
  if (!Array.isArray(entries)) return [];

  const rule = normalizeWorldInfoRule(ruleInput);
  const catalog = isRecord(catalogInput) ? catalogInput : {};
  if (rule.worldRef && rule.worldRef !== catalog.worldRef) return [];

  const selectedUids = new Set(rule.entryUids);
  return entries.filter((entry) => {
    if (!isRecord(entry) || entry.world !== catalog.worldName) return false;
    const selected = selectedUids.has(entryUid(entry));
    return rule.mode === WORLD_INFO_FILTER_MODES.INCLUDE ? selected : !selected;
  });
}

export function summarizeWorldInfoFilter(captured, passed) {
  const capturedCount = Array.isArray(captured) ? captured.length : 0;
  const passedCount = Array.isArray(passed) ? passed.length : 0;
  return {
    captured: capturedCount,
    passed: passedCount,
    excluded: Math.max(0, capturedCount - passedCount)
  };
}

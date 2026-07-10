import { worldInfoSourceIdentity } from './worldInfoCapture.js';

export const PROMPT_BLOCK_VERSION = 1;

const CONTEXT_OPEN_TAG = '<tt-agent-plus-727-processed-context>';
const CONTEXT_CLOSE_TAG = '</tt-agent-plus-727-processed-context>';
const ESCAPED_CONTEXT_CLOSE_TAG = '<\\/tt-agent-plus-727-processed-context>';

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function hasProcessedText(entry) {
  return typeof entry.processedText === 'string' && entry.processedText.length > 0;
}

function safeContextText(text) {
  return text.split(CONTEXT_CLOSE_TAG).join(ESCAPED_CONTEXT_CLOSE_TAG);
}

function cleanInlineText(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed ? safeContextText(trimmed) : '';
}

function firstCleanSourceName(source) {
  return cleanInlineText(source.displayName) || cleanInlineText(source.uid) || cleanInlineText(source.kind);
}

function collectSourceNames(sourceRefs) {
  if (!Array.isArray(sourceRefs)) return '未命名资料';
  const names = sourceRefs
    .filter(isObject)
    .map(firstCleanSourceName)
    .filter(Boolean);

  return names.join('、') || '未命名资料';
}

function collectWarnings(warnings) {
  if (!Array.isArray(warnings)) return [];
  return warnings.map(cleanInlineText).filter(Boolean);
}

export function selectRelevantCacheEntries(entries, {
  maxTokens,
  activeSourceRefs,
  scopeId,
  promptVersion
} = {}) {
  if (!Array.isArray(entries)) return [];
  const budget = Number.isFinite(maxTokens) && maxTokens >= 0 ? maxTokens : 0;
  const hasActiveSourceFilter = Array.isArray(activeSourceRefs);
  const activeSources = new Map();
  for (const sourceRef of Array.isArray(activeSourceRefs) ? activeSourceRefs : []) {
    const identity = worldInfoSourceIdentity(sourceRef);
    if (identity && !activeSources.has(identity)) activeSources.set(identity, sourceRef);
  }
  const selected = [];
  let used = 0;

  for (const entry of entries) {
    if (!isUsableProcessedCacheEntry(entry)) continue;
    if (scopeId && entry.scopeId !== scopeId) continue;
    if (Number.isInteger(promptVersion) && entry.promptVersion !== promptVersion) continue;
    if (hasActiveSourceFilter && !activeSources.size) continue;
    if (hasActiveSourceFilter && !entryMatchesActiveSources(entry, activeSources)) continue;
    if (used + entry.tokenEstimate > budget) continue;
    selected.push(entry);
    used += entry.tokenEstimate;
  }

  return selected;
}

export function collectFullyCoveredSourceRefs(cacheEntries, activeSourceRefs) {
  if (!Array.isArray(cacheEntries) || !Array.isArray(activeSourceRefs)) return [];
  const activeByIdentity = new Map();
  for (const sourceRef of activeSourceRefs) {
    const identity = worldInfoSourceIdentity(sourceRef);
    if (identity && !activeByIdentity.has(identity)) activeByIdentity.set(identity, sourceRef);
  }

  const coverage = new Map();
  for (const entry of cacheEntries) {
    if (!isObject(entry) || !Array.isArray(entry.sourceRefs)) continue;
    if (entry.promptVersion !== PROMPT_BLOCK_VERSION) continue;
    const descriptor = cacheDescriptorIdentity(entry);
    for (const sourceRef of entry.sourceRefs) {
      const identity = worldInfoSourceIdentity(sourceRef);
      if (!identity || !activeByIdentity.has(identity)) continue;
      const groups = coverage.get(identity) ?? new Map();
      const partCount = Number(sourceRef?.partCount);
      const partIndex = Number(sourceRef?.partIndex);
      const hasPartMetadata = sourceRef?.partCount !== undefined || sourceRef?.partIndex !== undefined;
      if (hasPartMetadata) {
        const splitPlanId = typeof sourceRef?.splitPlanId === 'string' ? sourceRef.splitPlanId : '';
        if (
          !splitPlanId
          || !Number.isInteger(partCount)
          || partCount <= 1
          || !Number.isInteger(partIndex)
          || partIndex <= 0
          || partIndex > partCount
        ) {
          continue;
        }
        const groupKey = `split\u0000${descriptor}\u0000${splitPlanId}`;
        const current = groups.get(groupKey) ?? {
          complete: false,
          invalid: false,
          partCount,
          parts: new Set()
        };
        if (current.partCount !== partCount) current.invalid = true;
        current.parts.add(partIndex);
        groups.set(groupKey, current);
      } else {
        const groupKey = `whole\u0000${descriptor}\u0000${sourceVersionHash(sourceRef)}`;
        groups.set(groupKey, { complete: true, invalid: false, partCount: 0, parts: new Set() });
      }
      coverage.set(identity, groups);
    }
  }

  return Array.from(activeByIdentity.entries())
    .filter(([identity]) => {
      const groups = coverage.get(identity);
      return Boolean(groups && Array.from(groups.values()).some(isCompleteCoverageGroup));
    })
    .map(([, sourceRef]) => sourceRef);
}

export function isUsableProcessedCacheEntry(entry) {
  return Boolean(
    isObject(entry)
    && !entry.stale
    && hasProcessedText(entry)
    && Array.isArray(entry.sourceRefs)
    && entry.sourceRefs.length > 0
    && Number.isFinite(entry.tokenEstimate)
    && entry.tokenEstimate >= 0
  );
}

export function buildProcessedContextBlock(entries) {
  if (!Array.isArray(entries)) return '';
  const parts = [];

  for (const entry of entries) {
    if (!isObject(entry)) continue;
    if (!hasProcessedText(entry)) continue;

    const names = collectSourceNames(entry.sourceRefs);
    const warnings = collectWarnings(entry.warnings);
    const warningBlock = warnings.length ? `\n警告：${warnings.join('；')}` : '';
    parts.push(`资料 ${parts.length + 1}：${names}\n${safeContextText(entry.processedText)}${warningBlock}`);
  }

  if (!parts.length) return '';

  return [
    CONTEXT_OPEN_TAG,
    `版本：${PROMPT_BLOCK_VERSION}`,
    '说明：以下内容由 TT-Agent-Plus-727 子 AI 根据世界书/角色/场景资料预处理而来，不会显示在聊天框中。',
    ...parts,
    CONTEXT_CLOSE_TAG
  ].join('\n\n');
}

function entryMatchesActiveSources(entry, activeSources) {
  if (!Array.isArray(entry.sourceRefs) || !entry.sourceRefs.length) return false;
  return entry.sourceRefs.every((sourceRef) => {
    const identity = worldInfoSourceIdentity(sourceRef);
    const activeSource = activeSources.get(identity);
    if (!identity || !activeSource) return false;

    const activeHash = sourceVersionHash(activeSource);
    if (!activeHash) return true;
    return sourceVersionHash(sourceRef) === activeHash;
  });
}

function sourceVersionHash(sourceRef) {
  if (typeof sourceRef?.parentSourceHash === 'string' && sourceRef.parentSourceHash) {
    return sourceRef.parentSourceHash;
  }
  return typeof sourceRef?.sourceHash === 'string' ? sourceRef.sourceHash : '';
}

function cacheDescriptorIdentity(entry) {
  return [
    entry?.ruleTemplateId ?? '',
    entry?.ruleVersion ?? '',
    entry?.modelProfileId ?? '',
    entry?.promptVersion ?? ''
  ].join('\u0000');
}

function isCompleteCoverageGroup(group) {
  if (group.complete) return true;
  if (group.invalid || group.partCount <= 1 || group.parts.size !== group.partCount) return false;
  for (let partIndex = 1; partIndex <= group.partCount; partIndex += 1) {
    if (!group.parts.has(partIndex)) return false;
  }
  return true;
}

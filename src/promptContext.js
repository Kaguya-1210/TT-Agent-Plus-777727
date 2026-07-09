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

export function selectRelevantCacheEntries(entries, { maxTokens } = {}) {
  if (!Array.isArray(entries)) return [];
  const budget = Number.isFinite(maxTokens) && maxTokens >= 0 ? maxTokens : 0;
  const selected = [];
  let used = 0;

  for (const entry of entries) {
    if (!isObject(entry)) continue;
    if (entry.stale) continue;
    if (!hasProcessedText(entry)) continue;
    if (!Number.isFinite(entry.tokenEstimate) || entry.tokenEstimate < 0) continue;
    if (used + entry.tokenEstimate > budget) continue;
    selected.push(entry);
    used += entry.tokenEstimate;
  }

  return selected;
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

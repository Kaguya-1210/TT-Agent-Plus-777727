export const PROMPT_BLOCK_VERSION = 1;

export function selectRelevantCacheEntries(entries, { maxTokens }) {
  const selected = [];
  let used = 0;

  for (const entry of entries) {
    if (entry.stale) continue;
    const cost = Number(entry.tokenEstimate || 0);
    if (used + cost > maxTokens) continue;
    selected.push(entry);
    used += cost;
  }

  return selected;
}

export function buildProcessedContextBlock(entries) {
  if (!entries.length) return '';
  const parts = entries.map((entry, index) => {
    const names = (entry.sourceRefs ?? [])
      .map((source) => source.displayName || source.uid || source.kind)
      .filter(Boolean)
      .join('、') || '未命名资料';
    const warnings = Array.isArray(entry.warnings) && entry.warnings.length
      ? `\n警告：${entry.warnings.join('；')}`
      : '';
    return `资料 ${index + 1}：${names}\n${entry.processedText}${warnings}`;
  });

  return [
    '<tt-agent-plus-727-processed-context>',
    `版本：${PROMPT_BLOCK_VERSION}`,
    '说明：以下内容由 TT-Agent-Plus-727 子 AI 根据世界书/角色/场景资料预处理而来。它不是可见聊天消息。',
    ...parts,
    '</tt-agent-plus-727-processed-context>'
  ].join('\n\n');
}

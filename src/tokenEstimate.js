export function estimateTokens(text) {
  if (!text) return 0;
  const chars = Array.from(String(text));
  let total = 0;
  for (const char of chars) {
    if (/\s/.test(char)) continue;
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(char)) {
      total += 1;
    } else {
      total += 0.35;
    }
  }
  return Math.ceil(total);
}

export function estimateTokens(text) {
  if (!text) return 0;
  let input;
  try {
    input = String(text);
  } catch {
    input = JSON.stringify(text) ?? '';
  }
  const chars = Array.from(input);
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

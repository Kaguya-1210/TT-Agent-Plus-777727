import { hashSource, hashString } from './hash.js';
import { estimateTokens } from './tokenEstimate.js';

export function splitSourceByTokenBudget(source, maxTokens) {
  if (!isRecord(source)) return [];
  const budget = normalizeBudget(maxTokens);
  if (!budget) return [];

  const content = typeof source.content === 'string' ? source.content : String(source.content ?? '');
  if (!content) return [];
  const tokenEstimate = validTokenEstimate(source.tokenEstimate)
    ? source.tokenEstimate
    : estimateTokens(content);
  if (tokenEstimate <= budget) {
    return [{ ...source, content, tokenEstimate }];
  }

  const chunks = splitText(content, budget);
  const partCount = chunks.length;
  const parentUid = source.parentUid ?? source.uid ?? source.id ?? hashString(content);
  const parentSourceHash = source.parentSourceHash ?? source.sourceHash ?? hashSource(source);
  const splitPlanId = hashString(JSON.stringify({ parentSourceHash, budget, partCount }));
  return chunks.map((chunk, index) => {
    const partIndex = index + 1;
    return {
      ...source,
      uid: `${String(parentUid)}::part:${partIndex}`,
      parentUid,
      parentSourceHash,
      splitPlanId,
      partIndex,
      partCount,
      displayName: `${source.displayName ?? source.comment ?? '资料'} (${partIndex}/${partCount})`,
      content: chunk,
      tokenEstimate: estimateTokens(chunk),
      sourceHash: hashString(JSON.stringify({
        kind: source.kind,
        world: source.world,
        parentUid,
        partIndex,
        content: chunk
      }))
    };
  });
}

export function planSourceBatches(sources, { maxTokens } = {}) {
  if (!Array.isArray(sources)) return [];
  const budget = normalizeBudget(maxTokens);
  if (!budget) return [];

  const expanded = sources.flatMap((source, sourceIndex) => (
    splitSourceByTokenBudget(source, budget).map((part, partIndex) => ({
      source: part,
      sourceIndex,
      partIndex
    }))
  ));

  expanded.sort((left, right) => (
    right.source.tokenEstimate - left.source.tokenEstimate
    || left.sourceIndex - right.sourceIndex
    || left.partIndex - right.partIndex
  ));

  const bins = [];
  for (const item of expanded) {
    let bestBin = null;
    for (const bin of bins) {
      if (bin.tokenEstimate + item.source.tokenEstimate > budget) continue;
      if (!bestBin || bin.tokenEstimate > bestBin.tokenEstimate) bestBin = bin;
    }
    if (!bestBin) {
      bestBin = { sourceRefs: [], tokenEstimate: 0 };
      bins.push(bestBin);
    }
    bestBin.sourceRefs.push({ ...item.source });
    bestBin.tokenEstimate += item.source.tokenEstimate;
  }

  return bins.map((bin, index) => ({
    id: `batch-${index + 1}`,
    sourceRefs: bin.sourceRefs,
    tokenEstimate: bin.tokenEstimate
  }));
}

function splitText(text, maxTokens) {
  const characters = Array.from(text);
  const chunks = [];
  let offset = 0;

  while (offset < characters.length) {
    let low = offset + 1;
    let high = characters.length;
    let best = low;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = characters.slice(offset, middle).join('');
      if (estimateTokens(candidate) <= maxTokens) {
        best = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    chunks.push(characters.slice(offset, best).join(''));
    offset = best;
  }

  return chunks;
}

function normalizeBudget(value) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function validTokenEstimate(value) {
  return Number.isFinite(value) && value >= 0;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

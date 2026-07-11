import { APPROVAL_MODES, OUTPUT_MODES } from './constants.js';
import { DEFAULT_SETTINGS } from './defaults.js';
import {
  BUILTIN_ALL_WORLD_INFO_RULE_ID,
  normalizeWorldInfoRule
} from './worldInfoRules.js';

const THEMES = new Set(['system', 'light', 'dark']);
const APPROVAL_VALUES = new Set(Object.values(APPROVAL_MODES));
const OUTPUT_VALUES = new Set(Object.values(OUTPUT_MODES));
const WORKER_ADAPTERS = new Set(['deterministic', 'tauritavern_agent']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function nonEmptyString(value, fallback) {
  return typeof value === 'string' && value ? value : fallback;
}

function trimmedNonEmptyString(value, fallback) {
  if (typeof value !== 'string') return fallback;
  return value.trim() || fallback;
}

function normalizeRule(defaultRule, savedRule) {
  const source = isRecord(savedRule) ? savedRule : {};
  return {
    id: nonEmptyString(source.id, defaultRule.id),
    name: nonEmptyString(source.name, defaultRule.name),
    description: nonEmptyString(source.description, defaultRule.description),
    systemInstruction: nonEmptyString(source.systemInstruction, defaultRule.systemInstruction),
    outputSchema: nonEmptyString(source.outputSchema, defaultRule.outputSchema),
    modelProfileId: nonEmptyString(source.modelProfileId, defaultRule.modelProfileId),
    worldInfoRuleId: trimmedNonEmptyString(source.worldInfoRuleId, defaultRule.worldInfoRuleId),
    maxInputTokens: clampInteger(source.maxInputTokens, defaultRule.maxInputTokens, 1000, 200000),
    targetOutputTokens: clampInteger(source.targetOutputTokens, defaultRule.targetOutputTokens, 100, 12000),
    allowChildDispatch: typeof source.allowChildDispatch === 'boolean'
      ? source.allowChildDispatch
      : defaultRule.allowChildDispatch,
    maxChildWorkers: clampInteger(source.maxChildWorkers, defaultRule.maxChildWorkers, 0, 8),
    maxDepth: clampInteger(source.maxDepth, defaultRule.maxDepth, 0, 8),
    outputMode: OUTPUT_VALUES.has(source.outputMode) ? source.outputMode : defaultRule.outputMode,
    version: clampInteger(source.version, defaultRule.version, 1, 999)
  };
}

function mergeRules(sourceRules, defaultRules) {
  const defaultRulesById = new Map(defaultRules.map((rule) => [rule.id, rule]));
  const savedRules = Array.isArray(sourceRules) ? sourceRules.filter(isRecord) : [];
  const savedDefaultRules = new Map();

  for (const rule of savedRules) {
    if (typeof rule.id === 'string' && defaultRulesById.has(rule.id)) {
      savedDefaultRules.set(rule.id, rule);
    }
  }

  const mergedDefaults = defaultRules.map((rule) => normalizeRule(rule, savedDefaultRules.get(rule.id)));
  const customRules = savedRules
    .filter((rule) => {
      const id = nonEmptyString(rule.id, '');
      const name = nonEmptyString(rule.name, '');
      return id && name && !defaultRulesById.has(id);
    })
    .map((rule) => normalizeRule(defaultRules[0], rule));

  return [...mergedDefaults, ...customRules];
}

function mergeWorldInfoRules(sourceRules, defaultRules) {
  const savedRules = Array.isArray(sourceRules) ? sourceRules.filter(isRecord) : [];
  const defaultBuiltinRule = defaultRules.find(
    (rule) => rule.id === BUILTIN_ALL_WORLD_INFO_RULE_ID
  ) ?? defaultRules[0];
  const normalizedRulesById = new Map();
  for (const rule of savedRules) {
    if (typeof rule.id !== 'string' || !rule.id.trim()) continue;
    const normalizedRule = normalizeWorldInfoRule(rule);
    normalizedRulesById.set(normalizedRule.id, normalizedRule);
  }
  const savedBuiltinRule = normalizedRulesById.get(BUILTIN_ALL_WORLD_INFO_RULE_ID);
  const builtinRule = normalizeWorldInfoRule({
    ...defaultBuiltinRule,
    ...savedBuiltinRule,
    id: BUILTIN_ALL_WORLD_INFO_RULE_ID,
    builtin: true
  });
  normalizedRulesById.delete(BUILTIN_ALL_WORLD_INFO_RULE_ID);
  const customRules = [...normalizedRulesById.values()]
    .map((rule) => ({ ...rule, builtin: false }));

  return [builtinRule, ...customRules];
}

export function mergeSettings(saved = {}) {
  const source = isRecord(saved) ? saved : {};
  const defaults = DEFAULT_SETTINGS;
  const worldInfoRules = mergeWorldInfoRules(source.worldInfoRules, defaults.worldInfoRules);
  const worldInfoRuleIds = new Set(worldInfoRules.map((rule) => rule.id));
  const rules = mergeRules(source.rules, defaults.rules).map((rule) => ({
    ...rule,
    worldInfoRuleId: worldInfoRuleIds.has(rule.worldInfoRuleId)
      ? rule.worldInfoRuleId
      : BUILTIN_ALL_WORLD_INFO_RULE_ID
  }));

  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : defaults.enabled,
    theme: THEMES.has(source.theme) ? source.theme : defaults.theme,
    debugMode: typeof source.debugMode === 'boolean' ? source.debugMode : defaults.debugMode,
    globalConcurrency: clampInteger(source.globalConcurrency, defaults.globalConcurrency, 1, 8),
    dispatchConfirmThreshold: clampInteger(source.dispatchConfirmThreshold, defaults.dispatchConfirmThreshold, 0, 50),
    approvalMode: APPROVAL_VALUES.has(source.approvalMode) ? source.approvalMode : defaults.approvalMode,
    maxWorkerInputTokens: clampInteger(source.maxWorkerInputTokens, defaults.maxWorkerInputTokens, 1000, 200000),
    maxTotalDispatches: clampInteger(source.maxTotalDispatches, defaults.maxTotalDispatches, 1, 100),
    maxDepth: clampInteger(source.maxDepth, defaults.maxDepth, 0, 8),
    paidApiProfileIds: Array.isArray(source.paidApiProfileIds)
      ? source.paidApiProfileIds.filter((id) => typeof id === 'string' && id)
      : [...defaults.paidApiProfileIds],
    promptInjectionEnabled: typeof source.promptInjectionEnabled === 'boolean'
      ? source.promptInjectionEnabled
      : defaults.promptInjectionEnabled,
    promptBlockMaxTokens: clampInteger(source.promptBlockMaxTokens, defaults.promptBlockMaxTokens, 200, 12000),
    worldInfoCaptureEnabled: typeof source.worldInfoCaptureEnabled === 'boolean'
      ? source.worldInfoCaptureEnabled
      : defaults.worldInfoCaptureEnabled,
    worldInfoBypassEnabled: typeof source.worldInfoBypassEnabled === 'boolean'
      ? source.worldInfoBypassEnabled
      : defaults.worldInfoBypassEnabled,
    workerAdapter: WORKER_ADAPTERS.has(source.workerAdapter)
      ? source.workerAdapter
      : defaults.workerAdapter,
    worldInfoRules,
    rules
  };
}

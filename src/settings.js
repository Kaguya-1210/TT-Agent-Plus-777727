import { APPROVAL_MODES } from './constants.js';
import { DEFAULT_SETTINGS } from './defaults.js';

const THEMES = new Set(['system', 'light', 'dark']);
const APPROVAL_VALUES = new Set(Object.values(APPROVAL_MODES));

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function mergeRule(defaultRule, savedRule) {
  if (!savedRule || typeof savedRule !== 'object') return defaultRule;
  return {
    ...defaultRule,
    ...Object.fromEntries(Object.entries(savedRule).filter(([key]) => Object.hasOwn(defaultRule, key))),
    id: typeof savedRule.id === 'string' && savedRule.id ? savedRule.id : defaultRule.id,
    name: typeof savedRule.name === 'string' && savedRule.name ? savedRule.name : defaultRule.name
  };
}

export function mergeSettings(saved = {}) {
  const source = saved && typeof saved === 'object' ? saved : {};
  const defaults = DEFAULT_SETTINGS;
  const defaultRulesById = new Map(defaults.rules.map((rule) => [rule.id, rule]));
  const savedRules = Array.isArray(source.rules) ? source.rules : [];
  const mergedRules = savedRules.length
    ? savedRules.map((rule) => mergeRule(defaultRulesById.get(rule.id) ?? defaults.rules[0], rule))
    : defaults.rules;

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
      : defaults.paidApiProfileIds,
    promptInjectionEnabled: typeof source.promptInjectionEnabled === 'boolean'
      ? source.promptInjectionEnabled
      : defaults.promptInjectionEnabled,
    promptBlockMaxTokens: clampInteger(source.promptBlockMaxTokens, defaults.promptBlockMaxTokens, 200, 12000),
    workerAdapter: ['deterministic', 'tauritavern_agent'].includes(source.workerAdapter)
      ? source.workerAdapter
      : defaults.workerAdapter,
    rules: mergedRules
  };
}

import { APPROVAL_MODES, OUTPUT_MODES } from './constants.js';
import { BUILTIN_ALL_WORLD_INFO_RULE_ID } from './worldInfoRules.js';

export const DEFAULT_WORLD_INFO_RULES = Object.freeze([
  {
    id: BUILTIN_ALL_WORLD_INFO_RULE_ID,
    name: '全部条目',
    worldRef: '',
    mode: 'exclude',
    entryUids: [],
    version: 1,
    builtin: true
  }
]);

export const DEFAULT_RULE_TEMPLATES = Object.freeze([
  {
    id: 'airp-character-default',
    name: '角色加工',
    description: '把世界书角色条目加工成最终提示词可直接使用的全知上下文。',
    systemInstruction: [
      '你是 TT-Agent-Plus-727 的角色资料加工子 AI。',
      '只处理分配给你的资料，不推测未提供事实。',
      '输出要给最终生成模型使用，保持简洁、明确、可引用。',
      '如果资料互相冲突，在 warnings 中列出冲突点。'
    ].join('\n'),
    outputSchema: 'json_summary_v1',
    modelProfileId: 'current',
    worldInfoRuleId: BUILTIN_ALL_WORLD_INFO_RULE_ID,
    maxInputTokens: 60000,
    targetOutputTokens: 1800,
    allowChildDispatch: true,
    maxChildWorkers: 2,
    maxDepth: 1,
    outputMode: OUTPUT_MODES.SILENT_CACHE,
    version: 1
  },
  {
    id: 'airp-scene-default',
    name: '场景加工',
    description: '把地点、事件、关系和当前局势加工成短上下文。',
    systemInstruction: [
      '你是 TT-Agent-Plus-727 的场景资料加工子 AI。',
      '聚焦地点、时间、冲突、角色关系和当前局势。',
      '输出不写剧情正文，只写最终模型需要知道的事实。'
    ].join('\n'),
    outputSchema: 'json_summary_v1',
    modelProfileId: 'current',
    worldInfoRuleId: BUILTIN_ALL_WORLD_INFO_RULE_ID,
    maxInputTokens: 60000,
    targetOutputTokens: 1200,
    allowChildDispatch: true,
    maxChildWorkers: 2,
    maxDepth: 1,
    outputMode: OUTPUT_MODES.SILENT_CACHE,
    version: 1
  }
]);

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  theme: 'system',
  debugMode: true,
  globalConcurrency: 2,
  dispatchConfirmThreshold: 5,
  approvalMode: APPROVAL_MODES.PAID_API_ONLY,
  maxWorkerInputTokens: 60000,
  maxTotalDispatches: 12,
  maxDepth: 2,
  paidApiProfileIds: [],
  promptInjectionEnabled: true,
  promptBlockMaxTokens: 2400,
  worldInfoCaptureEnabled: true,
  worldInfoBypassEnabled: true,
  workerAdapter: 'deterministic',
  worldInfoRules: DEFAULT_WORLD_INFO_RULES,
  rules: DEFAULT_RULE_TEMPLATES
});

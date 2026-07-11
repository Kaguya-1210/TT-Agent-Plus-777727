export const MODULE_ID = 'tt-agent-plus-777727';
export const SETTINGS_KEY = 'tt_agent_plus_777727';
export const DISPLAY_NAME = 'TT-Agent-Plus-727';
export const MAGIC_WAND_LABEL = 'TT-Agent+';
export const SLASH_COMMAND = '777';

export const TASK_STATES = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  AWAITING_APPROVAL: 'awaiting_approval',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
});

export const APPROVAL_MODES = Object.freeze({
  OFF: 'off',
  AFTER_THRESHOLD: 'after_threshold',
  EVERY_DISPATCH: 'every_dispatch',
  PAID_API_ONLY: 'paid_api_only'
});

export const OUTPUT_MODES = Object.freeze({
  SILENT_CACHE: 'silent_cache',
  STREAM_PANEL: 'stream_panel'
});

export const WORLD_INFO_FILTER_MODES = Object.freeze({
  INCLUDE: 'include',
  EXCLUDE: 'exclude'
});

export const PANEL_TABS = Object.freeze([
  { id: 'overview', label: '总览' },
  { id: 'tasks', label: '任务' },
  { id: 'rules', label: '规则' },
  { id: 'cache', label: '缓存' },
  { id: 'debug', label: '调试' },
  { id: 'settings', label: '设置' }
]);

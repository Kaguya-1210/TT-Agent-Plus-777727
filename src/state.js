import { PANEL_TABS } from './constants.js';
import { mergeSettings } from './settings.js';

const DEFAULT_PANEL = Object.freeze({
  open: false,
  activeTab: 'overview',
  badge: null
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function createInitialState(overrides = {}) {
  const source = isRecord(overrides) ? overrides : {};
  const { panel, settings, ...rest } = source;
  const panelOverrides = isRecord(panel) ? panel : {};

  return {
    settings: mergeSettings(settings),
    panel: {
      ...DEFAULT_PANEL,
      ...panelOverrides
    },
    tabs: PANEL_TABS.map((tab) => ({ ...tab })),
    tasks: [],
    cacheEntries: [],
    approvals: [],
    activeWorkers: 0,
    lastInjection: null,
    warnings: [],
    ...rest
  };
}

export function updatePanel(state, patch) {
  return {
    ...state,
    panel: {
      ...state.panel,
      ...patch
    }
  };
}

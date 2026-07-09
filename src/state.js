import { PANEL_TABS } from './constants.js';
import { DEFAULT_SETTINGS } from './defaults.js';

export function createInitialState(overrides = {}) {
  return {
    settings: overrides.settings ?? DEFAULT_SETTINGS,
    panel: {
      open: false,
      activeTab: 'overview',
      badge: null
    },
    tabs: PANEL_TABS,
    tasks: [],
    cacheEntries: [],
    approvals: [],
    activeWorkers: 0,
    lastInjection: null,
    warnings: [],
    ...overrides
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

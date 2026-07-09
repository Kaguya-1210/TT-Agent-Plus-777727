import { MODULE_ID, SETTINGS_KEY } from './constants.js';
import { mergeSettings } from './settings.js';

export function createHostBridge({ windowRef = globalThis, getContext, extensionPromptTypes, debug } = {}) {
  function warn(area, message, details = {}) {
    try {
      debug?.warn?.(area, message, details);
    } catch {
      // Debug logging must never break host integration.
    }
  }

  function info(area, message, details = {}) {
    try {
      debug?.info?.(area, message, details);
    } catch {
      // Debug logging must never break host integration.
    }
  }

  function context() {
    if (typeof getContext !== 'function') return null;
    try {
      return getContext() ?? null;
    } catch (error) {
      warn('host', 'getContext failed', { error: errorMessage(error) });
      return null;
    }
  }

  function readLocalSettings() {
    try {
      return windowRef?.localStorage?.getItem?.(SETTINGS_KEY) ?? null;
    } catch (error) {
      warn('settings', 'localStorage getItem failed', { key: SETTINGS_KEY, error: errorMessage(error) });
      return null;
    }
  }

  function writeLocalSettings(settings) {
    try {
      windowRef?.localStorage?.setItem?.(SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) {
      warn('settings', 'localStorage setItem failed', { key: SETTINGS_KEY, error: errorMessage(error) });
    }
  }

  return {
    loadSettings() {
      const ctx = context();
      const saved = ctx?.extensionSettings?.[SETTINGS_KEY] ?? safeJson(readLocalSettings());
      return mergeSettings(saved);
    },
    saveSettings(settings) {
      const normalized = mergeSettings(settings);
      const ctx = context();
      if (ctx?.extensionSettings) {
        try {
          ctx.extensionSettings[SETTINGS_KEY] = normalized;
        } catch (error) {
          warn('settings', 'context settings write failed', { key: SETTINGS_KEY, error: errorMessage(error) });
        }
        try {
          ctx.saveSettingsDebounced?.();
        } catch (error) {
          warn('settings', 'saveSettingsDebounced failed', { error: errorMessage(error) });
        }
      }
      writeLocalSettings(normalized);
      info('settings', 'settings saved', { key: SETTINGS_KEY });
      return normalized;
    },
    setProcessedPrompt(text) {
      const normalizedText = String(text ?? '');
      const ctx = context();
      if (typeof ctx?.setExtensionPrompt !== 'function') {
        warn('prompt', 'setExtensionPrompt unavailable', {});
        return false;
      }
      try {
        const promptType = extensionPromptTypes?.IN_PROMPT ?? 2;
        ctx.setExtensionPrompt(MODULE_ID, normalizedText, promptType, 0, false);
        info('prompt', 'processed prompt updated', { length: normalizedText.length });
        return true;
      } catch (error) {
        warn('prompt', 'setExtensionPrompt failed', { error: errorMessage(error) });
        return false;
      }
    }
  };
}

function safeJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

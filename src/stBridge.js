import { MODULE_ID, SETTINGS_KEY } from './constants.js';
import { mergeSettings } from './settings.js';

export function createHostBridge({ windowRef = globalThis, getContext, extensionPromptTypes, debug } = {}) {
  function context() {
    return typeof getContext === 'function' ? getContext() : null;
  }

  return {
    loadSettings() {
      const ctx = context();
      const saved = ctx?.extensionSettings?.[SETTINGS_KEY]
        ?? safeJson(windowRef.localStorage?.getItem(SETTINGS_KEY));
      return mergeSettings(saved);
    },
    saveSettings(settings) {
      const ctx = context();
      if (ctx?.extensionSettings) {
        ctx.extensionSettings[SETTINGS_KEY] = settings;
        ctx.saveSettingsDebounced?.();
      }
      windowRef.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
      debug?.info('settings', '设置已保存', { key: SETTINGS_KEY });
    },
    setProcessedPrompt(text) {
      const ctx = context();
      if (ctx?.setExtensionPrompt) {
        const promptType = extensionPromptTypes?.IN_PROMPT ?? 2;
        ctx.setExtensionPrompt(MODULE_ID, text, promptType, 0, false);
        debug?.info('prompt', '已更新处理后上下文注入块', { length: text.length });
        return true;
      }
      debug?.warn('prompt', '当前宿主未提供 setExtensionPrompt，跳过注入', {});
      return false;
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

import { createCacheKey, createMemoryCacheDriver, createProcessedCacheStore } from './cacheStore.js';
import { MODULE_ID } from './constants.js';
import { createDebugLog } from './debugLog.js';
import { createDispatcher } from './dispatcher.js';
import { createMagicWandItem, mountMagicWandItem, registerSlash777 } from './entrypoints.js';
import { hashSource, hashString } from './hash.js';
import { buildProcessedContextBlock, PROMPT_BLOCK_VERSION, selectRelevantCacheEntries } from './promptContext.js';
import { createHostBridge } from './stBridge.js';
import { createInitialState, updatePanel } from './state.js';
import { estimateTokens } from './tokenEstimate.js';
import { mountPanel } from './ui.js';
import { createDeterministicWorkerAdapter, createTauriTavernAgentWorkerAdapter } from './workerAdapters.js';

const slashRegisteredParsers = new WeakSet();
const slashParserOpeners = new WeakMap();

async function loadSlashRuntime() {
  try {
    const [{ SlashCommandParser }, { SlashCommand }] = await Promise.all([
      import('../../../../slash-commands/SlashCommandParser.js'),
      import('../../../../slash-commands/SlashCommand.js')
    ]);
    return {
      parser: SlashCommandParser,
      commandFactory: (definition) => typeof SlashCommand?.fromProps === 'function'
        ? SlashCommand.fromProps(definition)
        : definition
    };
  } catch (error) {
    return { parser: null, commandFactory: null, error };
  }
}

async function loadStRuntime() {
  try {
    const contextModule = await import('../../../../extensions.js');
    return {
      getContext: contextModule.getContext,
      extensionPromptTypes: contextModule.extension_prompt_types
    };
  } catch (error) {
    return { getContext: null, extensionPromptTypes: null, error };
  }
}

export async function startTtAgentPlus727(windowRef = globalThis, options = {}) {
  const hostWindow = windowRef ?? globalThis;
  const debug = createDebugLog();
  const stRuntime = await loadStRuntime();
  const contextSource = selectContextSource({
    optionsGetContext: options.getContext,
    runtimeGetContext: stRuntime.getContext,
    windowGetContext: hostWindow.getContext
  });
  const promptTypesSource = selectPromptTypesSource({
    optionsExtensionPromptTypes: options.extensionPromptTypes,
    runtimeExtensionPromptTypes: stRuntime.extensionPromptTypes,
    windowExtensionPromptTypes: hostWindow.extension_prompt_types
  });
  if (stRuntime.error) {
    logStRuntimeDiagnostic(debug, {
      error: stRuntime.error,
      hasOptionsGetContext: typeof options.getContext === 'function',
      hasWindowGetContext: typeof hostWindow.getContext === 'function',
      hasOptionsExtensionPromptTypes: options.extensionPromptTypes != null,
      hasWindowExtensionPromptTypes: hostWindow.extension_prompt_types != null,
      contextSource,
      promptTypesSource
    });
  }
  const bridge = createHostBridge({
    windowRef: hostWindow,
    getContext: options.getContext ?? stRuntime.getContext ?? hostWindow.getContext,
    extensionPromptTypes: options.extensionPromptTypes ?? stRuntime.extensionPromptTypes ?? hostWindow.extension_prompt_types,
    debug
  });
  let state = createInitialState({ settings: bridge.loadSettings() });
  const cache = options.cacheStore
    ?? createProcessedCacheStore(options.cacheDriver ?? createMemoryCacheDriver());
  const workerAdapter = state.settings.workerAdapter === 'tauritavern_agent'
    ? createTauriTavernAgentWorkerAdapter(hostWindow, debug)
    : createDeterministicWorkerAdapter();
  const dispatcher = createDispatcher({
    settings: state.settings,
    workerAdapter,
    debug,
    onTaskCompleted: handleTaskCompleted
  });

  let app = null;
  let mounted = null;
  let manualTaskCounter = 0;

  function syncDerivedState() {
    state = {
      ...state,
      tasks: dispatcher.listTasks()
    };
  }

  function render() {
    syncDerivedState();
    if (!mounted || typeof mounted.render !== 'function') return false;
    try {
      const result = mounted.render();
      if (result === false) {
        debug.warn('ui', 'panel render returned false', {});
      }
      return result !== false;
    } catch (error) {
      debug.warn('ui', 'panel render failed', { error: errorMessage(error) });
      return false;
    }
  }

  function openPanel(tab = state.panel.activeTab) {
    state = updatePanel(state, { open: true, activeTab: tab });
    render();
  }

  function closePanel() {
    state = updatePanel(state, { open: false });
    render();
  }

  function setTab(tab) {
    state = updatePanel(state, { activeTab: tab });
    render();
  }

  async function refreshPromptInjection() {
    let entries;
    try {
      entries = await cache.list();
    } catch (error) {
      const message = errorMessage(error);
      debug.error('prompt', 'cache list failed', { error: message });
      state = {
        ...state,
        cacheEntries: [],
        lastInjection: { count: 0, length: 0, error: message }
      };
      setProcessedPrompt('');
      render();
      return '';
    }

    state = { ...state, cacheEntries: entries };
    if (!state.settings.promptInjectionEnabled) {
      setProcessedPrompt('');
      state = { ...state, lastInjection: { count: 0, length: 0 } };
      render();
      return '';
    }

    const selected = selectRelevantCacheEntries(entries, { maxTokens: state.settings.promptBlockMaxTokens });
    const block = buildProcessedContextBlock(selected);
    setProcessedPrompt(block);
    state = { ...state, lastInjection: { count: selected.length, length: block.length } };
    render();
    return block;
  }

  async function handleTaskCompleted(task) {
    const entry = createCacheEntryFromCompletedTask(task, state.settings);
    if (!entry) {
      debug.warn('cache', '完成任务没有可缓存输出', { taskId: task.id });
      return null;
    }

    try {
      const saved = await cache.put(entry);
      debug.info('cache', '处理结果已写入缓存', { taskId: task.id, key: saved.key, tokenEstimate: saved.tokenEstimate });
      await refreshPromptInjection();
      return saved;
    } catch (error) {
      debug.error('cache', '处理结果写入缓存失败', { taskId: task.id, error: errorMessage(error) });
      return null;
    }
  }

  async function pumpDispatcher() {
    await dispatcher.pump();
    syncDerivedState();
    render();
  }

  async function dispatchManualSource(input = {}) {
    const source = normalizeManualSource(input, manualTaskCounter + 1);
    if (!source.content) {
      debug.warn('dispatcher', '手动派发缺少资料内容', {});
      render();
      return null;
    }

    manualTaskCounter += 1;
    const ruleTemplateId = resolveRuleTemplateId(input.ruleTemplateId);
    const task = dispatcher.enqueue({
      id: `manual-${Date.now()}-${manualTaskCounter}`,
      sourceRefs: [source],
      ruleTemplateId,
      depth: 0,
      tokenEstimate: estimateTokens(source.content)
    });
    debug.info('dispatcher', '手动资料已派发', {
      taskId: task.id,
      displayName: source.displayName,
      ruleTemplateId
    });
    state = updatePanel(state, { open: true, activeTab: 'tasks' });
    render();
    await pumpDispatcher();
    return dispatcher.getTask(task.id);
  }

  function setProcessedPrompt(text) {
    try {
      return bridge.setProcessedPrompt(text);
    } catch (error) {
      debug.warn('prompt', 'processed prompt update failed', { error: errorMessage(error) });
      return false;
    }
  }

  function exportDebug() {
    let url = null;
    let urlApi = null;
    try {
      const BlobCtor = hostWindow.Blob;
      urlApi = hostWindow.URL;
      const documentRef = hostWindow.document;

      if (typeof BlobCtor !== 'function') {
        debug.warn('debug', 'Blob unavailable for debug export', {});
        return false;
      }
      if (!urlApi || typeof urlApi.createObjectURL !== 'function') {
        debug.warn('debug', 'URL.createObjectURL unavailable for debug export', {});
        return false;
      }
      if (!documentRef || typeof documentRef.createElement !== 'function') {
        debug.warn('debug', 'document.createElement unavailable for debug export', {});
        return false;
      }

      const blob = new BlobCtor([debug.exportJson()], { type: 'application/json;charset=utf-8' });
      url = urlApi.createObjectURL(blob);
      const anchor = documentRef.createElement('a');
      if (!anchor || typeof anchor !== 'object') {
        debug.warn('debug', 'debug export anchor unavailable', {});
        return false;
      }
      anchor.href = url;
      anchor.download = 'tt-agent-plus-727-debug.json';
      if (typeof anchor.click !== 'function') {
        debug.warn('debug', 'debug export anchor click unavailable', {});
        return false;
      }

      anchor.click();
      return true;
    } catch (error) {
      debug.warn('debug', 'debug export failed', { error: errorMessage(error) });
      return false;
    } finally {
      if (url && urlApi && typeof urlApi.revokeObjectURL === 'function') {
        try {
          urlApi.revokeObjectURL(url);
        } catch (error) {
          debug.warn('debug', 'debug export URL revoke failed', { error: errorMessage(error) });
        }
      }
    }
  }

  if (options.autoMount !== false && hostWindow.document?.body) {
    try {
      mounted = mountPanel({
        documentRef: hostWindow.document,
        getState: () => state,
        getDebugEntries: () => debug.entries(),
        onTab: setTab,
        onClose: closePanel,
        onApprove: (taskId) => {
          dispatcher.approve(taskId);
          pumpDispatcher();
        },
        onCancel: (taskId) => {
          dispatcher.cancel(taskId);
          render();
        },
        onManualDispatch: (payload) => {
          dispatchManualSource(payload).catch((error) => {
            debug.error('dispatcher', '手动派发失败', { error: errorMessage(error) });
            render();
          });
        },
        onExportDebug: exportDebug,
        debug
      });
      if (!mounted || typeof mounted.render !== 'function') {
        debug.warn('ui', 'panel mount returned invalid handle', {});
        mounted = null;
      }
    } catch (error) {
      debug.warn('ui', 'panel mount failed', { error: errorMessage(error) });
      mounted = null;
    }

    try {
      const item = createMagicWandItem({ onOpen: () => openPanel('overview') });
      mountMagicWandItem({ documentRef: hostWindow.document, item, debug });
    } catch (error) {
      debug.warn('entry', 'magic wand mount failed', { error: errorMessage(error) });
    }
  }

  const slashRuntime = options.slashParser
    ? {
        parser: options.slashParser,
        commandFactory: options.slashCommandFactory ?? ((definition) => definition),
        error: null
      }
    : await loadSlashRuntime();

  if (slashRuntime.parser) {
    registerSlashOnce(slashRuntime.parser, {
      commandFactory: slashRuntime.commandFactory ?? ((definition) => definition),
      openLatest: () => {
        const currentApp = app ?? hostWindow.__TT_AGENT_PLUS_727__;
        if (currentApp && typeof currentApp.openPanel === 'function') {
          currentApp.openPanel('overview');
          return;
        }
        openPanel('overview');
      },
      debug
    });
  } else if (slashRuntime.error) {
    debug.warn('entry', '/777 注册失败', { error: errorMessage(slashRuntime.error) });
  }

  debug.info('startup', 'TT-Agent-Plus-727 已启动', { moduleId: MODULE_ID });

  function getStateSnapshot() {
    const snapshot = cloneValue(state);
    snapshot.tasks = cloneValue(dispatcher.listTasks());
    return snapshot;
  }

  app = {
    get state() {
      return getStateSnapshot();
    },
    debug,
    cache,
    dispatcher,
    openPanel,
    closePanel,
    setTab,
    dispatchManualSource,
    refreshPromptInjection,
    pumpDispatcher,
    exportDebug,
    getStateSnapshot
  };

  hostWindow.__TT_AGENT_PLUS_727__ = app;
  hostWindow.__TT_AGENT_PLUS_727_STARTED__ = true;
  return app;

  function resolveRuleTemplateId(candidate) {
    const rules = Array.isArray(state.settings.rules) ? state.settings.rules : [];
    if (typeof candidate === 'string' && rules.some((rule) => rule?.id === candidate)) {
      return candidate;
    }
    return rules.find((rule) => typeof rule?.id === 'string')?.id ?? 'airp-character-default';
  }
}

function normalizeManualSource(input, sequence) {
  const source = input && typeof input === 'object' ? input : {};
  const content = typeof source.content === 'string' ? source.content.trim() : '';
  const displayName = typeof source.displayName === 'string' && source.displayName.trim()
    ? source.displayName.trim()
    : `手动资料 ${sequence}`;

  return {
    kind: 'manual',
    uid: `manual-${hashString(`${displayName}\n${content}`)}`,
    displayName,
    content
  };
}

function createCacheEntryFromCompletedTask(task, settings) {
  const result = task?.result;
  if (!result || typeof result.processedText !== 'string' || !result.processedText.trim()) {
    return null;
  }

  const sourceRefs = Array.isArray(task.sourceRefs) ? cloneValue(task.sourceRefs) : [];
  const rule = Array.isArray(settings?.rules)
    ? settings.rules.find((item) => item?.id === task.ruleTemplateId)
    : null;
  const processedText = result.processedText;
  const timestamp = task.completedAt ?? new Date().toISOString();
  const tokenEstimate = Number.isFinite(result.tokenEstimate) && result.tokenEstimate >= 0
    ? result.tokenEstimate
    : estimateTokens(processedText);

  return {
    key: createCacheKey({
      scopeId: task.scopeId ?? task.chatId ?? 'global',
      sourceHash: hashSourceRefs(sourceRefs),
      ruleTemplateId: task.ruleTemplateId ?? 'unknown-rule',
      ruleVersion: rule?.version ?? task.ruleVersion ?? 1,
      modelProfileId: task.modelProfileId ?? 'current',
      promptVersion: PROMPT_BLOCK_VERSION
    }),
    sourceRefs,
    processedText,
    structuredSummary: cloneValue(result.structuredSummary ?? {}),
    tokenEstimate,
    confidence: typeof result.confidence === 'string' ? result.confidence : 'medium',
    warnings: Array.isArray(result.warnings) ? cloneValue(result.warnings) : [],
    createdAt: timestamp,
    updatedAt: timestamp,
    stale: false,
    invalidationReason: null
  };
}

function hashSourceRefs(sourceRefs) {
  return hashString(sourceRefs.map((source) => hashSource(source)).join('|'));
}

function registerSlashOnce(parser, { commandFactory, openLatest, debug }) {
  const canTrackParser = isWeakSetKey(parser);
  if (canTrackParser) {
    slashParserOpeners.set(parser, openLatest);
  }

  if (canTrackParser && slashRegisteredParsers.has(parser)) {
    debug.info('entry', '/777 already registered', {});
    return false;
  }

  const registered = registerSlash777({
    parser,
    commandFactory,
    onOpen: () => {
      const latestOpen = canTrackParser ? slashParserOpeners.get(parser) : openLatest;
      if (typeof latestOpen === 'function') {
        latestOpen();
        return;
      }
      debug.warn('entry', '/777 latest opener unavailable', {});
    },
    debug
  });
  if (registered && canTrackParser) {
    slashRegisteredParsers.add(parser);
  } else if (!registered && canTrackParser) {
    slashParserOpeners.delete(parser);
  }
  return registered;
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}

function isWeakSetKey(value) {
  return (value !== null && typeof value === 'object') || typeof value === 'function';
}

function selectContextSource({ optionsGetContext, runtimeGetContext, windowGetContext }) {
  if (typeof optionsGetContext === 'function') return 'options';
  if (typeof runtimeGetContext === 'function') return 'runtime';
  if (typeof windowGetContext === 'function') return 'window';
  return 'none';
}

function selectPromptTypesSource({ optionsExtensionPromptTypes, runtimeExtensionPromptTypes, windowExtensionPromptTypes }) {
  if (optionsExtensionPromptTypes != null) return 'options';
  if (runtimeExtensionPromptTypes != null) return 'runtime';
  if (windowExtensionPromptTypes != null) return 'window';
  return 'none';
}

function logStRuntimeDiagnostic(debug, {
  error,
  hasOptionsGetContext,
  hasWindowGetContext,
  hasOptionsExtensionPromptTypes,
  hasWindowExtensionPromptTypes,
  contextSource,
  promptTypesSource
}) {
  const hasContextFallback = contextSource === 'options' || contextSource === 'window';
  const hasPromptTypesFallback = promptTypesSource === 'options' || promptTypesSource === 'window';
  const usingFallback = hasContextFallback && hasPromptTypesFallback;
  const details = {
    error: errorMessage(error),
    hasOptionsGetContext,
    hasWindowGetContext,
    hasOptionsExtensionPromptTypes,
    hasWindowExtensionPromptTypes,
    usingFallback,
    contextSource,
    promptTypesSource
  };
  const level = usingFallback ? 'debug' : 'warn';
  try {
    debug?.[level]?.('host', 'ST context runtime 加载失败', details);
  } catch {
    // Debug logging must never break startup.
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

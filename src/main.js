import {
  createCacheKey,
  createFallbackCacheDriver,
  createLocalStorageCacheDriver,
  createMemoryCacheDriver,
  createProcessedCacheStore
} from './cacheStore.js';
import { MODULE_ID } from './constants.js';
import { createDebugLog } from './debugLog.js';
import { createDispatcher } from './dispatcher.js';
import { createMagicWandItem, mountMagicWandItem, registerSlash777 } from './entrypoints.js';
import { hashSource, hashString } from './hash.js';
import {
  buildProcessedContextBlock,
  collectFullyCoveredSourceRefs,
  isUsableProcessedCacheEntry,
  PROMPT_BLOCK_VERSION,
  selectRelevantCacheEntries
} from './promptContext.js';
import { createHostBridge } from './stBridge.js';
import { createInitialState, updatePanel } from './state.js';
import { estimateTokens } from './tokenEstimate.js';
import { mountPanel } from './ui.js';
import { createDeterministicWorkerAdapter, createTauriTavernAgentWorkerAdapter } from './workerAdapters.js';
import { planSourceBatches } from './workloadPlanner.js';
import {
  removeCoveredWorldInfoEntries,
  resolveWorldInfoScopeId,
  subscribeWorldInfoScans
} from './worldInfoCapture.js';

const slashRegisteredParsers = new WeakSet();
const slashParserOpeners = new WeakMap();
const START_PROMISE_KEY = '__TT_AGENT_PLUS_727_START_PROMISE__';

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

export function startTtAgentPlus727(windowRef = globalThis, options = {}) {
  const hostWindow = windowRef ?? globalThis;
  const inFlightStart = hostWindow?.[START_PROMISE_KEY];
  if (inFlightStart && typeof inFlightStart.then === 'function') return inFlightStart;

  const startPromise = startTtAgentPlus727Internal(hostWindow, options);
  try {
    hostWindow[START_PROMISE_KEY] = startPromise;
  } catch {
    return startPromise;
  }
  const clearStartPromise = () => {
    try {
      if (hostWindow[START_PROMISE_KEY] === startPromise) delete hostWindow[START_PROMISE_KEY];
    } catch {
      // A host may expose a non-configurable global object.
    }
  };
  startPromise.then(clearStartPromise, clearStartPromise);
  return startPromise;
}

async function startTtAgentPlus727Internal(hostWindow, options) {
  try {
    hostWindow.__TT_AGENT_PLUS_727__?.destroy?.();
  } catch {
    // A stale extension instance must not prevent a clean restart.
  }
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
  const getHostContext = options.getContext ?? stRuntime.getContext ?? hostWindow.getContext;
  const bridge = createHostBridge({
    windowRef: hostWindow,
    getContext: getHostContext,
    extensionPromptTypes: options.extensionPromptTypes ?? stRuntime.extensionPromptTypes ?? hostWindow.extension_prompt_types,
    debug
  });
  let state = createInitialState({ settings: bridge.loadSettings() });
  const cache = options.cacheStore
    ?? createProcessedCacheStore(options.cacheDriver ?? createDefaultCacheDriver(hostWindow, debug));
  try {
    state = { ...state, cacheEntries: await cache.list() };
  } catch (error) {
    debug.warn('cache', '启动时读取缓存失败', { error: errorMessage(error) });
  }
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
  let capturedTaskCounter = 0;
  let stopWorldInfoCapture = () => false;
  let worldInfoScanSequence = 0;
  let promptRefreshSequence = 0;
  let destroyed = false;

  function syncDerivedState() {
    state = {
      ...state,
      tasks: dispatcher.listTasks()
    };
  }

  function render() {
    if (destroyed) return false;
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

  async function refreshPromptInjection(options = {}) {
    if (destroyed) return '';
    const refreshSequence = ++promptRefreshSequence;
    let entries;
    try {
      entries = await cache.list();
    } catch (error) {
      if (!canCommitPromptRefresh(refreshSequence, options.scanSequence)) return '';
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

    if (!state.settings.promptInjectionEnabled) {
      if (!canCommitPromptRefresh(refreshSequence, options.scanSequence)) return '';
      state = { ...state, cacheEntries: entries };
      setProcessedPrompt('');
      state = { ...state, lastInjection: { count: 0, length: 0 } };
      render();
      return '';
    }

    const hasExplicitSourceRefs = Object.hasOwn(options, 'activeSourceRefs');
    const hasCapturedScan = state.worldInfoCapture?.capturedAt !== null;
    const shouldFilterSources = hasExplicitSourceRefs || hasCapturedScan;
    const activeSourceRefs = hasExplicitSourceRefs
      ? (Array.isArray(options.activeSourceRefs) ? options.activeSourceRefs : [])
      : (hasCapturedScan ? activeWorldInfoSourceRefs() : undefined);
    const scopeId = typeof options.scopeId === 'string' && options.scopeId
      ? options.scopeId
      : currentScopeId();
    const selected = selectRelevantCacheEntries(entries, {
      maxTokens: state.settings.promptBlockMaxTokens,
      ...(shouldFilterSources ? { activeSourceRefs } : {}),
      scopeId,
      promptVersion: PROMPT_BLOCK_VERSION
    });
    const block = buildProcessedContextBlock(selected);
    if (destroyed) return block;
    const coveredSourceRefs = collectFullyCoveredSourceRefs(selected, activeSourceRefs ?? []);
    const bypassed = state.settings.worldInfoBypassEnabled && options.eventData
      ? removeCoveredWorldInfoEntries(options.eventData, coveredSourceRefs)
      : 0;
    if (!canCommitPromptRefresh(refreshSequence, options.scanSequence)) return block;
    state = { ...state, cacheEntries: entries };
    setProcessedPrompt(block);
    state = {
      ...state,
      lastInjection: {
        count: selected.length,
        length: block.length,
        matchedSources: coveredSourceRefs.length,
        bypassed
      }
    };
    render();
    return block;
  }

  async function handleTaskCompleted(task) {
    if (destroyed) return null;
    const entry = createCacheEntryFromCompletedTask(task, state.settings);
    if (!entry) {
      debug.warn('cache', '完成任务没有可缓存输出', { taskId: task.id });
      return null;
    }

    try {
      const saved = await cache.put(entry);
      if (destroyed) return null;
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
    if (destroyed) return null;
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
      scopeId: currentScopeId(),
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

  async function dispatchCapturedWorldInfo(input = {}) {
    if (destroyed) return emptyCapturedDispatchResult({ staleCapture: true });
    const captureSnapshot = cloneValue(state.worldInfoCapture);
    const captureSequence = worldInfoScanSequence;
    const captureScopeId = captureSnapshot?.scopeId ?? 'global';
    const capturedSources = Array.isArray(captureSnapshot?.entries) ? captureSnapshot.entries : [];
    if (!capturedSources.length) {
      debug.warn('world-info', '当前没有可加工的世界书命中条目', {});
      return emptyCapturedDispatchResult();
    }
    if (captureScopeId !== currentScopeId()) {
      debug.warn('world-info', '本轮世界书捕获已过期，请重新触发扫描', {
        captureScopeId,
        currentScopeId: currentScopeId()
      });
      return emptyCapturedDispatchResult({ staleCapture: true });
    }

    const ruleTemplateId = resolveRuleTemplateId(input.ruleTemplateId);
    const rule = state.settings.rules.find((item) => item?.id === ruleTemplateId) ?? {};
    const maxTokens = Math.min(
      state.settings.maxWorkerInputTokens,
      Number.isFinite(rule.maxInputTokens) ? rule.maxInputTokens : state.settings.maxWorkerInputTokens
    );
    const batches = planSourceBatches(capturedSources, { maxTokens });
    const taskIds = [];
    let cacheHits = 0;
    let inFlight = 0;
    let staleCapture = false;

    for (const batch of batches) {
      if (!isCaptureCurrent(captureSequence, captureScopeId)) {
        staleCapture = true;
        break;
      }
      const descriptor = {
        scopeId: captureScopeId,
        sourceRefs: batch.sourceRefs,
        ruleTemplateId,
        ruleVersion: rule.version ?? 1,
        modelProfileId: rule.modelProfileId ?? 'current',
        depth: 0,
        tokenEstimate: batch.tokenEstimate
      };
      const cacheDescriptor = createTaskCacheDescriptor(descriptor, state.settings);
      const cacheKey = createCacheKey(cacheDescriptor);
      const cached = await cache.get(cacheKey);
      if (!isCaptureCurrent(captureSequence, captureScopeId)) {
        staleCapture = true;
        break;
      }
      if (cacheEntryMatchesDescriptor(cached, cacheDescriptor)) {
        cacheHits += 1;
        continue;
      }
      if (cached && typeof cache.remove === 'function') {
        try {
          await cache.remove(cacheKey);
          debug.warn('cache', '已移除无效缓存记录', { key: cacheKey });
        } catch (error) {
          debug.warn('cache', '无效缓存记录移除失败', { key: cacheKey, error: errorMessage(error) });
        }
      }
      if (!isCaptureCurrent(captureSequence, captureScopeId)) {
        staleCapture = true;
        break;
      }
      const existingTask = dispatcher.listTasks().find((task) => (
        task.cacheKey === cacheKey
        && ['queued', 'running', 'awaiting_approval'].includes(task.state)
      ));
      if (existingTask) {
        inFlight += 1;
        continue;
      }

      capturedTaskCounter += 1;
      const task = dispatcher.enqueue({
        ...descriptor,
        id: `world-info-${Date.now()}-${capturedTaskCounter}`,
        cacheKey
      });
      taskIds.push(task.id);
    }

    debug.info('world-info', '世界书命中条目已规划', {
      sources: capturedSources.length,
      planned: batches.length,
      enqueued: taskIds.length,
      cacheHits,
      inFlight,
      maxTokens
    });
    state = updatePanel(state, { open: true, activeTab: 'tasks' });
    render();
    if (taskIds.length) await pumpDispatcher();
    if (isCaptureCurrent(captureSequence, captureScopeId)) {
      await refreshPromptInjection({
        activeSourceRefs: capturedSources,
        scopeId: captureScopeId,
        scanSequence: captureSequence
      });
    } else {
      staleCapture = true;
    }

    return {
      planned: batches.length,
      enqueued: taskIds.length,
      cacheHits,
      inFlight,
      taskIds,
      staleCapture
    };
  }

  async function handleWorldInfoCapture(capture, eventData) {
    if (destroyed || !state.settings.worldInfoCaptureEnabled) return;
    const scanSequence = ++worldInfoScanSequence;
    state = { ...state, worldInfoCapture: capture };
    debug.info('world-info', '已捕获本轮世界书命中条目', {
      scopeId: capture.scopeId,
      entries: capture.entries.length,
      totalTokens: capture.totalTokens,
      overflowed: capture.budget.overflowed
    });
    await refreshPromptInjection({
      activeSourceRefs: capture.entries,
      scopeId: capture.scopeId,
      eventData,
      scanSequence
    });
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
        onCapturedDispatch: (payload) => {
          dispatchCapturedWorldInfo(payload).catch((error) => {
            debug.error('world-info', '本轮世界书加工失败', { error: errorMessage(error) });
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
    dispatchCapturedWorldInfo,
    refreshPromptInjection,
    pumpDispatcher,
    exportDebug,
    getStateSnapshot,
    destroy() {
      if (destroyed) return false;
      destroyed = true;
      worldInfoScanSequence += 1;
      promptRefreshSequence += 1;
      return stopWorldInfoCapture();
    }
  };

  stopWorldInfoCapture = subscribeWorldInfoScans({
    getContext: getHostContext,
    onCapture: handleWorldInfoCapture,
    debug
  });

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

  function activeWorldInfoSourceRefs() {
    return Array.isArray(state.worldInfoCapture?.entries) ? state.worldInfoCapture.entries : [];
  }

  function currentScopeId() {
    try {
      const scopeId = resolveWorldInfoScopeId(getHostContext?.());
      if (scopeId !== 'global') return scopeId;
    } catch {
      // Fall back to the last captured scope.
    }
    return state.worldInfoCapture?.scopeId ?? 'global';
  }

  function canCommitPromptRefresh(refreshSequence, scanSequence) {
    const currentRefresh = refreshSequence === promptRefreshSequence;
    const currentScan = !Number.isInteger(scanSequence) || scanSequence === worldInfoScanSequence;
    return !destroyed && currentRefresh && currentScan;
  }

  function isCaptureCurrent(captureSequence, scopeId) {
    return Boolean(
      !destroyed
      && captureSequence === worldInfoScanSequence
      && state.worldInfoCapture?.scopeId === scopeId
      && currentScopeId() === scopeId
    );
  }
}

function createDefaultCacheDriver(windowRef, debug) {
  const memoryDriver = createMemoryCacheDriver();
  try {
    const storage = windowRef?.localStorage;
    if (
      storage
      && typeof storage.getItem === 'function'
      && typeof storage.setItem === 'function'
      && typeof storage.removeItem === 'function'
      && typeof storage.key === 'function'
      && Number.isFinite(Number(storage.length))
    ) {
      const probeKey = `__tt_agent_plus_727_probe__${Date.now()}_${Math.random()}`;
      storage.setItem(probeKey, '1');
      storage.removeItem(probeKey);
      return createFallbackCacheDriver(
        createLocalStorageCacheDriver(storage),
        memoryDriver,
        (error) => debug?.warn?.('cache', 'localStorage 运行失败，已切换到内存缓存', {
          error: errorMessage(error)
        })
      );
    }
  } catch (error) {
    debug?.warn?.('cache', 'localStorage 不可用，已回退到内存缓存', { error: errorMessage(error) });
    // Fall back to an in-memory cache when browser storage is blocked.
  }
  return memoryDriver;
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
  const descriptor = createTaskCacheDescriptor(task, settings);
  const tokenEstimate = Number.isFinite(result.tokenEstimate) && result.tokenEstimate >= 0
    ? result.tokenEstimate
    : estimateTokens(processedText);

  return {
    key: createCacheKey(descriptor),
    scopeId: descriptor.scopeId,
    sourceHash: descriptor.sourceHash,
    ruleTemplateId: descriptor.ruleTemplateId,
    ruleVersion: descriptor.ruleVersion,
    modelProfileId: descriptor.modelProfileId,
    promptVersion: descriptor.promptVersion,
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

function createTaskCacheKey(task, settings) {
  return createCacheKey(createTaskCacheDescriptor(task, settings));
}

function createTaskCacheDescriptor(task, settings) {
  const sourceRefs = Array.isArray(task?.sourceRefs) ? task.sourceRefs : [];
  const rule = Array.isArray(settings?.rules)
    ? settings.rules.find((item) => item?.id === task?.ruleTemplateId)
    : null;
  return {
    scopeId: task?.scopeId ?? task?.chatId ?? 'global',
    sourceHash: hashSourceRefs(sourceRefs),
    ruleTemplateId: task?.ruleTemplateId ?? 'unknown-rule',
    ruleVersion: rule?.version ?? task?.ruleVersion ?? 1,
    modelProfileId: task?.modelProfileId ?? 'current',
    promptVersion: PROMPT_BLOCK_VERSION
  };
}

function hashSourceRefs(sourceRefs) {
  return hashString(sourceRefs.map((source) => hashSource(source)).join('|'));
}

function cacheEntryMatchesDescriptor(entry, descriptor) {
  const storedDescriptor = {
    scopeId: entry?.scopeId,
    sourceHash: entry?.sourceHash,
    ruleTemplateId: entry?.ruleTemplateId,
    ruleVersion: entry?.ruleVersion,
    modelProfileId: entry?.modelProfileId,
    promptVersion: entry?.promptVersion
  };
  return Boolean(
    isUsableProcessedCacheEntry(entry)
    && entry.sourceHash === hashSourceRefs(entry.sourceRefs)
    && entry.key === createCacheKey(storedDescriptor)
    && entry.scopeId === descriptor.scopeId
    && entry.sourceHash === descriptor.sourceHash
    && entry.ruleTemplateId === descriptor.ruleTemplateId
    && entry.ruleVersion === descriptor.ruleVersion
    && entry.modelProfileId === descriptor.modelProfileId
    && entry.promptVersion === descriptor.promptVersion
  );
}

function emptyCapturedDispatchResult(overrides = {}) {
  return {
    planned: 0,
    enqueued: 0,
    cacheHits: 0,
    inFlight: 0,
    taskIds: [],
    staleCapture: false,
    ...overrides
  };
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

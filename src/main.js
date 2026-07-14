import {
  createCacheKey,
  createFallbackCacheDriver,
  createLocalStorageCacheDriver,
  createMemoryCacheDriver,
  createProcessedCacheStore
} from './cacheStore.js';
import {
  createCharacterWorldInfoRepository,
  createStWorldInfoLoader
} from './characterWorldInfo.js';
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
import {
  BUILTIN_ALL_WORLD_INFO_RULE_ID,
  filterWorldInfoEntries,
  normalizeWorldInfoRule,
  summarizeWorldInfoFilter
} from './worldInfoRules.js';
import {
  filterCatalogEntries,
  invertVisibleSelection,
  selectVisibleEntries
} from './worldInfoRuleEditor.js';

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
  const worldInfoRepository = options.worldInfoRepository ?? createCharacterWorldInfoRepository({
    getContext: getHostContext,
    loadWorldInfo: options.loadWorldInfo ?? createStWorldInfoLoader({
      fetchFn: typeof hostWindow.fetch === 'function' ? hostWindow.fetch.bind(hostWindow) : undefined,
      getContext: getHostContext
    })
  });
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
  let worldInfoRefreshSequence = 0;
  let promptRefreshSequence = 0;
  let worldInfoPromptContextSequence = 0;
  let worldInfoRuleCounter = 0;
  let destroyed = false;
  const initialWorldInfoRule = normalizeWorldInfoRule(
    state.settings.worldInfoRules.find((rule) => rule?.id === BUILTIN_ALL_WORLD_INFO_RULE_ID)
  );
  let activeWorldInfoPromptContext = {
    token: worldInfoPromptContextSequence,
    ready: true,
    worldInfoRuleId: initialWorldInfoRule.id,
    worldInfoRuleVersion: initialWorldInfoRule.version,
    scanSequence: null,
    catalogGeneration: null,
    characterRef: '',
    worldRef: ''
  };

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
    const refreshWorldInfo = prepareRulesCatalogRefresh(tab);
    render();
    if (refreshWorldInfo) void refreshActiveCharacterWorldInfo();
  }

  function closePanel() {
    state = updatePanel(state, { open: false });
    render();
  }

  function setTab(tab) {
    state = updatePanel(state, { activeTab: tab });
    const refreshWorldInfo = prepareRulesCatalogRefresh(tab);
    render();
    if (refreshWorldInfo) void refreshActiveCharacterWorldInfo();
  }

  function prepareRulesCatalogRefresh(tab) {
    if (tab !== 'rules') return false;
    state = {
      ...state,
      worldInfoCatalogStatus: { loading: true, error: '' }
    };
    return true;
  }

  function setRuleView(view) {
    const nextView = view === 'world-info' ? 'world-info' : 'ai';
    state = { ...state, ruleView: nextView };
    render();
    return nextView;
  }

  function newWorldInfoRule() {
    const worldRef = safeString(state.worldInfoCatalog?.worldRef);
    if (!worldRef) return false;
    const id = createWorldInfoRuleId();
    state = {
      ...state,
      ruleView: 'world-info',
      worldInfoRuleEditor: {
        view: 'edit',
        editingId: id,
        search: '',
        draft: {
          id,
          name: '新世界书规则',
          mode: 'exclude',
          worldRef,
          entryUids: [],
          version: 0,
          builtin: false
        }
      }
    };
    render();
    return true;
  }

  function editWorldInfoRule(ruleId) {
    const id = safeString(ruleId);
    const rule = state.settings.worldInfoRules.find((item) => item?.id === id);
    if (!rule) return false;
    state = {
      ...state,
      ruleView: 'world-info',
      worldInfoRuleEditor: {
        view: 'edit',
        editingId: id,
        search: '',
        draft: cloneValue(rule)
      }
    };
    render();
    return true;
  }

  function updateWorldInfoRuleDraft(patch = {}) {
    const editor = state.worldInfoRuleEditor;
    if (editor?.view !== 'edit' || !editor.draft || !patch || typeof patch !== 'object') return false;
    const nextPatch = {};
    const updatesName = Object.hasOwn(patch, 'name');
    const updatesMode = Object.hasOwn(patch, 'mode');
    if (updatesName) nextPatch.name = typeof patch.name === 'string' ? patch.name : '';
    if (updatesMode) nextPatch.mode = patch.mode === 'include' ? 'include' : 'exclude';
    state = {
      ...state,
      worldInfoRuleEditor: {
        ...editor,
        draft: { ...editor.draft, ...nextPatch }
      }
    };
    if (updatesMode) render();
    return true;
  }

  function setWorldInfoSearch(query) {
    const editor = state.worldInfoRuleEditor;
    if (editor?.view !== 'edit') return false;
    state = {
      ...state,
      worldInfoRuleEditor: {
        ...editor,
        search: typeof query === 'string' ? query : ''
      }
    };
    render();
    return true;
  }

  function selectAllWorldInfoEntries() {
    return updateVisibleWorldInfoSelection(selectVisibleEntries);
  }

  function invertWorldInfoEntries() {
    return updateVisibleWorldInfoSelection(invertVisibleSelection);
  }

  function updateVisibleWorldInfoSelection(selectionAction) {
    const editor = state.worldInfoRuleEditor;
    if (editor?.view !== 'edit' || !editor.draft) return false;
    const visible = filterCatalogEntries(state.worldInfoCatalog?.entries, editor.search);
    if (!visible.length) return false;
    const entryUids = selectionAction(editor.draft.entryUids, visible);
    state = {
      ...state,
      worldInfoRuleEditor: {
        ...editor,
        draft: { ...editor.draft, entryUids }
      }
    };
    render();
    return true;
  }

  function toggleWorldInfoEntry(uid, checked) {
    const editor = state.worldInfoRuleEditor;
    const normalizedUid = safeUid(uid);
    if (editor?.view !== 'edit' || !editor.draft || !normalizedUid) return false;
    const selected = new Set((Array.isArray(editor.draft.entryUids) ? editor.draft.entryUids : [])
      .map(safeUid)
      .filter(Boolean));
    if (checked === true) selected.add(normalizedUid);
    else selected.delete(normalizedUid);
    state = {
      ...state,
      worldInfoRuleEditor: {
        ...editor,
        draft: { ...editor.draft, entryUids: [...selected] }
      }
    };
    render();
    return true;
  }

  function saveWorldInfoRule() {
    const editor = state.worldInfoRuleEditor;
    if (editor?.view !== 'edit' || !editor.draft) return null;
    const ruleId = safeString(editor.editingId) || safeString(editor.draft.id);
    if (!ruleId) return null;
    const existingIndex = state.settings.worldInfoRules.findIndex((rule) => rule?.id === ruleId);
    const existing = existingIndex >= 0 ? state.settings.worldInfoRules[existingIndex] : null;
    const version = nextWorldInfoRuleVersion(existing?.version);
    const normalized = normalizeWorldInfoRule({
      ...editor.draft,
      id: ruleId,
      worldRef: existing?.builtin === true
        ? existing.worldRef
        : (safeString(editor.draft.worldRef) || safeString(state.worldInfoCatalog?.worldRef)),
      version,
      builtin: existing?.builtin === true
    });
    const worldInfoRules = state.settings.worldInfoRules.map((rule, index) => (
      index === existingIndex ? normalized : rule
    ));
    if (existingIndex < 0) worldInfoRules.push(normalized);
    const settings = bridge.saveSettings({ ...state.settings, worldInfoRules });
    state = {
      ...state,
      settings,
      worldInfoRuleEditor: emptyWorldInfoRuleEditor()
    };
    render();
    return cloneValue(settings.worldInfoRules.find((rule) => rule.id === ruleId) ?? normalized);
  }

  function deleteWorldInfoRule(ruleId) {
    const id = safeString(ruleId);
    const target = state.settings.worldInfoRules.find((rule) => rule?.id === id);
    if (!target || target.builtin === true || id === BUILTIN_ALL_WORLD_INFO_RULE_ID) return false;
    const worldInfoRules = state.settings.worldInfoRules.filter((rule) => rule?.id !== id);
    const rules = state.settings.rules.map((rule) => (
      rule?.worldInfoRuleId === id
        ? { ...rule, worldInfoRuleId: BUILTIN_ALL_WORLD_INFO_RULE_ID }
        : rule
    ));
    const settings = bridge.saveSettings({ ...state.settings, worldInfoRules, rules });
    state = {
      ...state,
      settings,
      worldInfoRuleEditor: emptyWorldInfoRuleEditor()
    };
    render();
    return true;
  }

  function cancelWorldInfoRule() {
    if (state.worldInfoRuleEditor?.view !== 'edit') return false;
    state = { ...state, worldInfoRuleEditor: emptyWorldInfoRuleEditor() };
    render();
    return true;
  }

  function createWorldInfoRuleId() {
    const existingIds = new Set(state.settings.worldInfoRules.map((rule) => rule?.id));
    let id;
    do {
      worldInfoRuleCounter += 1;
      id = `world-info-rule-${Date.now().toString(36)}-${worldInfoRuleCounter.toString(36)}`;
    } while (existingIds.has(id));
    return id;
  }

  function emptyWorldInfoRuleEditor() {
    return { view: 'list', editingId: null, search: '', draft: null };
  }

  function nextWorldInfoRuleVersion(currentVersion) {
    if (!Number.isInteger(currentVersion) || currentVersion < 1) return 1;
    return currentVersion >= 999999 ? 1 : currentVersion + 1;
  }

  async function refreshPromptInjection(options = {}) {
    if (destroyed) return '';
    const requestedOptions = options && typeof options === 'object' ? options : {};
    if (!isPendingWorldInfoScanRefreshCurrent(requestedOptions)) return '';
    const effectiveOptions = resolvePromptRefreshOptions(requestedOptions);
    const activeScopeId = currentScopeId();
    const requestedScopeId = safeString(safeProperty(effectiveOptions, 'scopeId'));
    if (!activeScopeId || (requestedScopeId && requestedScopeId !== activeScopeId)) {
      promptRefreshSequence += 1;
      debug.warn('prompt', '缺少当前聊天标识或请求了其他聊天作用域，已清空提示词注入', {
        hasActiveScope: Boolean(activeScopeId),
        requestedForeignScope: Boolean(requestedScopeId && requestedScopeId !== activeScopeId)
      });
      setProcessedPrompt('');
      state = { ...state, lastInjection: { count: 0, length: 0, error: 'invalid_chat_scope' } };
      render();
      return '';
    }
    const worldInfoContextCurrent = isPromptRefreshContextCurrent(effectiveOptions);
    if (hasExplicitWorldInfoRefreshContext(requestedOptions) && !worldInfoContextCurrent) return '';
    const refreshSequence = ++promptRefreshSequence;
    let entries;
    try {
      entries = await cache.list();
    } catch (error) {
      if (!canCommitPromptRefresh(
        refreshSequence,
        effectiveOptions,
        worldInfoContextCurrent,
        activeScopeId
      )) return '';
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
      if (!canCommitPromptRefresh(
        refreshSequence,
        effectiveOptions,
        worldInfoContextCurrent,
        activeScopeId
      )) return '';
      state = { ...state, cacheEntries: entries };
      setProcessedPrompt('');
      state = { ...state, lastInjection: { count: 0, length: 0 } };
      render();
      return '';
    }

    const hasExplicitSourceRefs = Object.hasOwn(effectiveOptions, 'activeSourceRefs');
    const hasCapturedScan = state.worldInfoCapture?.capturedAt !== null;
    const shouldFilterSources = hasExplicitSourceRefs || hasCapturedScan;
    const activeSourceRefs = hasExplicitSourceRefs
      ? (Array.isArray(effectiveOptions.activeSourceRefs) ? effectiveOptions.activeSourceRefs : [])
      : (hasCapturedScan ? activeWorldInfoSourceRefs() : undefined);
    const ruleScopedEntries = worldInfoContextCurrent
      ? filterCacheEntriesByWorldInfoRule(entries, effectiveOptions)
      : entries.filter((entry) => !isWorldInfoCacheEntry(entry));
    const selectionSourceRefs = Array.isArray(activeSourceRefs)
      ? [...activeSourceRefs, ...collectNonWorldInfoCacheSourceRefs(ruleScopedEntries)]
      : activeSourceRefs;
    const selected = selectRelevantCacheEntries(ruleScopedEntries, {
      maxTokens: state.settings.promptBlockMaxTokens,
      ...(shouldFilterSources ? { activeSourceRefs: selectionSourceRefs } : {}),
      scopeId: activeScopeId,
      promptVersion: PROMPT_BLOCK_VERSION
    });
    const block = buildProcessedContextBlock(selected);
    if (destroyed) return block;
    const coveredSourceRefs = collectFullyCoveredSourceRefs(selected, activeSourceRefs ?? []);
    const bypassed = state.settings.worldInfoBypassEnabled && effectiveOptions.eventData
      ? removeCoveredWorldInfoEntries(effectiveOptions.eventData, coveredSourceRefs)
      : 0;
    if (!canCommitPromptRefresh(
      refreshSequence,
      effectiveOptions,
      worldInfoContextCurrent,
      activeScopeId
    )) return '';
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
      await refreshPromptInjection(taskWorldInfoRuleFilter(task));
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

  async function refreshActiveCharacterWorldInfo() {
    const catalogRead = await readActiveCharacterWorldInfo();
    if (catalogRead.succeeded && catalogRead.current) {
      reconcileActiveWorldInfoPromptContext(catalogRead.catalog, catalogRead.generation);
    }
    return catalogRead.catalog;
  }

  async function readActiveCharacterWorldInfo() {
    const generation = ++worldInfoRefreshSequence;
    let catalog;
    let succeeded = true;
    let readError = null;
    try {
      catalog = normalizeWorldInfoCatalog(await worldInfoRepository.readActive());
    } catch (error) {
      succeeded = false;
      readError = error;
      safeDebug(debug, 'warn', 'world-info', '读取当前角色世界书目录失败', {
        error: safeErrorMessage(error)
      });
      catalog = emptyWorldInfoCatalog();
    }

    const current = !destroyed && generation === worldInfoRefreshSequence;
    if (current) {
      state = {
        ...state,
        worldInfoCatalog: cloneValue(catalog),
        worldInfoCatalogStatus: {
          loading: false,
          error: succeeded ? '' : `读取当前角色世界书失败：${safeErrorMessage(readError)}`
        }
      };
      render();
    }
    return { catalog: cloneValue(catalog), generation, current, succeeded };
  }

  async function loadWorldInfoCatalogForScan() {
    try {
      return {
        catalog: normalizeWorldInfoCatalog(await worldInfoRepository.readActive()),
        succeeded: true
      };
    } catch (error) {
      safeDebug(debug, 'warn', 'world-info', '读取当前角色世界书目录失败', {
        error: safeErrorMessage(error)
      });
      return { catalog: emptyWorldInfoCatalog(), succeeded: false };
    }
  }

  async function dispatchManualSource(input = {}) {
    if (destroyed) return null;
    const source = normalizeManualSource(input, manualTaskCounter + 1);
    if (!source.content) {
      debug.warn('dispatcher', '手动派发缺少资料内容', {});
      render();
      return null;
    }
    const scopeId = currentScopeId();
    if (!scopeId) {
      debug.warn('dispatcher', '缺少稳定聊天标识，已拒绝手动派发', {});
      render();
      return null;
    }

    manualTaskCounter += 1;
    const ruleTemplateId = resolveRuleTemplateId(input.ruleTemplateId);
    const task = dispatcher.enqueue({
      id: `manual-${Date.now()}-${manualTaskCounter}`,
      scopeId,
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
    const captureSequence = captureSnapshot?.scanSequence;
    const captureScopeId = safeString(captureSnapshot?.scopeId);
    const capturedSources = Array.isArray(captureSnapshot?.entries) ? captureSnapshot.entries : [];
    const ruleTemplateId = resolveRuleTemplateId(input.ruleTemplateId);
    const ruleTemplate = state.settings.rules.find((item) => item?.id === ruleTemplateId) ?? {};
    const worldInfoRule = resolveWorldInfoRule(input, ruleTemplate.worldInfoRuleId);
    if (!isDispatchCaptureReady(captureSnapshot, captureSequence, captureScopeId)) {
      debug.warn('world-info', '本轮世界书捕获尚未就绪或已过期', {
        captureScopeId,
        currentScopeId: currentScopeId(),
        scanSequence: Number.isInteger(captureSequence) ? captureSequence : null,
        currentScanSequence: worldInfoScanSequence,
        identityReady: captureSnapshot?.identityReady === true
      });
      return emptyCapturedDispatchResult({
        ...summarizeWorldInfoFilter(capturedSources, []),
        worldInfoRuleId: worldInfoRule.id,
        worldInfoRuleVersion: worldInfoRule.version,
        staleCapture: true
      });
    }
    const previousPromptContext = { ...activeWorldInfoPromptContext };
    const promptContextToken = activateWorldInfoPromptRule(worldInfoRule, captureSequence);
    if (!capturedSources.length) {
      debug.warn('world-info', '当前没有可加工的世界书命中条目', {});
      bindActiveWorldInfoPromptContext(promptContextToken, {
        scanSequence: captureSequence,
        catalogGeneration: activeWorldInfoPromptContext.catalogGeneration,
        characterRef: captureSnapshot?.characterRef,
        worldRef: captureSnapshot?.worldRef
      });
      await refreshPromptInjection({
        activeSourceRefs: [],
        scopeId: captureScopeId,
        scanSequence: captureSequence,
        ...(Number.isInteger(activeWorldInfoPromptContext.catalogGeneration)
          ? { catalogGeneration: activeWorldInfoPromptContext.catalogGeneration }
          : {}),
        promptContextToken,
        worldInfoRuleId: worldInfoRule.id,
        worldInfoRuleVersion: worldInfoRule.version
      });
      return emptyCapturedDispatchResult({
        worldInfoRuleId: worldInfoRule.id,
        worldInfoRuleVersion: worldInfoRule.version
      });
    }
    if (captureScopeId !== currentScopeId()) {
      restoreActiveWorldInfoPromptContext(promptContextToken, previousPromptContext);
      debug.warn('world-info', '本轮世界书捕获已过期，请重新触发扫描', {
        captureScopeId,
        currentScopeId: currentScopeId()
      });
      return emptyCapturedDispatchResult({
        worldInfoRuleId: worldInfoRule.id,
        worldInfoRuleVersion: worldInfoRule.version,
        staleCapture: true
      });
    }

    const catalogRead = await readActiveCharacterWorldInfo();
    const catalog = catalogRead.catalog;
    if (
      !catalogRead.succeeded
      || !catalogRead.current
      || !isWorldInfoDispatchCurrent(captureSequence, captureScopeId, catalogRead.generation)
    ) {
      const invalidatedPromptContext = invalidateActiveWorldInfoPromptRule(promptContextToken, {
        scanSequence: captureSequence,
        catalogGeneration: catalogRead.generation,
        characterRef: catalog.characterRef,
        worldRef: catalog.worldRef
      });
      if (invalidatedPromptContext) await refreshPromptInjection();
      return emptyCapturedDispatchResult({
        ...summarizeWorldInfoFilter(capturedSources, []),
        worldInfoRuleId: worldInfoRule.id,
        worldInfoRuleVersion: worldInfoRule.version,
        staleCapture: true
      });
    }
    bindActiveWorldInfoPromptContext(promptContextToken, {
      scanSequence: captureSequence,
      catalogGeneration: catalogRead.generation,
      characterRef: catalog.characterRef,
      worldRef: catalog.worldRef
    });
    if (!captureIdentityMatchesCatalog(captureSnapshot, catalog)) {
      invalidateActiveWorldInfoPromptRule(promptContextToken, {
        scanSequence: captureSequence,
        catalogGeneration: catalogRead.generation,
        characterRef: catalog.characterRef,
        worldRef: catalog.worldRef
      });
      safeDebug(debug, 'warn', 'world-info', '世界书捕获身份与当前角色目录不一致', {
        captureCharacterRef: safeString(captureSnapshot?.characterRef),
        captureWorldRef: safeString(captureSnapshot?.worldRef),
        currentCharacterRef: safeString(catalog.characterRef),
        currentWorldRef: safeString(catalog.worldRef)
      });
      await refreshPromptInjection();
      return emptyCapturedDispatchResult({
        ...summarizeWorldInfoFilter(capturedSources, []),
        worldInfoRuleId: worldInfoRule.id,
        worldInfoRuleVersion: worldInfoRule.version,
        staleCapture: true
      });
    }
    if (!catalog.worldName) {
      safeDebug(debug, 'warn', 'world-info', '当前角色未绑定可用世界书目录', {
        characterRef: catalog.characterRef,
        worldRef: catalog.worldRef,
        ruleId: worldInfoRule.id
      });
    }
    let filteredSources = [];
    try {
      filteredSources = filterWorldInfoEntries(capturedSources, worldInfoRule, catalog);
    } catch (error) {
      safeDebug(debug, 'warn', 'world-info', '世界书条目过滤失败，已阻止派发', {
        error: safeErrorMessage(error),
        ruleId: worldInfoRule.id
      });
    }
    const filterSummary = summarizeWorldInfoFilter(capturedSources, filteredSources);
    safeDebug(debug, 'info', 'world-info', '世界书条目过滤', {
      characterRef: safeString(catalog.characterRef),
      worldRef: safeString(catalog.worldRef),
      ruleId: worldInfoRule.id,
      mode: worldInfoRule.mode,
      ...filterSummary,
      ...summarizeInvalidWorldInfoRuleUids(worldInfoRule, catalog)
    });

    if (!filteredSources.length) {
      await refreshPromptInjection({
        activeSourceRefs: [],
        scopeId: captureScopeId,
        scanSequence: captureSequence,
        catalogGeneration: catalogRead.generation,
        promptContextToken,
        worldInfoRuleId: worldInfoRule.id,
        worldInfoRuleVersion: worldInfoRule.version
      });
      return emptyCapturedDispatchResult({
        ...filterSummary,
        worldInfoRuleId: worldInfoRule.id,
        worldInfoRuleVersion: worldInfoRule.version,
        staleCapture: !isWorldInfoDispatchCurrent(
          captureSequence,
          captureScopeId,
          catalogRead.generation
        )
      });
    }

    const maxTokens = Math.min(
      state.settings.maxWorkerInputTokens,
      Number.isFinite(ruleTemplate.maxInputTokens)
        ? ruleTemplate.maxInputTokens
        : state.settings.maxWorkerInputTokens
    );
    const batches = planSourceBatches(filteredSources, { maxTokens });
    const taskIds = [];
    let cacheHits = 0;
    let inFlight = 0;
    let staleCapture = false;

    for (const batch of batches) {
      if (!isWorldInfoDispatchCurrent(captureSequence, captureScopeId, catalogRead.generation)) {
        staleCapture = true;
        break;
      }
      const descriptor = {
        scopeId: captureScopeId,
        sourceRefs: batch.sourceRefs,
        ruleTemplateId,
        ruleVersion: ruleTemplate.version ?? 1,
        worldInfoRuleId: worldInfoRule.id,
        worldInfoRuleVersion: worldInfoRule.version,
        worldInfoCatalogGeneration: catalogRead.generation,
        worldInfoPromptContextToken: promptContextToken,
        modelProfileId: ruleTemplate.modelProfileId ?? 'current',
        depth: 0,
        tokenEstimate: batch.tokenEstimate
      };
      const cacheDescriptor = createTaskCacheDescriptor(descriptor, state.settings);
      const cacheKey = createCacheKey(cacheDescriptor);
      const cached = await cache.get(cacheKey);
      if (!isWorldInfoDispatchCurrent(captureSequence, captureScopeId, catalogRead.generation)) {
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
      if (!isWorldInfoDispatchCurrent(captureSequence, captureScopeId, catalogRead.generation)) {
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
      sources: filteredSources.length,
      planned: batches.length,
      enqueued: taskIds.length,
      cacheHits,
      inFlight,
      maxTokens
    });
    state = updatePanel(state, { open: true, activeTab: 'tasks' });
    render();
    if (taskIds.length) await pumpDispatcher();
    if (isWorldInfoDispatchCurrent(captureSequence, captureScopeId, catalogRead.generation)) {
      await refreshPromptInjection({
        activeSourceRefs: filteredSources,
        scopeId: captureScopeId,
        scanSequence: captureSequence,
        catalogGeneration: catalogRead.generation,
        promptContextToken,
        worldInfoRuleId: worldInfoRule.id,
        worldInfoRuleVersion: worldInfoRule.version
      });
      if (!isWorldInfoDispatchCurrent(captureSequence, captureScopeId, catalogRead.generation)) {
        staleCapture = true;
      }
    } else {
      staleCapture = true;
    }

    return {
      planned: batches.length,
      enqueued: taskIds.length,
      cacheHits,
      inFlight,
      taskIds,
      staleCapture,
      ...filterSummary,
      worldInfoRuleId: worldInfoRule.id,
      worldInfoRuleVersion: worldInfoRule.version
    };
  }

  async function handleWorldInfoCapture(capture, eventData) {
    if (destroyed || !state.settings.worldInfoCaptureEnabled) return;
    const scanSequence = ++worldInfoScanSequence;
    invalidateActiveWorldInfoPromptContext(scanSequence);
    const pendingCapture = {
      ...capture,
      scanSequence,
      identityReady: false,
      catalogGeneration: null,
      characterRef: '',
      worldRef: ''
    };
    state = { ...state, worldInfoCapture: pendingCapture };
    render();

    const refreshGenerationAtStart = worldInfoRefreshSequence;
    const catalogReadPromise = loadWorldInfoCatalogForScan();
    await refreshPromptInjection({
      activeSourceRefs: [],
      scopeId: capture.scopeId,
      pendingWorldInfoScanSequence: scanSequence
    });
    const catalogRead = await catalogReadPromise;
    if (!isWorldInfoScanBindingCurrent(scanSequence)) {
      return;
    }
    if (!catalogRead.succeeded) {
      await refreshPromptInjection();
      return;
    }
    const characterRef = safeString(catalogRead.catalog.characterRef);
    const worldRef = safeString(catalogRead.catalog.worldRef);
    const identityBound = Boolean(characterRef && worldRef);
    const catalogRefreshUnchanged = refreshGenerationAtStart === worldInfoRefreshSequence;
    const catalogMatchesCurrent = captureIdentityMatchesCatalog(
      { characterRef, worldRef },
      state.worldInfoCatalog
    );
    const promptIdentityReady = Boolean(
      identityBound
      && (catalogRefreshUnchanged || catalogMatchesCurrent)
      && currentScopeId() === capture.scopeId
    );
    const boundCapture = {
      ...capture,
      scanSequence,
      identityReady: identityBound,
      catalogGeneration: worldInfoRefreshSequence,
      characterRef: identityBound ? characterRef : '',
      worldRef: identityBound ? worldRef : ''
    };
    state = {
      ...state,
      worldInfoCapture: boundCapture,
      ...(catalogRefreshUnchanged ? { worldInfoCatalog: cloneValue(catalogRead.catalog) } : {})
    };
    const promptContextToken = bindWorldInfoScanPromptContext({
      identityReady: promptIdentityReady,
      scanSequence,
      catalogGeneration: worldInfoRefreshSequence,
      characterRef: boundCapture.characterRef,
      worldRef: boundCapture.worldRef
    });
    debug.info('world-info', '已捕获本轮世界书命中条目', {
      scopeId: boundCapture.scopeId,
      entries: boundCapture.entries.length,
      totalTokens: boundCapture.totalTokens,
      overflowed: boundCapture.budget.overflowed,
      characterRef: boundCapture.characterRef,
      worldRef: boundCapture.worldRef
    });
    if (promptIdentityReady) {
      await refreshPromptInjection({
        activeSourceRefs: boundCapture.entries,
        scopeId: boundCapture.scopeId,
        eventData,
        scanSequence,
        catalogGeneration: worldInfoRefreshSequence,
        promptContextToken
      });
    } else {
      await refreshPromptInjection();
    }
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
        onRuleView: setRuleView,
        onNewWorldInfoRule: newWorldInfoRule,
        onEditWorldInfoRule: editWorldInfoRule,
        onDeleteWorldInfoRule: deleteWorldInfoRule,
        onWorldInfoRuleSearch: setWorldInfoSearch,
        onWorldInfoRuleSelectAll: selectAllWorldInfoEntries,
        onWorldInfoRuleInvert: invertWorldInfoEntries,
        onWorldInfoRuleToggleEntry: toggleWorldInfoEntry,
        onWorldInfoRuleDraft: updateWorldInfoRuleDraft,
        onSaveWorldInfoRule: saveWorldInfoRule,
        onCancelWorldInfoRule: cancelWorldInfoRule,
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
    setRuleView,
    newWorldInfoRule,
    editWorldInfoRule,
    updateWorldInfoRuleDraft,
    setWorldInfoSearch,
    selectAllWorldInfoEntries,
    invertWorldInfoEntries,
    toggleWorldInfoEntry,
    saveWorldInfoRule,
    deleteWorldInfoRule,
    cancelWorldInfoRule,
    dispatchManualSource,
    dispatchCapturedWorldInfo,
    refreshActiveCharacterWorldInfo,
    refreshPromptInjection,
    pumpDispatcher,
    exportDebug,
    getStateSnapshot,
    destroy() {
      if (destroyed) return false;
      destroyed = true;
      worldInfoScanSequence += 1;
      worldInfoRefreshSequence += 1;
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

  function resolveWorldInfoRule(input, templateRuleId) {
    const hasExplicitRuleId = safeHasOwn(input, 'worldInfoRuleId');
    const rawRuleId = hasExplicitRuleId ? safeProperty(input, 'worldInfoRuleId') : templateRuleId;
    const candidate = typeof rawRuleId === 'string' ? rawRuleId.trim() : '';
    const rules = Array.isArray(state.settings.worldInfoRules) ? state.settings.worldInfoRules : [];
    const selected = rules.find((rule) => rule?.id === candidate)
      ?? rules.find((rule) => rule?.id === BUILTIN_ALL_WORLD_INFO_RULE_ID)
      ?? { id: BUILTIN_ALL_WORLD_INFO_RULE_ID, version: 1, mode: 'exclude', entryUids: [] };
    return normalizeWorldInfoRule(selected);
  }

  function activeWorldInfoSourceRefs() {
    const capture = state.worldInfoCapture;
    if (
      safeString(capture?.characterRef) !== activeWorldInfoPromptContext.characterRef
      || safeString(capture?.worldRef) !== activeWorldInfoPromptContext.worldRef
      || !activeWorldInfoPromptContext.characterRef
      || !activeWorldInfoPromptContext.worldRef
    ) {
      return [];
    }
    return Array.isArray(capture?.entries) ? capture.entries : [];
  }

  function currentScopeId() {
    try {
      return safeString(resolveWorldInfoScopeId(getHostContext?.()));
    } catch {
      return '';
    }
  }

  function activateWorldInfoPromptRule(rule, scanSequence) {
    const token = ++worldInfoPromptContextSequence;
    activeWorldInfoPromptContext = {
      ...activeWorldInfoPromptContext,
      token,
      ready: false,
      worldInfoRuleId: rule.id,
      worldInfoRuleVersion: rule.version,
      scanSequence: Number.isInteger(scanSequence) ? scanSequence : null,
      catalogGeneration: activeWorldInfoPromptContext.catalogGeneration
    };
    return token;
  }

  function bindActiveWorldInfoPromptContext(token, {
    scanSequence,
    catalogGeneration,
    characterRef,
    worldRef
  } = {}) {
    if (activeWorldInfoPromptContext.token !== token) return false;
    activeWorldInfoPromptContext = {
      ...activeWorldInfoPromptContext,
      ready: true,
      scanSequence: Number.isInteger(scanSequence) ? scanSequence : null,
      catalogGeneration: Number.isInteger(catalogGeneration) ? catalogGeneration : null,
      characterRef: safeString(characterRef),
      worldRef: safeString(worldRef)
    };
    return true;
  }

  function bindWorldInfoScanPromptContext({
    identityReady,
    scanSequence,
    catalogGeneration,
    characterRef,
    worldRef
  } = {}) {
    const token = ++worldInfoPromptContextSequence;
    activeWorldInfoPromptContext = {
      ...activeWorldInfoPromptContext,
      token,
      ready: identityReady === true,
      scanSequence: Number.isInteger(scanSequence) ? scanSequence : null,
      catalogGeneration: Number.isInteger(catalogGeneration) ? catalogGeneration : null,
      characterRef: safeString(characterRef),
      worldRef: safeString(worldRef)
    };
    return token;
  }

  function invalidateActiveWorldInfoPromptRule(token, {
    scanSequence,
    catalogGeneration,
    characterRef,
    worldRef
  } = {}) {
    if (activeWorldInfoPromptContext.token !== token) return false;
    activeWorldInfoPromptContext = {
      ...activeWorldInfoPromptContext,
      token: ++worldInfoPromptContextSequence,
      ready: false,
      scanSequence: Number.isInteger(scanSequence) ? scanSequence : null,
      catalogGeneration: Number.isInteger(catalogGeneration) ? catalogGeneration : null,
      characterRef: safeString(characterRef),
      worldRef: safeString(worldRef)
    };
    return true;
  }

  function restoreActiveWorldInfoPromptContext(token, previousContext) {
    if (activeWorldInfoPromptContext.token !== token) return false;
    activeWorldInfoPromptContext = {
      ...previousContext,
      token: ++worldInfoPromptContextSequence
    };
    return true;
  }

  function reconcileActiveWorldInfoPromptContext(catalog, catalogGeneration) {
    const characterRef = safeString(catalog?.characterRef);
    const worldRef = safeString(catalog?.worldRef);
    const sameIdentity = Boolean(
      characterRef
      && worldRef
      && characterRef === activeWorldInfoPromptContext.characterRef
      && worldRef === activeWorldInfoPromptContext.worldRef
    );
    const captureConfirmsIdentity = Boolean(
      state.worldInfoCapture?.identityReady === true
      && state.worldInfoCapture?.scanSequence === activeWorldInfoPromptContext.scanSequence
      && captureIdentityMatchesCatalog(state.worldInfoCapture, catalog)
    );
    activeWorldInfoPromptContext = {
      ...activeWorldInfoPromptContext,
      ...(sameIdentity
        ? { ready: activeWorldInfoPromptContext.ready || captureConfirmsIdentity }
        : { token: ++worldInfoPromptContextSequence, ready: false }),
      catalogGeneration: Number.isInteger(catalogGeneration) ? catalogGeneration : null,
      characterRef,
      worldRef
    };
  }

  function invalidateActiveWorldInfoPromptContext(scanSequence) {
    const token = ++worldInfoPromptContextSequence;
    activeWorldInfoPromptContext = {
      ...activeWorldInfoPromptContext,
      token,
      ready: false,
      scanSequence: Number.isInteger(scanSequence) ? scanSequence : null,
      catalogGeneration: activeWorldInfoPromptContext.catalogGeneration
    };
    return token;
  }

  function resolvePromptRefreshOptions(options) {
    const source = options && typeof options === 'object' ? options : {};
    const resolved = { ...source };
    const hasRuleFilter = safeHasOwn(source, 'worldInfoRuleId')
      || safeHasOwn(source, 'worldInfoRuleVersion');
    if (!hasRuleFilter) {
      resolved.worldInfoRuleId = activeWorldInfoPromptContext.worldInfoRuleId;
      resolved.worldInfoRuleVersion = activeWorldInfoPromptContext.worldInfoRuleVersion;
    }
    if (
      !safeHasOwn(source, 'scanSequence')
      && Number.isInteger(activeWorldInfoPromptContext.scanSequence)
    ) {
      resolved.scanSequence = activeWorldInfoPromptContext.scanSequence;
    }
    if (
      !safeHasOwn(source, 'catalogGeneration')
      && Number.isInteger(activeWorldInfoPromptContext.catalogGeneration)
    ) {
      resolved.catalogGeneration = activeWorldInfoPromptContext.catalogGeneration;
    }
    if (!safeHasOwn(source, 'promptContextToken')) {
      resolved.promptContextToken = activeWorldInfoPromptContext.token;
    }
    return resolved;
  }

  function isPromptRefreshContextCurrent(options = {}) {
    const currentScan = !Number.isInteger(options.scanSequence)
      || options.scanSequence === worldInfoScanSequence;
    const currentCatalog = !Number.isInteger(options.catalogGeneration)
      || options.catalogGeneration === worldInfoRefreshSequence;
    const currentPromptContext = !Number.isInteger(options.promptContextToken)
      || (
        options.promptContextToken === activeWorldInfoPromptContext.token
        && activeWorldInfoPromptContext.ready
      );
    return !destroyed && currentScan && currentCatalog && currentPromptContext;
  }

  function canCommitPromptRefresh(
    refreshSequence,
    options = {},
    requireWorldInfoContext = true,
    expectedScopeId = ''
  ) {
    const currentRefresh = refreshSequence === promptRefreshSequence;
    return Boolean(
      !destroyed
      && currentRefresh
      && expectedScopeId
      && currentScopeId() === expectedScopeId
      && isPendingWorldInfoScanRefreshCurrent(options)
      && (!requireWorldInfoContext || isPromptRefreshContextCurrent(options))
    );
  }

  function isPendingWorldInfoScanRefreshCurrent(options = {}) {
    const pendingScanSequence = options?.pendingWorldInfoScanSequence;
    return !Number.isInteger(pendingScanSequence)
      || (
        !destroyed
        && pendingScanSequence === worldInfoScanSequence
        && state.worldInfoCapture?.scanSequence === pendingScanSequence
        && state.worldInfoCapture?.identityReady === false
      );
  }

  function isDispatchCaptureReady(capture, captureSequence, scopeId) {
    return Boolean(
      scopeId
      && capture?.capturedAt != null
      && capture?.identityReady === true
      && Number.isInteger(captureSequence)
      && captureSequence === worldInfoScanSequence
      && state.worldInfoCapture?.scanSequence === captureSequence
      && state.worldInfoCapture?.identityReady === true
      && state.worldInfoCapture?.scopeId === scopeId
      && currentScopeId() === scopeId
    );
  }

  function isCaptureCurrent(captureSequence, scopeId) {
    return Boolean(
      scopeId
      && !destroyed
      && captureSequence === worldInfoScanSequence
      && state.worldInfoCapture?.scanSequence === captureSequence
      && state.worldInfoCapture?.identityReady === true
      && state.worldInfoCapture?.scopeId === scopeId
      && currentScopeId() === scopeId
    );
  }

  function isWorldInfoScanBindingCurrent(scanSequence) {
    return Boolean(
      !destroyed
      && scanSequence === worldInfoScanSequence
      && state.worldInfoCapture?.scanSequence === scanSequence
      && state.worldInfoCapture?.identityReady === false
    );
  }

  function isWorldInfoDispatchCurrent(captureSequence, scopeId, catalogGeneration) {
    return catalogGeneration === worldInfoRefreshSequence
      && isCaptureCurrent(captureSequence, scopeId);
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

function taskWorldInfoRuleFilter(task) {
  const worldInfoRuleId = safeString(safeProperty(task, 'worldInfoRuleId'));
  const worldInfoRuleVersion = safeProperty(task, 'worldInfoRuleVersion');
  const catalogGeneration = safeProperty(task, 'worldInfoCatalogGeneration');
  const promptContextToken = safeProperty(task, 'worldInfoPromptContextToken');
  if (!worldInfoRuleId || !Number.isInteger(worldInfoRuleVersion)) return {};
  return {
    worldInfoRuleId,
    worldInfoRuleVersion,
    ...(Number.isInteger(catalogGeneration) ? { catalogGeneration } : {}),
    ...(Number.isInteger(promptContextToken) ? { promptContextToken } : {})
  };
}

function hasExplicitWorldInfoRefreshContext(options) {
  return [
    'worldInfoRuleId',
    'worldInfoRuleVersion',
    'scanSequence',
    'catalogGeneration',
    'promptContextToken'
  ].some((key) => safeHasOwn(options, key));
}

function filterCacheEntriesByWorldInfoRule(entries, options) {
  if (!Array.isArray(entries)) return [];
  const hasRuleId = safeHasOwn(options, 'worldInfoRuleId');
  const hasRuleVersion = safeHasOwn(options, 'worldInfoRuleVersion');
  if (!hasRuleId && !hasRuleVersion) return entries;

  const ruleId = safeString(safeProperty(options, 'worldInfoRuleId'));
  const ruleVersion = safeProperty(options, 'worldInfoRuleVersion');
  return entries.filter((entry) => {
    if (!isWorldInfoCacheEntry(entry)) return true;
    const entryRuleId = safeString(safeProperty(entry, 'worldInfoRuleId'))
      || BUILTIN_ALL_WORLD_INFO_RULE_ID;
    const storedRuleVersion = safeProperty(entry, 'worldInfoRuleVersion');
    const entryRuleVersion = Number.isInteger(storedRuleVersion) ? storedRuleVersion : 1;
    return (!hasRuleId || entryRuleId === ruleId)
      && (!hasRuleVersion || entryRuleVersion === ruleVersion);
  });
}

function isWorldInfoCacheEntry(entry) {
  const sourceRefs = safeProperty(entry, 'sourceRefs');
  return Array.isArray(sourceRefs) && sourceRefs.some(
    (sourceRef) => (
      safeProperty(sourceRef, 'kind') === 'world_info'
      || Boolean(safeString(safeProperty(sourceRef, 'world')))
    )
  );
}

function collectNonWorldInfoCacheSourceRefs(entries) {
  const sourceRefs = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (isWorldInfoCacheEntry(entry)) continue;
    const entrySourceRefs = safeProperty(entry, 'sourceRefs');
    if (Array.isArray(entrySourceRefs)) sourceRefs.push(...entrySourceRefs);
  }
  return sourceRefs;
}

function emptyWorldInfoCatalog() {
  return {
    characterRef: '',
    characterName: '',
    worldRef: '',
    worldName: '',
    entries: []
  };
}

function captureIdentityMatchesCatalog(capture, catalog) {
  const captureCharacterRef = safeString(safeProperty(capture, 'characterRef'));
  const captureWorldRef = safeString(safeProperty(capture, 'worldRef'));
  const catalogCharacterRef = safeString(safeProperty(catalog, 'characterRef'));
  const catalogWorldRef = safeString(safeProperty(catalog, 'worldRef'));
  return Boolean(
    captureCharacterRef
    && captureWorldRef
    && captureCharacterRef === catalogCharacterRef
    && captureWorldRef === catalogWorldRef
  );
}

function normalizeWorldInfoCatalog(input) {
  const source = input && typeof input === 'object' ? input : {};
  const rawEntries = safeProperty(source, 'entries');
  const entries = Array.isArray(rawEntries)
    ? rawEntries.map(normalizeWorldInfoCatalogEntry).filter(Boolean)
    : [];
  return {
    characterRef: safeString(safeProperty(source, 'characterRef')),
    characterName: safeString(safeProperty(source, 'characterName')),
    worldRef: safeString(safeProperty(source, 'worldRef')),
    worldName: safeString(safeProperty(source, 'worldName')),
    entries
  };
}

function normalizeWorldInfoCatalogEntry(input) {
  if (!input || typeof input !== 'object') return null;
  const uid = safeUid(safeProperty(input, 'uid'));
  if (!uid) return null;
  return {
    uid,
    displayName: safeString(safeProperty(input, 'displayName')),
    content: safeString(safeProperty(input, 'content')),
    disabled: safeProperty(input, 'disabled') === true,
    constant: safeProperty(input, 'constant') === true
  };
}

function summarizeInvalidWorldInfoRuleUids(rule, catalog) {
  const available = new Set(
    (Array.isArray(catalog?.entries) ? catalog.entries : [])
      .map((entry) => safeUid(safeProperty(entry, 'uid')))
      .filter(Boolean)
  );
  let invalidUidCount = 0;
  const invalidUidSample = [];
  for (const value of Array.isArray(rule?.entryUids) ? rule.entryUids : []) {
    const uid = safeUid(value);
    if (!uid || available.has(uid)) continue;
    invalidUidCount += 1;
    if (invalidUidSample.length < 50) invalidUidSample.push(uid);
  }
  return { invalidUidCount, invalidUidSample };
}

function safeProperty(value, key) {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
}

function safeHasOwn(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  try {
    return Object.hasOwn(value, key);
  } catch {
    return true;
  }
}

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeUid(value) {
  if (typeof value === 'string') return value.trim();
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function safeDebug(debug, level, channel, message, details) {
  try {
    debug?.[level]?.(channel, message, details);
  } catch {
    // Diagnostics must not interrupt filtering or dispatch.
  }
}

function safeErrorMessage(error) {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return 'unknown error';
  }
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
  if (!descriptor.scopeId) return null;
  const tokenEstimate = Number.isFinite(result.tokenEstimate) && result.tokenEstimate >= 0
    ? result.tokenEstimate
    : estimateTokens(processedText);

  return {
    key: createCacheKey(descriptor),
    scopeId: descriptor.scopeId,
    sourceHash: descriptor.sourceHash,
    ruleTemplateId: descriptor.ruleTemplateId,
    ruleVersion: descriptor.ruleVersion,
    worldInfoRuleId: descriptor.worldInfoRuleId,
    worldInfoRuleVersion: descriptor.worldInfoRuleVersion,
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
  const worldInfoRuleId = task?.worldInfoRuleId ?? BUILTIN_ALL_WORLD_INFO_RULE_ID;
  const worldInfoRule = Array.isArray(settings?.worldInfoRules)
    ? settings.worldInfoRules.find((item) => item?.id === worldInfoRuleId)
    : null;
  return {
    scopeId: safeString(task?.scopeId) || safeString(task?.chatId),
    sourceHash: hashSourceRefs(sourceRefs),
    ruleTemplateId: task?.ruleTemplateId ?? 'unknown-rule',
    ruleVersion: rule?.version ?? task?.ruleVersion ?? 1,
    worldInfoRuleId,
    worldInfoRuleVersion: worldInfoRule?.version ?? task?.worldInfoRuleVersion ?? 1,
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
    worldInfoRuleId: entry?.worldInfoRuleId,
    worldInfoRuleVersion: entry?.worldInfoRuleVersion,
    modelProfileId: entry?.modelProfileId,
    promptVersion: entry?.promptVersion
  };
  let expectedStoredKey;
  try {
    expectedStoredKey = createCacheKey(storedDescriptor);
  } catch {
    return false;
  }
  return Boolean(
    isUsableProcessedCacheEntry(entry)
    && entry.sourceHash === hashSourceRefs(entry.sourceRefs)
    && entry.key === expectedStoredKey
    && entry.scopeId === descriptor.scopeId
    && entry.sourceHash === descriptor.sourceHash
    && entry.ruleTemplateId === descriptor.ruleTemplateId
    && entry.ruleVersion === descriptor.ruleVersion
    && entry.worldInfoRuleId === descriptor.worldInfoRuleId
    && entry.worldInfoRuleVersion === descriptor.worldInfoRuleVersion
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
    captured: 0,
    passed: 0,
    excluded: 0,
    worldInfoRuleId: BUILTIN_ALL_WORLD_INFO_RULE_ID,
    worldInfoRuleVersion: 1,
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

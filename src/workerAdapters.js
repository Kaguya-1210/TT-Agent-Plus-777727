const DEFAULT_AGENT_WAIT_TIMEOUT_MS = 120000;
const WORKSPACE_OUTPUT_PATH = 'output/main.md';

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeSourceRefs(sourceRefs) {
  return Array.isArray(sourceRefs)
    ? sourceRefs.filter((source) => source && typeof source === 'object')
    : [];
}

function sourceText(source) {
  const value = source.content ?? source.processedText ?? '';
  return typeof value === 'string' ? value : String(value);
}

export function createDeterministicWorkerAdapter() {
  return {
    async run(task) {
      const sourceRefs = normalizeSourceRefs(task.sourceRefs);
      const names = sourceRefs.map((source) => source.displayName || source.uid || source.kind).filter(Boolean).join('、') || '未命名资料';
      const facts = sourceRefs
        .map((source) => sourceText(source))
        .filter(Boolean)
        .map((content) => content.slice(0, 220));

      return {
        processedText: [
          `【TT-Agent-Plus-727 已处理资料】${names}`,
          ...facts.map((fact, index) => `${index + 1}. ${fact}`)
        ].join('\n'),
        structuredSummary: { sourceNames: names, facts },
        warnings: [],
        confidence: 'medium'
      };
    }
  };
}

export function createTauriTavernAgentWorkerAdapter(windowRef, debug, options = {}) {
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || DEFAULT_AGENT_WAIT_TIMEOUT_MS);

  return {
    async run(task) {
      const ready = windowRef?.__TAURITAVERN__?.ready ?? windowRef?.__TAURITAVERN_MAIN_READY__;
      if (ready) await ready;

      const agent = windowRef?.__TAURITAVERN__?.api?.agent;
      if (!agent?.startRunFromLegacyGenerate || !agent?.subscribe || !agent?.readWorkspaceFile) {
        throw new Error('当前宿主未暴露可用的 TauriTavern Agent 后台接口');
      }

      const profileId = task.modelProfileId && task.modelProfileId !== 'current' ? task.modelProfileId : null;
      debug?.info('worker', '启动 TT Agent 后台 worker', { taskId: task.id, profileId });
      const run = await agent.startRunFromLegacyGenerate({
        profileId,
        generationType: 'normal',
        generationIntent: {
          source: 'TT-Agent-Plus-727',
          taskId: task.id,
          ruleTemplateId: task.ruleTemplateId,
          sourceRefs: task.sourceRefs
        },
        options: {
          stream: false,
          presentation: 'background'
        }
      });
      if (typeof run?.runId !== 'string' || !run.runId) {
        throw new Error('TT Agent 后台 worker 未返回有效 runId');
      }

      await waitForAgentCompletion(agent, run.runId, debug, { timeoutMs });

      let output;
      try {
        output = await agent.readWorkspaceFile({ runId: run.runId, path: WORKSPACE_OUTPUT_PATH });
      } catch (error) {
        throw new Error(`读取 TT Agent 输出失败 runId=${run.runId} path=${WORKSPACE_OUTPUT_PATH}: ${errorMessage(error)}`);
      }
      if (typeof output?.text !== 'string') {
        throw new Error(`TT Agent 输出无效 runId=${run.runId} path=${WORKSPACE_OUTPUT_PATH}: text must be string`);
      }

      return {
        processedText: output.text,
        structuredSummary: { runId: run.runId, workspaceId: run.workspaceId },
        warnings: [],
        confidence: 'medium'
      };
    }
  };
}

async function waitForAgentCompletion(agent, runId, debug, { timeoutMs = DEFAULT_AGENT_WAIT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = null;
    let stop = () => {};

    function safeStop() {
      const unsubscribe = stop;
      stop = () => {};
      if (typeof unsubscribe !== 'function') return;
      try {
        unsubscribe();
      } catch (error) {
        debug?.warn('worker-event', 'unsubscribe_failed', { runId, error: errorMessage(error) });
      }
    }

    function settle(callback, value) {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      safeStop();
      callback(value);
    }

    timeoutId = setTimeout(() => {
      debug?.warn('worker-event', 'run_timeout', { runId, timeoutMs });
      settle(reject, new Error(`TT Agent 后台 worker 超时: runId=${runId}, timeoutMs=${timeoutMs}`));
    }, timeoutMs);

    try {
      const unsubscribe = agent.subscribe(runId, (event = {}) => {
        const type = event.type ?? 'unknown';
        debug?.debug('worker-event', type, { runId, payload: event.payload });
        if (type === 'run_completed') {
          settle(resolve, { status: 'completed' });
        }
        if (type === 'run_failed' || type === 'run_cancelled') {
          settle(reject, new Error(event.payload?.message ?? type));
        }
      }, {
        intervalMs: 500,
        limit: 100,
        onError(error) {
          debug?.error('worker-event', 'subscribe_error', { runId, error: errorMessage(error) });
          settle(reject, error instanceof Error ? error : new Error(errorMessage(error)));
        }
      });
      stop = typeof unsubscribe === 'function' ? unsubscribe : () => {};
      if (settled) safeStop();
    } catch (error) {
      settle(reject, error);
    }
  });
}

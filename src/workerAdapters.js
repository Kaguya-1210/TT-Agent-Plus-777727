export function createDeterministicWorkerAdapter() {
  return {
    async run(task) {
      const names = task.sourceRefs.map((source) => source.displayName || source.uid || source.kind).join('、') || '未命名资料';
      const facts = task.sourceRefs
        .map((source) => source.content || source.processedText || '')
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

export function createTauriTavernAgentWorkerAdapter(windowRef, debug) {
  return {
    async run(task) {
      const ready = windowRef.__TAURITAVERN__?.ready ?? windowRef.__TAURITAVERN_MAIN_READY__;
      if (ready) await ready;

      const agent = windowRef.__TAURITAVERN__?.api?.agent;
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

      const completed = await waitForAgentCompletion(agent, run.runId, debug);
      if (completed.status === 'failed') {
        throw new Error(completed.message || 'TT Agent 后台 worker 失败');
      }

      const output = await agent.readWorkspaceFile({ runId: run.runId, path: 'output/main.md' });
      return {
        processedText: output.text,
        structuredSummary: { runId: run.runId, workspaceId: run.workspaceId },
        warnings: [],
        confidence: 'medium'
      };
    }
  };
}

async function waitForAgentCompletion(agent, runId, debug) {
  return new Promise((resolve) => {
    let stop = () => {};
    stop = agent.subscribe(runId, (event) => {
      debug?.debug('worker-event', event.type, { runId, payload: event.payload });
      if (event.type === 'run_completed') {
        stop();
        resolve({ status: 'completed' });
      }
      if (event.type === 'run_failed' || event.type === 'run_cancelled') {
        stop();
        resolve({ status: 'failed', message: event.payload?.message ?? event.type });
      }
    }, { intervalMs: 500, limit: 100 });
  });
}

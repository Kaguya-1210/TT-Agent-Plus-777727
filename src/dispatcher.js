import { APPROVAL_MODES, TASK_STATES } from './constants.js';

const DISPATCHER_OWNED_FIELDS = [
  'state',
  'approved',
  'createdAt',
  'startedAt',
  'completedAt',
  'cancelledAt',
  'approvalRequestedAt',
  'approvedAt',
  'result',
  'error'
];

function nowIso() {
  return new Date().toISOString();
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

function cloneTask(task) {
  return cloneValue(task);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function createDispatcher({ settings, workerAdapter, debug }) {
  const tasks = new Map();
  const activeRuns = new Set();
  let totalDispatches = 0;

  function enqueue(input) {
    if (!input?.id) {
      throw new Error('任务必须提供 id');
    }
    if (tasks.has(input.id)) {
      throw new Error(`任务已存在: ${input.id}`);
    }

    const task = {
      ...input,
      parentTaskId: input.parentTaskId ?? null,
      modelProfileId: input.modelProfileId ?? 'current'
    };
    for (const field of DISPATCHER_OWNED_FIELDS) {
      delete task[field];
    }
    task.state = TASK_STATES.QUEUED;
    task.createdAt = nowIso();
    task.approved = false;
    tasks.set(task.id, task);
    debug?.info('dispatcher', '任务进入队列', { taskId: task.id });
    return cloneTask(task);
  }

  function getTask(id) {
    const task = tasks.get(id);
    return task ? cloneTask(task) : null;
  }

  function listTasks() {
    return Array.from(tasks.values()).map((task) => cloneTask(task));
  }

  function approve(id) {
    const task = tasks.get(id);
    if (!task || task.state !== TASK_STATES.AWAITING_APPROVAL) {
      return false;
    }

    task.approved = true;
    task.approvedAt = nowIso();
    task.state = TASK_STATES.QUEUED;
    debug?.info('approval', '任务已批准', { taskId: id });
    return true;
  }

  function cancel(id) {
    const task = tasks.get(id);
    if (!task || ![TASK_STATES.QUEUED, TASK_STATES.AWAITING_APPROVAL].includes(task.state)) {
      return false;
    }

    task.state = TASK_STATES.CANCELLED;
    task.cancelledAt = nowIso();
    debug?.warn('dispatcher', '任务已取消', { taskId: id });
    return true;
  }

  async function pump() {
    const capacity = Math.max(0, (settings.globalConcurrency ?? 1) - activeRuns.size);
    const started = [];

    for (const task of tasks.values()) {
      if (started.length >= capacity) break;
      if (task.state !== TASK_STATES.QUEUED) continue;

      const hardLimitError = getHardLimitError(task);
      if (hardLimitError) {
        failWithoutRun(task, hardLimitError);
        continue;
      }

      if (requiresApproval(task)) {
        task.state = TASK_STATES.AWAITING_APPROVAL;
        task.approvalRequestedAt = nowIso();
        debug?.warn('approval', '任务等待用户确认', { taskId: task.id, approvalMode: settings.approvalMode });
        continue;
      }

      started.push(runTask(task));
    }

    return Promise.allSettled(started);
  }

  function getHardLimitError(task) {
    if (task.depth > settings.maxDepth) {
      return `超过最大派发深度: ${task.depth} > ${settings.maxDepth}`;
    }
    if (totalDispatches >= settings.maxTotalDispatches) {
      return `超过全局派发上限: ${totalDispatches} >= ${settings.maxTotalDispatches}`;
    }
    return null;
  }

  function requiresApproval(task) {
    if (task.approved) return false;
    if (settings.approvalMode === APPROVAL_MODES.OFF) return false;
    if (settings.approvalMode === APPROVAL_MODES.EVERY_DISPATCH) return true;
    if (settings.approvalMode === APPROVAL_MODES.AFTER_THRESHOLD) {
      return totalDispatches >= settings.dispatchConfirmThreshold;
    }
    if (settings.approvalMode === APPROVAL_MODES.PAID_API_ONLY) {
      // Product policy: paid_api_only also confirms after the global dispatch threshold.
      return isPaidProfile(task.modelProfileId) || totalDispatches >= settings.dispatchConfirmThreshold;
    }
    return false;
  }

  function isPaidProfile(modelProfileId) {
    return Array.isArray(settings.paidApiProfileIds) && settings.paidApiProfileIds.includes(modelProfileId);
  }

  function failWithoutRun(task, message) {
    task.state = TASK_STATES.FAILED;
    task.error = message;
    task.completedAt = nowIso();
    debug?.error('dispatcher', message, { taskId: task.id });
  }

  async function runTask(task) {
    activeRuns.add(task.id);
    totalDispatches += 1;
    task.state = TASK_STATES.RUNNING;
    task.startedAt = nowIso();
    debug?.info('dispatcher', '任务开始执行', { taskId: task.id, totalDispatches });

    try {
      task.result = await workerAdapter.run(task);
      task.state = TASK_STATES.COMPLETED;
      task.completedAt = nowIso();
      debug?.info('dispatcher', '任务执行完成', { taskId: task.id });
    } catch (error) {
      task.state = TASK_STATES.FAILED;
      task.error = errorMessage(error);
      task.completedAt = nowIso();
      debug?.error('dispatcher', '任务执行失败', { taskId: task.id, error: task.error });
    } finally {
      activeRuns.delete(task.id);
    }
  }

  return {
    enqueue,
    getTask,
    listTasks,
    approve,
    cancel,
    pump
  };
}

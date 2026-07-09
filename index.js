import { startTtAgentPlus727 } from './src/main.js';

startTtAgentPlus727(globalThis).catch((error) => {
  console.error('[TT-Agent-Plus-727] 启动失败', error);
});

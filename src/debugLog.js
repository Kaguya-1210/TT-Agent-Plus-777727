export function createDebugLog(now = () => new Date().toISOString()) {
  const items = [];

  function record(level, channel, message, details = {}) {
    const entry = {
      seq: items.length + 1,
      timestamp: now(),
      level,
      channel,
      message,
      details
    };
    items.push(entry);
    return entry;
  }

  return {
    record,
    debug: (channel, message, details) => record('debug', channel, message, details),
    info: (channel, message, details) => record('info', channel, message, details),
    warn: (channel, message, details) => record('warn', channel, message, details),
    error: (channel, message, details) => record('error', channel, message, details),
    entries: () => items.slice(),
    clear: () => {
      items.length = 0;
    },
    exportJson: () => JSON.stringify(items, null, 2)
  };
}

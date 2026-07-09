function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}

function cloneEntry(entry) {
  return {
    ...entry,
    details: cloneValue(entry.details)
  };
}

export function createDebugLog(now = () => new Date().toISOString()) {
  const items = [];

  function record(level, channel, message, details = {}) {
    const entry = {
      seq: items.length + 1,
      timestamp: now(),
      level,
      channel,
      message,
      details: cloneValue(details)
    };
    items.push(entry);
    return cloneEntry(entry);
  }

  return {
    record,
    debug: (channel, message, details) => record('debug', channel, message, details),
    info: (channel, message, details) => record('info', channel, message, details),
    warn: (channel, message, details) => record('warn', channel, message, details),
    error: (channel, message, details) => record('error', channel, message, details),
    entries: () => items.map((entry) => cloneEntry(entry)),
    clear: () => {
      items.length = 0;
    },
    exportJson: () => JSON.stringify(items, null, 2)
  };
}

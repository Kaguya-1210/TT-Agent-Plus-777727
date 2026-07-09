function cloneJson(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function parseStoredValue(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function createCacheKey({ scopeId, sourceHash, ruleTemplateId, ruleVersion, modelProfileId, promptVersion }) {
  return [
    scopeId || 'global',
    sourceHash,
    ruleTemplateId,
    `rv${ruleVersion}`,
    modelProfileId || 'current',
    `pv${promptVersion}`
  ].join('::');
}

export function createMemoryCacheDriver(seed = {}) {
  const map = new Map(Object.entries(seed).map(([key, value]) => [key, cloneJson(value)]));
  return {
    async get(key) {
      const value = map.get(key);
      return value == null ? null : cloneJson(value);
    },
    async set(key, value) {
      map.set(key, cloneJson(value));
    },
    async remove(key) {
      map.delete(key);
    },
    async values() {
      return Array.from(map.values()).map((value) => cloneJson(value));
    },
    async clear() {
      map.clear();
    }
  };
}

export function createLocalStorageCacheDriver(storage, prefix = 'tt_agent_plus_777727_cache:') {
  return {
    async get(key) {
      const raw = storage.getItem(`${prefix}${key}`);
      return parseStoredValue(raw);
    },
    async set(key, value) {
      storage.setItem(`${prefix}${key}`, JSON.stringify(value));
    },
    async remove(key) {
      storage.removeItem(`${prefix}${key}`);
    },
    async values() {
      const entries = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key && key.startsWith(prefix)) {
          const value = parseStoredValue(storage.getItem(key));
          if (value !== null) entries.push(value);
        }
      }
      return entries;
    },
    async clear() {
      const keys = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key && key.startsWith(prefix)) keys.push(key);
      }
      keys.forEach((key) => storage.removeItem(key));
    }
  };
}

export function createProcessedCacheStore(driver) {
  return {
    async put(entry) {
      const next = cloneJson(entry);
      await driver.set(next.key, next);
      return cloneJson(next);
    },
    async get(key) {
      const entry = await driver.get(key);
      return entry == null ? null : cloneJson(entry);
    },
    async list() {
      const entries = await driver.values();
      return entries.map((entry) => cloneJson(entry));
    },
    async markStale(key, invalidationReason) {
      const entry = await driver.get(key);
      if (!entry) return null;
      const next = { ...cloneJson(entry), stale: true, invalidationReason };
      await driver.set(key, next);
      return cloneJson(next);
    },
    async remove(key) {
      await driver.remove(key);
    },
    async clear() {
      await driver.clear();
    }
  };
}

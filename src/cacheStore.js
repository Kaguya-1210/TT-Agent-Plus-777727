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
  const map = new Map(Object.entries(seed));
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async remove(key) {
      map.delete(key);
    },
    async values() {
      return Array.from(map.values());
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
      return raw ? JSON.parse(raw) : null;
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
          entries.push(JSON.parse(storage.getItem(key)));
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
      await driver.set(entry.key, entry);
      return entry;
    },
    async get(key) {
      return driver.get(key);
    },
    async list() {
      return driver.values();
    },
    async markStale(key, invalidationReason) {
      const entry = await driver.get(key);
      if (!entry) return null;
      const next = { ...entry, stale: true, invalidationReason };
      await driver.set(key, next);
      return next;
    },
    async remove(key) {
      await driver.remove(key);
    },
    async clear() {
      await driver.clear();
    }
  };
}

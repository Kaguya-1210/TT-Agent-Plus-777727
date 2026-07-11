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

export function createCacheKey({
  scopeId,
  sourceHash,
  ruleTemplateId,
  ruleVersion,
  worldInfoRuleId,
  worldInfoRuleVersion,
  modelProfileId,
  promptVersion
}) {
  return [
    scopeId || 'global',
    sourceHash,
    ruleTemplateId,
    `rv${ruleVersion}`,
    worldInfoRuleId || 'world-info-all',
    `wv${worldInfoRuleVersion ?? 1}`,
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

export function createFallbackCacheDriver(primary, fallback, onFallback) {
  let fallbackActive = false;
  let fallbackNotified = false;

  function activateFallback(error) {
    fallbackActive = true;
    if (fallbackNotified) return;
    fallbackNotified = true;
    try {
      onFallback?.(error);
    } catch {
      // Cache diagnostics must not break the fallback path.
    }
  }

  return {
    async get(key) {
      if (fallbackActive) return fallback.get(key);
      try {
        const value = await primary.get(key);
        if (value !== null && value !== undefined) await fallback.set(key, value);
        return value;
      } catch (error) {
        activateFallback(error);
        return fallback.get(key);
      }
    },
    async set(key, value) {
      if (fallbackActive) return fallback.set(key, value);
      try {
        await primary.set(key, value);
        await fallback.set(key, value);
      } catch (error) {
        activateFallback(error);
        await fallback.set(key, value);
      }
    },
    async remove(key) {
      if (!fallbackActive) {
        try {
          await primary.remove(key);
        } catch (error) {
          activateFallback(error);
        }
      }
      await fallback.remove(key);
    },
    async values() {
      if (fallbackActive) return fallback.values();
      try {
        const values = await primary.values();
        for (const value of values) {
          if (value?.key) await fallback.set(value.key, value);
        }
        return values;
      } catch (error) {
        activateFallback(error);
        return fallback.values();
      }
    },
    async clear() {
      if (!fallbackActive) {
        try {
          await primary.clear();
        } catch (error) {
          activateFallback(error);
        }
      }
      await fallback.clear();
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

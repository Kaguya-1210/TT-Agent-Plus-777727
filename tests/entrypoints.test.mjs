import assert from 'node:assert/strict';
import test from 'node:test';
import { MAGIC_WAND_LABEL, SETTINGS_KEY } from '../src/constants.js';
import { createHostBridge } from '../src/stBridge.js';
import { createMagicWandItem, mountMagicWandItem, registerSlash777 } from '../src/entrypoints.js';

test('magic wand item renders one short label and click handler', () => {
  let clicked = 0;
  const item = createMagicWandItem({ onOpen: () => { clicked += 1; } });

  assert.equal(item.label, MAGIC_WAND_LABEL);
  item.onClick();
  assert.equal(clicked, 1);
});

test('slash registration accepts numeric command name', () => {
  const calls = [];
  const parser = {
    addCommandObject(command) {
      calls.push(command);
    }
  };

  registerSlash777({ parser, commandFactory: (definition) => definition, onOpen: () => {} });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, '777');
});

test('host bridge stores extension prompt through context when available', () => {
  const prompts = [];
  const bridge = createHostBridge({
    getContext: () => ({
      setExtensionPrompt: (...args) => prompts.push(args),
      extensionSettings: {}
    }),
    extensionPromptTypes: { IN_PROMPT: 2 },
    debug: { warn() {}, info() {} }
  });

  bridge.setProcessedPrompt('processed block');
  assert.equal(prompts[0][0], 'tt-agent-plus-777727');
  assert.equal(prompts[0][1], 'processed block');
});

test('magic wand item mounts once and keeps label text safe', () => {
  const { documentRef, menu } = createFakeDocument();
  let clicked = 0;
  const item = createMagicWandItem({ onOpen: () => { clicked += 1; } });
  item.label = '<img src=x onerror=alert(1)>';

  assert.equal(mountMagicWandItem({ documentRef, item, debug: silentDebug() }), true);
  assert.equal(mountMagicWandItem({ documentRef, item, debug: silentDebug() }), true);

  assert.equal(menu.children.length, 1);
  const button = menu.children[0];
  assert.equal(button.id, item.id);
  assert.equal(button.children.length, 3);
  assert.equal(button.children[1].textContent, item.label);
  assert.doesNotMatch(button.innerHTML, /<img/i);

  button.dispatchEvent({ type: 'click' });
  assert.equal(clicked, 1);
});

test('magic wand mount returns false when required DOM APIs are missing', () => {
  const warnings = [];
  const item = createMagicWandItem({ onOpen: () => {} });

  const mounted = mountMagicWandItem({
    documentRef: {},
    item,
    debug: { warn: (...args) => warnings.push(args) }
  });

  assert.equal(mounted, false);
  assert.equal(warnings.length, 1);
});

test('magic wand keyboard activation prevents default and opens', () => {
  const { documentRef, menu } = createFakeDocument();
  let clicked = 0;
  const item = createMagicWandItem({ onOpen: () => { clicked += 1; } });

  mountMagicWandItem({ documentRef, item, debug: silentDebug() });
  const button = menu.children[0];
  const spaceEvent = keyboardEvent(' ');
  const enterEvent = keyboardEvent('Enter');

  button.dispatchEvent(spaceEvent);
  button.dispatchEvent(enterEvent);

  assert.equal(spaceEvent.defaultPrevented, true);
  assert.equal(enterEvent.defaultPrevented, true);
  assert.equal(clicked, 2);
});

test('magic wand events tolerate missing or throwing click handlers', () => {
  const { documentRef, menu } = createFakeDocument();
  const warnings = [];
  const debug = { warn: (...args) => warnings.push(args), info() {} };
  const item = { id: 'custom-entry', label: 'Custom' };

  assert.equal(mountMagicWandItem({ documentRef, item, debug }), true);
  assert.doesNotThrow(() => menu.children[0].dispatchEvent({ type: 'click' }));

  item.onClick = () => {
    throw new Error('open failed');
  };
  assert.doesNotThrow(() => menu.children[0].dispatchEvent({ type: 'click' }));
  assert.equal(warnings.length, 2);
});

test('slash registration defaults command factory to identity', () => {
  const calls = [];
  const parser = {
    addCommandObject(command) {
      calls.push(command);
    }
  };

  assert.equal(registerSlash777({ parser, onOpen: () => {} }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, '777');
});

test('slash registration soft-fails factory and parser errors', () => {
  const warnings = [];
  const debug = { warn: (...args) => warnings.push(args) };
  const parser = {
    addCommandObject() {
      throw new Error('parser failed');
    }
  };

  assert.equal(registerSlash777({
    parser,
    commandFactory: () => {
      throw new Error('factory failed');
    },
    onOpen: () => {},
    debug
  }), false);
  assert.equal(registerSlash777({
    parser,
    commandFactory: () => null,
    onOpen: () => {},
    debug
  }), false);
  assert.equal(registerSlash777({
    parser,
    commandFactory: (definition) => definition,
    onOpen: () => {},
    debug
  }), false);
  assert.equal(warnings.length, 3);
});

test('slash callback swallows onOpen errors and returns empty string', () => {
  const calls = [];
  const warnings = [];
  const parser = {
    addCommandObject(command) {
      calls.push(command);
    }
  };

  registerSlash777({
    parser,
    onOpen: () => {
      throw new Error('open failed');
    },
    debug: { warn: (...args) => warnings.push(args), info() {} }
  });

  assert.equal(calls[0].callback(), '');
  assert.equal(warnings.length, 1);
});

test('host bridge soft-degrades context, localStorage, and prompt failures', () => {
  const warnings = [];
  const bridge = createHostBridge({
    windowRef: {
      localStorage: {
        getItem() {
          throw new Error('storage read failed');
        },
        setItem() {
          throw new Error('storage write failed');
        }
      }
    },
    getContext() {
      throw new Error('context failed');
    },
    debug: { warn: (...args) => warnings.push(args), info() {} }
  });

  assert.equal(bridge.loadSettings().enabled, true);
  assert.doesNotThrow(() => bridge.saveSettings({ enabled: false, unknown: 'drop' }));
  assert.equal(bridge.setProcessedPrompt('processed block'), false);
  assert.ok(warnings.length >= 4);
});

test('host bridge saves normalized settings without unknown fields', () => {
  let stored = '';
  const context = {
    extensionSettings: {},
    saveSettingsDebounced() {}
  };
  const bridge = createHostBridge({
    windowRef: {
      localStorage: {
        setItem(key, value) {
          stored = value;
          assert.equal(key, SETTINGS_KEY);
        }
      }
    },
    getContext: () => context,
    debug: silentDebug()
  });

  const normalized = bridge.saveSettings({ enabled: false, globalConcurrency: 99, unknown: 'drop' });
  const parsed = JSON.parse(stored);

  assert.equal(normalized.enabled, false);
  assert.equal(normalized.globalConcurrency, 8);
  assert.equal('unknown' in normalized, false);
  assert.equal('unknown' in parsed, false);
  assert.equal('unknown' in context.extensionSettings[SETTINGS_KEY], false);
});

test('host bridge tolerates save debounce and prompt injection failures', () => {
  const warnings = [];
  const prompts = [];
  const bridge = createHostBridge({
    windowRef: {
      localStorage: {
        setItem() {}
      }
    },
    getContext: () => ({
      extensionSettings: {},
      saveSettingsDebounced() {
        throw new Error('debounce failed');
      },
      setExtensionPrompt(...args) {
        prompts.push(args);
        throw new Error('prompt failed');
      }
    }),
    debug: { warn: (...args) => warnings.push(args), info() {} }
  });

  assert.doesNotThrow(() => bridge.saveSettings({ enabled: false }));
  assert.equal(bridge.setProcessedPrompt('processed block'), false);
  assert.equal(prompts.length, 1);
  assert.equal(warnings.length, 2);
});

test('host bridge normalizes null processed prompt to empty string', () => {
  const prompts = [];
  const bridge = createHostBridge({
    getContext: () => ({
      setExtensionPrompt: (...args) => prompts.push(args),
      extensionSettings: {}
    }),
    debug: silentDebug()
  });

  assert.equal(bridge.setProcessedPrompt(null), true);
  assert.equal(prompts[0][1], '');
});

function silentDebug() {
  return { warn() {}, info() {} };
}

function keyboardEvent(key) {
  return {
    type: 'keydown',
    key,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    }
  };
}

function createFakeDocument() {
  const elementsById = new Map();
  const documentRef = {
    querySelector(selector) {
      if (selector === '#extensionsMenu') return this.getElementById('extensionsMenu');
      return null;
    },
    getElementById(id) {
      return elementsById.get(id) ?? null;
    },
    createElement(tagName) {
      return createFakeElement(tagName, elementsById);
    }
  };
  const menu = documentRef.createElement('div');
  menu.id = 'extensionsMenu';
  elementsById.set(menu.id, menu);
  return { documentRef, menu };
}

function createFakeElement(tagName, elementsById) {
  return {
    tagName: tagName.toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    hidden: false,
    attributes: {},
    children: [],
    listeners: {},
    parentNode: null,
    _innerHTML: '',
    set innerHTML(value) {
      this._innerHTML = String(value);
    },
    get innerHTML() {
      if (this._innerHTML) return this._innerHTML;
      return this.children.map((child) => child.outerHTML).join('');
    },
    get outerHTML() {
      return `<${tagName}>${escapeHtml(this.textContent)}${this.innerHTML}</${tagName}>`;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    append(...nodes) {
      for (const node of nodes) {
        node.parentNode = this;
        this.children.push(node);
        if (node.id) elementsById.set(node.id, node);
      }
    },
    appendChild(node) {
      this.append(node);
      return node;
    },
    addEventListener(type, handler) {
      this.listeners[type] ??= [];
      this.listeners[type].push(handler);
    },
    dispatchEvent(event) {
      for (const handler of this.listeners[event.type] ?? []) {
        handler(event);
      }
    },
    remove() {
      if (this.parentNode) {
        this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      }
      if (this.id) elementsById.delete(this.id);
      this.parentNode = null;
    }
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

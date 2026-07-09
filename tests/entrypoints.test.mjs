import assert from 'node:assert/strict';
import test from 'node:test';
import { MAGIC_WAND_LABEL } from '../src/constants.js';
import { createHostBridge } from '../src/stBridge.js';
import { createMagicWandItem, registerSlash777 } from '../src/entrypoints.js';

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

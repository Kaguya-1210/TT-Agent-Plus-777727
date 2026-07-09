import { MAGIC_WAND_LABEL, MODULE_ID, SLASH_COMMAND } from './constants.js';

export function createMagicWandItem({ onOpen }) {
  return {
    id: `${MODULE_ID}-magic-wand-entry`,
    label: MAGIC_WAND_LABEL,
    onClick: onOpen
  };
}

export function mountMagicWandItem({ documentRef, item, debug }) {
  const menu = documentRef.querySelector('#extensionsMenu');
  if (!menu) {
    debug?.warn('entry', '未找到魔法棒菜单 #extensionsMenu', {});
    return false;
  }

  const existing = documentRef.getElementById(item.id);
  if (existing) existing.remove();

  const button = documentRef.createElement('div');
  button.id = item.id;
  button.className = 'list-group-item flex-container flexGap5 tt-agent-plus-727-menu-item';
  button.setAttribute('role', 'button');
  button.setAttribute('tabindex', '0');
  button.innerHTML = [
    '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>',
    `<span>${item.label}</span>`,
    `<span class="tt-agent-plus-727-menu-badge" hidden></span>`
  ].join('');
  button.addEventListener('click', item.onClick);
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') item.onClick(event);
  });
  menu.append(button);
  debug?.info('entry', '魔法棒入口已挂载', { id: item.id });
  return true;
}

export function registerSlash777({ parser, commandFactory, onOpen, debug }) {
  if (!parser?.addCommandObject) {
    debug?.warn('entry', 'SlashCommandParser 不可用，跳过 /777 注册', {});
    return false;
  }
  const command = commandFactory({
    name: SLASH_COMMAND,
    callback: () => {
      onOpen();
      return '';
    },
    returns: '打开 TT-Agent-Plus-727 主界面',
    helpString: '打开 TT-Agent-Plus-727 主界面'
  });
  parser.addCommandObject(command);
  debug?.info('entry', '/777 已注册', {});
  return true;
}

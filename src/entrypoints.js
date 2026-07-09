import { MAGIC_WAND_LABEL, MODULE_ID, SLASH_COMMAND } from './constants.js';

export function createMagicWandItem({ onOpen } = {}) {
  return {
    id: `${MODULE_ID}-magic-wand-entry`,
    label: MAGIC_WAND_LABEL,
    onClick: onOpen
  };
}

export function mountMagicWandItem({ documentRef, item, debug } = {}) {
  if (!hasDocumentApi(documentRef)) {
    warn(debug, 'entry', 'required DOM APIs unavailable', {});
    return false;
  }

  const menu = documentRef.querySelector('#extensionsMenu');
  if (!menu) {
    warn(debug, 'entry', 'extensions menu not found', { selector: '#extensionsMenu' });
    return false;
  }

  const existing = documentRef.getElementById(item?.id);
  if (existing) existing.remove();

  const button = documentRef.createElement('div');
  button.id = item.id;
  button.className = 'list-group-item flex-container flexGap5 tt-agent-plus-727-menu-item';
  button.setAttribute('role', 'button');
  button.setAttribute('tabindex', '0');

  const icon = documentRef.createElement('i');
  icon.className = 'fa-solid fa-wand-magic-sparkles';
  icon.setAttribute('aria-hidden', 'true');

  const label = documentRef.createElement('span');
  label.textContent = String(item.label ?? '');

  const badge = documentRef.createElement('span');
  badge.className = 'tt-agent-plus-727-menu-badge';
  badge.hidden = true;

  appendChildren(button, icon, label, badge);

  button.addEventListener('click', (event) => {
    openItem(item, debug, event);
  });
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault?.();
      openItem(item, debug, event);
    }
  });
  menu.append(button);
  info(debug, 'entry', 'magic wand entry mounted', { id: item.id });
  return true;
}

export function registerSlash777({ parser, commandFactory = identityCommand, onOpen, debug } = {}) {
  if (typeof parser?.addCommandObject !== 'function') {
    warn(debug, 'entry', 'SlashCommandParser unavailable', {});
    return false;
  }

  let command;
  try {
    command = commandFactory({
      name: SLASH_COMMAND,
      callback: () => {
        try {
          if (typeof onOpen === 'function') {
            onOpen();
          } else {
            warn(debug, 'entry', '/777 onOpen unavailable', {});
          }
        } catch (error) {
          errorLog(debug, 'entry', '/777 onOpen failed', { error: errorMessage(error) });
        }
        return '';
      },
      returns: '打开 TT-Agent-Plus-727 主界面',
      helpString: '打开 TT-Agent-Plus-727 主界面'
    });
  } catch (error) {
    warn(debug, 'entry', '/777 commandFactory failed', { error: errorMessage(error) });
    return false;
  }

  if (!isCommand(command)) {
    warn(debug, 'entry', '/777 commandFactory returned invalid command', {});
    return false;
  }

  try {
    parser.addCommandObject(command);
  } catch (error) {
    warn(debug, 'entry', '/777 registration failed', { error: errorMessage(error) });
    return false;
  }

  info(debug, 'entry', '/777 registered', {});
  return true;
}

function hasDocumentApi(documentRef) {
  return Boolean(documentRef)
    && typeof documentRef.querySelector === 'function'
    && typeof documentRef.getElementById === 'function'
    && typeof documentRef.createElement === 'function';
}

function appendChildren(parent, ...children) {
  if (typeof parent.append === 'function') {
    parent.append(...children);
    return;
  }
  for (const child of children) {
    parent.appendChild(child);
  }
}

function openItem(item, debug, event) {
  try {
    if (typeof item?.onClick !== 'function') {
      warn(debug, 'entry', 'magic wand onClick unavailable', { id: item?.id });
      return;
    }
    item.onClick(event);
  } catch (error) {
    warn(debug, 'entry', 'magic wand onClick failed', { id: item?.id, error: errorMessage(error) });
  }
}

function identityCommand(definition) {
  return definition;
}

function isCommand(command) {
  return Boolean(command) && typeof command === 'object' && Boolean(command.name);
}

function warn(debug, area, message, details) {
  try {
    debug?.warn?.(area, message, details);
  } catch {
    // Debug logging must never break host integration.
  }
}

function info(debug, area, message, details) {
  try {
    debug?.info?.(area, message, details);
  } catch {
    // Debug logging must never break host integration.
  }
}

function errorLog(debug, area, message, details) {
  try {
    if (typeof debug?.error === 'function') {
      debug.error(area, message, details);
    } else {
      debug?.warn?.(area, message, details);
    }
  } catch {
    // Debug logging must never break host integration.
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

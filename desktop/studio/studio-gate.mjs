// Pocket Buddy Studio availability gate.
//
// Studio is a developer tool. It must never appear in a packaged production
// build unless the developer explicitly opts in with POCKET_BUDDY_STUDIO=1.
// Keeping the decision in one pure module lets the contract be tested without
// booting Electron.

const TRUE_VALUES = new Set(["1", "true", "on", "yes"]);
const FALSE_VALUES = new Set(["0", "false", "off", "no"]);

function flagValue(env, name) {
  return String(env?.[name] ?? "").trim().toLowerCase();
}

/**
 * Studio is available when the app is unpackaged (normal development), or when
 * a packaged build is explicitly opted in. An explicit "off" always wins so a
 * developer can silence Studio while working on production behavior.
 */
export function studioEnabled({ packaged = true, env = {} } = {}) {
  const flag = flagValue(env, "POCKET_BUDDY_STUDIO");
  if (FALSE_VALUES.has(flag)) return false;
  if (TRUE_VALUES.has(flag)) return true;
  return !packaged;
}

/** Open the Studio window automatically at boot (POCKET_BUDDY_STUDIO_OPEN=1). */
export function studioAutoOpen({ packaged = true, env = {} } = {}) {
  if (!studioEnabled({ packaged, env })) return false;
  return TRUE_VALUES.has(flagValue(env, "POCKET_BUDDY_STUDIO_OPEN"));
}

/**
 * DevTools shortcuts (F12, Ctrl/Cmd+Shift+I) follow the same gate so production
 * keyboard behavior is unchanged.
 */
export function devToolsShortcutsEnabled({ packaged = true, env = {} } = {}) {
  return studioEnabled({ packaged, env });
}

export const STUDIO_TRAY_LABEL = "Open Pocket Buddy Studio";

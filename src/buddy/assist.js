const MAX_ASSIST_PROMPT_LENGTH = 1200;

function cleanPrompt(value) {
  return typeof value === "string" ? value.trim().slice(0, MAX_ASSIST_PROMPT_LENGTH) : "";
}

function talkInput() {
  const host = document.getElementById("birb-shadow-host");
  const root = host?.shadowRoot;
  const input = root?.querySelector("#pb-talk input");
  return input instanceof HTMLInputElement ? input : null;
}

/**
 * Install the website-facing contextual assistant bridge on the existing
 * Pocket Buddy API object.
 *
 * The bridge intentionally PREFILLS Talk instead of sending anything. The
 * user always gets to read, edit, or discard the suggested prompt first.
 *
 * @param {Record<string, any>} api
 */
export function installContextualBuddyAssist(api) {
  if (!api || typeof api.showTalk !== "function") return api;

  api.assist = (prompt = "") => {
    api.showTalk();
    const input = talkInput();
    if (!input) return false;

    const nextPrompt = cleanPrompt(prompt);
    if (nextPrompt) {
      input.value = nextPrompt;
      input.setSelectionRange(nextPrompt.length, nextPrompt.length);
    }
    input.focus();
    return true;
  };

  return api;
}

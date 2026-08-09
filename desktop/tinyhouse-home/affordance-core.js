(() => {
  "use strict";

  // What the furniture offers, and how an actor decides what to do about it.
  //
  // Furniture in TinyHouse is catalogued art, not behaviour, so affordances are
  // derived from the asset's own name and category rather than a hand-written
  // list per placement. That means a newly placed bed advertises Sleep the
  // moment it exists, with no extra authoring.

  const NEEDS = Object.freeze(["energy", "hunger", "hygiene", "fun", "social"]);

  // First match wins, so specific rules precede general ones.
  const RULES = Object.freeze([
    { test: /\bbed\b|mattress|futon|bunk/i, action: "Sleep", need: "energy", gain: 0.55, seconds: 14 },
    { test: /sofa|couch|armchair|lounge/i, action: "Rest", need: "energy", gain: 0.2, seconds: 8 },
    { test: /toilet|wc\b/i, action: "Freshen up", need: "hygiene", gain: 0.5, seconds: 6 },
    { test: /bath|shower|tub/i, action: "Bathe", need: "hygiene", gain: 0.6, seconds: 10 },
    { test: /sink|basin|washing/i, action: "Wash", need: "hygiene", gain: 0.25, seconds: 4 },
    { test: /fridge|refrigerator|freezer/i, action: "Eat", need: "hunger", gain: 0.5, seconds: 8 },
    { test: /oven|stove|microwave|cooker|kitchen/i, action: "Cook", need: "hunger", gain: 0.45, seconds: 10 },
    { test: /\btable\b|counter|dining/i, action: "Snack", need: "hunger", gain: 0.2, seconds: 5 },
    { test: /\btv\b|television|console|computer|pc\b|monitor|arcade/i, action: "Play", need: "fun", gain: 0.45, seconds: 10 },
    { test: /book|shelf|library|piano|guitar/i, action: "Unwind", need: "fun", gain: 0.3, seconds: 8 },
    { test: /plant|flower|cactus|bonsai/i, action: "Tend", need: "fun", gain: 0.15, seconds: 5 },
    { test: /rug|carpet|cushion|pillow/i, action: "Lounge", need: "energy", gain: 0.12, seconds: 6 },
  ]);

  const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

  /** Interactions a placed asset offers. Empty for pure decoration. */
  function affordancesFor(asset) {
    const label = `${asset?.name ?? ""} ${asset?.category ?? ""} ${asset?.id ?? ""}`;
    const rule = RULES.find((candidate) => candidate.test.test(label));
    if (!rule) return [];
    return [{ action: rule.action, need: rule.need, gain: rule.gain, seconds: rule.seconds }];
  }

  /**
   * How appealing an interaction is right now. Driven by how badly the need is
   * unmet, so a well-fed actor ignores the fridge, and discounted by travel so
   * a closer option of equal value wins.
   */
  function score(affordance, needs, distanceCells = 0) {
    if (!affordance?.need) return 0;
    const level = clamp01(needs?.[affordance.need] ?? 1);
    const deficit = 1 - level;
    if (deficit <= 0.02) return 0;
    const travel = 1 + Math.max(0, Number(distanceCells) || 0) * 0.08;
    return (deficit * deficit * Math.max(0, affordance.gain)) / travel;
  }

  /** The need in the worst shape, or null when everything is comfortable. */
  function worstNeed(needs, threshold = 0.6) {
    let worst = null;
    for (const name of NEEDS) {
      const level = clamp01(needs?.[name] ?? 1);
      if (level >= threshold) continue;
      if (!worst || level < worst.level) worst = { need: name, level };
    }
    return worst;
  }

  /**
   * Pick the best interaction among candidates.
   * Each candidate is { affordance, cell, distance, id }.
   */
  function chooseAction(candidates, needs) {
    let best = null;
    for (const candidate of candidates || []) {
      const value = score(candidate?.affordance, needs, candidate?.distance);
      if (value <= 0) continue;
      if (!best || value > best.score) best = { ...candidate, score: value };
    }
    return best;
  }

  /** Decay needs over time; sleeping drains slower than being awake. */
  function decay(needs, seconds, rates = {}) {
    const perSecond = { energy: 0.004, hunger: 0.005, hygiene: 0.003, fun: 0.006, social: 0.004, ...rates };
    const next = {};
    for (const name of NEEDS) {
      next[name] = clamp01((needs?.[name] ?? 1) - (perSecond[name] ?? 0) * Math.max(0, seconds));
    }
    return next;
  }

  /** Apply an interaction's benefit. */
  function satisfy(needs, affordance, seconds) {
    const next = { ...needs };
    if (!affordance?.need) return next;
    const portion = Math.max(0, seconds) / Math.max(0.001, affordance.seconds);
    next[affordance.need] = clamp01((needs?.[affordance.need] ?? 0) + affordance.gain * Math.min(1, portion));
    return next;
  }

  const api = Object.freeze({ NEEDS, RULES, affordancesFor, score, worstNeed, chooseAction, decay, satisfy });
  if (typeof window !== "undefined") window.PocketBuddyAffordances = api;
  if (typeof globalThis !== "undefined") globalThis.PocketBuddyAffordances = api;
})();

(() => {
  "use strict";

  const COMPASS_LABELS = Object.freeze(["NE", "SE", "SW", "NW"]);
  const SHEET_RULES = Object.freeze([
    {
      idPattern: /^books-book-small-/,
      columns: 4,
      rows: 4,
      row: 0,
      cellWidth: 32,
      cellHeight: 32,
    },
  ]);

  const tokenRank = Object.freeze({
    default: 0,
    front: 0,
    a: 0,
    b: 1,
    back: 1,
    c: 2,
    d: 3,
  });

  function directionToken(name) {
    const text = String(name || "");
    const word = text.match(/\b(front|back)\b/i)?.[1]?.toLowerCase();
    if (word) return word;
    const letter = text.match(/\b([a-d])\b/i)?.[1]?.toLowerCase();
    return letter || "default";
  }

  function familyName(name) {
    return String(name || "")
      .replace(/\b(front|back)\b/ig, " ")
      .replace(/\b[a-d]\b/ig, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function familyKey(asset) {
    return `${String(asset?.folder || "").toLowerCase()}::${familyName(asset?.name)}`;
  }

  function sheetSpec(asset) {
    const rule = SHEET_RULES.find((candidate) => candidate.idPattern.test(String(asset?.id || "")));
    if (!rule) return null;
    if (Number(asset.width) !== rule.columns * rule.cellWidth
      || Number(asset.height) !== rule.rows * rule.cellHeight) return null;
    return { ...rule };
  }

  function orderedFamilyStates(members) {
    const sorted = [...members].sort((a, b) => {
      const rankA = tokenRank[directionToken(a.name)] ?? 99;
      const rankB = tokenRank[directionToken(b.name)] ?? 99;
      return rankA - rankB || String(a.id).localeCompare(String(b.id));
    });
    const unique = [];
    const seen = new Set();
    for (const asset of sorted) {
      if (seen.has(asset.id)) continue;
      seen.add(asset.id);
      unique.push(asset);
    }
    if (unique.length >= 4) {
      return unique.slice(0, 4).map((asset) => ({ assetId: asset.id, flip: false }));
    }
    if (unique.length === 3) {
      return [
        { assetId: unique[0].id, flip: false },
        { assetId: unique[1].id, flip: false },
        { assetId: unique[2].id, flip: false },
        { assetId: unique[0].id, flip: true },
      ];
    }
    if (unique.length === 2) {
      return [
        { assetId: unique[0].id, flip: false },
        { assetId: unique[1].id, flip: false },
        { assetId: unique[1].id, flip: true },
        { assetId: unique[0].id, flip: true },
      ];
    }
    return unique.length
      ? [{ assetId: unique[0].id, flip: false }, { assetId: unique[0].id, flip: true }]
      : [];
  }

  function buildRotationIndex(manifest) {
    const assets = Array.isArray(manifest) ? manifest : [];
    const groups = new Map();
    for (const asset of assets) {
      if (!asset || ["Floors", "Walls"].includes(asset.category)) continue;
      const key = familyKey(asset);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(asset);
    }

    const index = new Map();
    for (const asset of assets) {
      if (!asset || ["Floors", "Walls"].includes(asset.category)) continue;
      const sheet = sheetSpec(asset);
      if (sheet) {
        index.set(asset.id, {
          mode: "sheet",
          count: 4,
          labels: COMPASS_LABELS,
          sheet,
          states: Array.from({ length: 4 }, (_, frame) => ({
            assetId: asset.id,
            flip: false,
            sheetFrame: frame,
          })),
        });
        continue;
      }

      const members = groups.get(familyKey(asset)) || [asset];
      const hasDirectionalVariant = members.length > 1
        && members.some((candidate) => directionToken(candidate.name) !== "default");
      const states = hasDirectionalVariant
        ? orderedFamilyStates(members)
        : [{ assetId: asset.id, flip: false }, { assetId: asset.id, flip: true }];
      index.set(asset.id, {
        mode: hasDirectionalVariant ? "variants" : "mirror",
        count: states.length,
        labels: states.length === 4 ? COMPASS_LABELS : Object.freeze(["LEFT", "RIGHT"]),
        states,
      });
    }
    return index;
  }

  function normalizeIndex(value, count) {
    const safeCount = Math.max(1, Number(count) || 1);
    const numeric = Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
    return ((numeric % safeCount) + safeCount) % safeCount;
  }

  function stateFor(rotation, index) {
    if (!rotation?.states?.length) return null;
    return rotation.states[normalizeIndex(index, rotation.states.length)];
  }

  window.TinyHouseRotationCore = Object.freeze({
    COMPASS_LABELS,
    SHEET_RULES,
    directionToken,
    familyName,
    familyKey,
    sheetSpec,
    orderedFamilyStates,
    buildRotationIndex,
    normalizeIndex,
    stateFor,
  });
})();
import assert from "node:assert/strict";
import test from "node:test";

import {
  K1Z_COALITION,
  canonicalizePlayerName,
  enforceSafety,
  resolveCoalitionIdentity,
} from "../controller-safety.mjs";

const ids = Object.fromEntries(K1Z_COALITION.map((member) => [member.key, member.id]));

function player(key, overrides = {}) {
  const member = K1Z_COALITION.find((candidate) => candidate.key === key);
  return {
    id: member.id,
    name: `K1Z ${member.aliases[0]}`,
    isAlive: true,
    ...overrides,
  };
}

function outsider(overrides = {}) {
  return { id: "ply_outsider", name: "Daveey", isAlive: true, ...overrides };
}

function action(id, kind, metadata = {}, label = id) {
  return { id, kind, label, metadata };
}

function run(ranked, observation, legalActions = ranked) {
  return enforceSafety({ ranked, legalActions, observation, state: {} });
}

test("coalition registry is frozen and canonicalization is exact", () => {
  assert.equal(Object.isFrozen(K1Z_COALITION), true);
  assert.equal(Object.isFrozen(K1Z_COALITION[0]), true);
  assert.equal(canonicalizePlayerName(" Ｋ１Ｚ_juryoku-koku "), "juryoku koku");
  assert.equal(canonicalizePlayerName("[K1Z] Mickey.Mouse"), "mickey mouse");
  assert.equal(resolveCoalitionIdentity({ name: "K1Z Hrafn" }).member.key, "hrafn");
  assert.equal(resolveCoalitionIdentity({ name: "not hrafn" }).resolved, false);
});

test("stable ID wins when an unrelated display name is not independently resolved", () => {
  const resolved = resolveCoalitionIdentity({ id: ids.katanasan, name: "new display" });
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.member.key, "katanasan");
  assert.equal(resolved.conflict, false);
});

test("different known K1Z ID and name are a conflict", () => {
  const resolved = resolveCoalitionIdentity({ id: ids.katanasan, name: "K1Z Hrafn" });
  assert.equal(resolved.resolved, false);
  assert.equal(resolved.conflict, true);
});

test("mixed board protects every K1Z member and reroutes once", () => {
  const observation = {
    alivePlayerCount: 6,
    visiblePlayers: [
      player("katanasan"), player("gravity"), player("hrafn"), player("mickey"), outsider(),
    ],
  };
  for (const member of K1Z_COALITION) {
    const hostile = action(
      `attack:${member.key}:35`,
      "attack",
      { targetID: member.id, targetName: member.aliases[0], troopPercent: 35 },
    );
    const safe = action("attack:outsider:35", "attack", {
      targetID: "ply_outsider", targetName: "Daveey", troopPercent: 35,
    });
    const selected = run([hostile, safe], observation);
    assert.equal(selected.action.id, safe.id);
    assert.equal(selected.mode, "normal");
    assert.equal(selected.marker, "sv1");
    assert.equal(selected.rerouted, true);
    assert.deepEqual(selected.rejectedActionIDs, [hostile.id]);
  }
});

test("roster visibility and count never weaken K1Z protection", () => {
  const attack = action("attack:mickey:40", "attack", {
    targetID: ids.mickey,
    targetName: "K1Z Mickey Mouse",
  });
  const hold = action("hold:1", "hold");
  const observations = [
    { visiblePlayers: [player("mickey")] },
    { alivePlayerCount: 3, visiblePlayers: [player("mickey")] },
    { alivePlayerCount: 2, visiblePlayers: [player("mickey", { isAlive: false })] },
    { alivePlayerCount: 2, visiblePlayers: [player("mickey"), outsider()] },
  ];
  for (const observation of observations) {
    const selected = run([attack], observation, [attack, hold]);
    assert.equal(selected.action.id, hold.id);
    assert.equal(selected.mode, "normal");
    assert.equal(selected.fallbackUsed, true);
  }
});

test("complete all-K1Z endgame protects every member and every alliance", () => {
  const observation = {
    alivePlayerCount: 5,
    visiblePlayers: K1Z_COALITION.map((member) => player(member.key)),
  };
  const build = action("build:city", "build", { unit: "City" });
  for (const member of K1Z_COALITION) {
    const attack = action(`attack:${member.key}:40`, "attack", {
      targetID: member.id,
      targetName: `K1Z ${member.aliases[0]}`,
      troopPercent: 40,
    });
    const breakAlliance = action(`break:${member.key}`, "break_alliance", {
      targetID: member.id,
      targetName: `K1Z ${member.aliases[0]}`,
    });
    const rejectAlliance = action(`reject:${member.key}`, "alliance_reject", {
      recipientID: member.id,
      recipientName: `K1Z ${member.aliases[0]}`,
    });
    const selected = run([attack, breakAlliance, rejectAlliance, build], observation);
    assert.equal(selected.action.id, build.id, member.key);
    assert.equal(selected.mode, "normal", member.key);
    assert.equal(selected.marker, "sv1", member.key);
    assert.deepEqual(
      selected.rejectedActionIDs,
      [attack.id, breakAlliance.id, rejectAlliance.id],
      member.key,
    );
  }
});

test("K1Z-only endgame holds when every productive action would harm the fleet", () => {
  const observation = { alivePlayerCount: 2, visiblePlayers: [player("mickey")] };
  const attack = action("attack:mickey:40", "attack", {
    targetID: ids.mickey,
    targetName: "K1Z Mickey Mouse",
  });
  const breakAlliance = action("break:mickey", "break_alliance", {
    targetID: ids.mickey,
    targetName: "K1Z Mickey Mouse",
  });
  const hold = action("hold:1", "hold");
  const selected = run([attack, breakAlliance], observation, [attack, breakAlliance, hold]);
  assert.equal(selected.action.id, hold.id);
  assert.equal(selected.mode, "normal");
  assert.equal(selected.fallbackUsed, true);
  assert.deepEqual(selected.rejectedActionIDs, [attack.id, breakAlliance.id]);
});

test("conflicting target metadata always fails closed", () => {
  const hostile = action("attack:ambiguous:40", "attack", {
    targetID: ids.katanasan,
    targetName: "K1Z Hrafn",
  });
  const hold = action("hold:1", "hold");
  for (const observation of [
    { alivePlayerCount: 3, visiblePlayers: [player("katanasan"), outsider()] },
    { alivePlayerCount: 3, visiblePlayers: [player("katanasan"), player("hrafn")] },
  ]) {
    const selected = run([hostile], observation, [hostile, hold]);
    assert.equal(selected.action.id, hold.id);
    assert.equal(selected.fallbackUsed, true);
    assert.deepEqual(selected.rejectedActionIDs, [hostile.id]);
  }
});

test("ownerless harmful actions fail closed", () => {
  const observation = { alivePlayerCount: 2, visiblePlayers: [player("hrafn")] };
  const hold = action("hold:1", "hold");
  for (const [kind, id] of [
    ["attack", "attack:hidden:40"],
    ["boat", "boat:hidden:25"],
    ["nuke", "nuke:hidden"],
    ["warship", "warship:hidden"],
    ["move_warship", "move:hidden"],
    ["target_player", "target:hidden"],
    ["break_alliance", "break:hidden"],
    ["alliance_reject", "reject:hidden"],
    ["embargo", "embargo:hidden"],
  ]) {
    const hostile = action(id, kind, {}, "Opaque action");
    const selected = run([hostile], observation, [hostile, hold]);
    assert.equal(selected.action.id, hold.id, kind);
  }
  const hiddenBomb = action("build:hidden", "build", { unit: "Atom Bomb" }, "Build");
  assert.equal(run([hiddenBomb], observation, [hiddenBomb, hold]).action.id, hold.id);
});

test("every harmful action kind is blocked against every K1Z member in mixed play", () => {
  const observation = {
    alivePlayerCount: 6,
    visiblePlayers: [
      player("katanasan"), player("gravity"), player("hrafn"), player("mickey"), outsider(),
    ],
  };
  const cases = [
    ["attack", {}],
    ["land", {}],
    ["land_attack", {}],
    ["boat", {}],
    ["boat_attack", {}],
    ["nuke", {}],
    ["warship", {}],
    ["move_warship", {}],
    ["target", {}],
    ["target_player", {}],
    ["break_alliance", {}],
    ["alliance_reject", {}],
    ["reject_alliance", {}],
    ["embargo", {}],
    ["build", { unit: "Atom Bomb" }],
  ];
  const safe = action("build:city", "build", { unit: "City" });
  for (const member of K1Z_COALITION) {
    for (const [kind, metadata] of cases) {
      const hostile = action(`${kind}:${member.key}`, kind, {
        ...metadata,
        targetID: member.id,
        targetName: member.aliases[0],
      });
      assert.equal(run([hostile, safe], observation).action.id, safe.id, `${member.key}:${kind}`);
    }
  }
});

test("embargo_all is always vetoed", () => {
  const globalEmbargo = action("embargo:all", "embargo_all");
  const hold = action("hold:1", "hold");
  const observation = { alivePlayerCount: 2, visiblePlayers: [player("katanasan")] };
  const selected = run([globalEmbargo], observation, [globalEmbargo, hold]);
  assert.equal(selected.mode, "normal");
  assert.equal(selected.action.id, hold.id);
  assert.equal(selected.marker, "sv1");
});

test("neutral land and boat expansion remain safe without a player target", () => {
  const observation = {
    alivePlayerCount: 3,
    visiblePlayers: [player("mickey"), outsider()],
  };
  for (const kind of ["attack", "boat"]) {
    const expansion = action(
      `${kind}:terra-nullius:35`,
      kind,
      { expansion: true, troopPercent: 35 },
      "Expand into Terra Nullius 35%",
    );
    const selected = run([expansion], observation);
    assert.equal(selected.action.id, expansion.id);
    assert.equal(selected.marker, null);
  }
});

test("a false expansion flag cannot hide a K1Z target", () => {
  const disguised = action("attack:mickey:35", "attack", {
    expansion: true,
    targetID: ids.mickey,
    targetName: "K1Z Mickey Mouse",
  });
  const hold = action("hold:1", "hold");
  const observation = { alivePlayerCount: 3, visiblePlayers: [player("mickey"), outsider()] };
  assert.equal(run([disguised], observation, [disguised, hold]).action.id, hold.id);
});

test("resolved outsider harm remains legal on a mixed board", () => {
  const observation = {
    alivePlayerCount: 3,
    visiblePlayers: [player("hrafn"), outsider()],
  };
  const attack = action("attack:outsider:35", "attack", {
    targetID: "ply_outsider", targetName: "Daveey",
  });
  const selected = run([attack], observation);
  assert.equal(selected.action.id, attack.id);
  assert.equal(selected.marker, null);
  assert.equal(selected.reason, "resolved-outsider-target");
});

test("text-only target resolution is token-bounded and does not use substrings", () => {
  const observation = {
    alivePlayerCount: 3,
    visiblePlayers: [player("hrafn"), outsider({ id: "ply_not", name: "Not Hrafn" })],
  };
  const named = action("attack:hrafn:35", "attack", {}, "Attack K1Z Hrafn 35%");
  const hold = action("hold:1", "hold");
  assert.equal(run([named], observation, [named, hold]).action.id, hold.id);

  const substring = action("attack:not:35", "attack", {}, "Attack Not Hrafn 35%");
  const selected = run([substring], observation, [substring, hold]);
  assert.equal(selected.action.id, hold.id);
  assert.deepEqual(selected.rejectedActionIDs, [substring.id]);
});

test("only offered ranked actions can be returned and ranking is scanned once", () => {
  const observation = { alivePlayerCount: 3, visiblePlayers: [player("hrafn"), outsider()] };
  const notOffered = action("attack:ghost:35", "attack", {
    targetID: "ply_outsider", targetName: "Daveey",
  });
  const protectedAction = action("attack:hrafn:35", "attack", {
    targetID: ids.hrafn, targetName: "K1Z Hrafn",
  });
  const safe = action("build:city", "build", { unit: "City" });
  const selected = run(
    [notOffered, protectedAction, protectedAction, { action: safe }],
    observation,
    [protectedAction, safe],
  );
  assert.equal(selected.action, safe);
  assert.deepEqual(selected.rejectedActionIDs, [protectedAction.id]);
});

test("no safe ranking falls back to an offered hold and reports fallback", () => {
  const hostile = action("nuke:hrafn", "nuke", {
    targetID: ids.hrafn, targetName: "K1Z Hrafn",
  });
  const hold = action("hold:1", "hold");
  const observation = { alivePlayerCount: 3, visiblePlayers: [player("hrafn"), outsider()] };
  const selected = run([hostile, hold], observation, [hostile, hold]);
  assert.equal(selected.action, hold);
  assert.equal(selected.fallbackUsed, true);
  assert.equal(selected.marker, "sv1");
  assert.equal(selected.reason, "no-safe-ranked-action");
});

test("ranked hold cannot hide a later safe productive action", () => {
  const observation = { alivePlayerCount: 3, visiblePlayers: [player("hrafn"), outsider()] };
  const hold = action("hold:1", "hold");
  const build = action("build:city", "build", { unit: "City" });
  const selected = run([hold, build], observation);
  assert.equal(selected.action.id, build.id);
  assert.equal(selected.fallbackUsed, false);
});

test("no safe action and no offered hold fails closed without inventing an ID", () => {
  const hostile = action("nuke:hrafn", "nuke", {
    targetID: ids.hrafn, targetName: "K1Z Hrafn",
  });
  const observation = { alivePlayerCount: 3, visiblePlayers: [player("hrafn"), outsider()] };
  const selected = run([hostile], observation);
  assert.equal(selected.action, null);
  assert.equal(selected.fallbackUsed, true);
  assert.equal(selected.reason, "no-safe-offered-action");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  K1Z_MEMBERS,
  chooseHrafnAction,
  publicHrafnReason,
} from "../hrafn-strategy.mjs";
import {
  HRAFN_COWORLD_PROTOCOL_VERSION,
  HRAFN_COWORLD_RESPONSE_CONTRACT,
  buildHrafnIntentSnapshot,
  canonicalHrafnIntentJSON,
  chooseHrafnIntentDecision,
  createOllamaHrafnIntentPlanner,
  normalizeHrafnCoworldDecisionRequest,
  normalizeHrafnIntent,
} from "../hrafn-intent.mjs";

const lowRisk = { level: "low" };

test("HI1 accepts unrelated Coworld root metadata and projects a structured clone", () => {
  const legalActions = [{ id: "hold", kind: "hold" }];
  const observation = { turnNumber: 1000 };
  const request = {
    protocolVersion: HRAFN_COWORLD_PROTOCOL_VERSION,
    agent: {},
    match: {},
    observation,
    legalActions,
    decisionSupport: {},
    responseContract: HRAFN_COWORLD_RESPONSE_CONTRACT,
    unrelatedRootMetadata: {
      traceID: "trace-hi1-fixture",
      nested: { retainedOnlyByTransport: true },
    },
  };

  const normalized = normalizeHrafnCoworldDecisionRequest(request);
  assert.deepEqual(normalized, { legalActions, observation });
  assert.notEqual(normalized, request);
  assert.notEqual(normalized.legalActions, legalActions);
  assert.notEqual(normalized.observation, observation);
  assert.equal(Object.hasOwn(normalized, "unrelatedRootMetadata"), false);

  legalActions[0].id = "mutated-after-normalization";
  observation.turnNumber = 1100;
  assert.deepEqual(normalized, {
    legalActions: [{ id: "hold", kind: "hold" }],
    observation: { turnNumber: 1000 },
  });
});

test("HI1 fails closed on missing or malformed selector input fields", () => {
  const request = { legalActions: [], observation: {} };
  for (const [name, mutate] of [
    ["missing legalActions", (value) => { delete value.legalActions; }],
    ["malformed legalActions", (value) => { value.legalActions = {}; }],
    ["missing observation", (value) => { delete value.observation; }],
    ["malformed observation", (value) => { value.observation = []; }],
  ]) {
    const changed = structuredClone(request);
    mutate(changed);
    assert.equal(
      normalizeHrafnCoworldDecisionRequest(changed),
      null,
      name,
    );
  }
});

function action(id, kind, label = id, metadata = {}) {
  return { id, kind, label, metadata, risk: lowRisk };
}

function rival({
  id,
  name,
  tileShare = 0.15,
  relativeTroopRatio = 1.5,
  sharesBorder = true,
  canAttack = true,
  isAllied = false,
  incomingAttack = false,
} = {}) {
  return {
    id,
    name,
    tileShare,
    relativeTroopRatio,
    sharesBorder,
    canAttack,
    isAllied,
    incomingAttack,
    isAlive: true,
  };
}

function observation({
  tileShare = 0.12,
  troopRatio = 1,
  incomingAttacks = 0,
  incomingAttackPlayerIDs = [],
  rivals = [],
} = {}) {
  return {
    ownState: {
      tileShare,
      tilesOwned: Math.round(tileShare * 100000),
      troopRatio,
      troops: 500000,
      gold: 250000,
      incomingAttacks,
    },
    combat: { incomingAttackPlayerIDs },
    visiblePlayers: rivals,
  };
}

function attack(target, percent = 25) {
  return action(
    `attack:${target.id}:${percent}`,
    "attack",
    `Attack ${target.name} ${percent}%`,
    {
      targetID: target.id,
      targetName: target.name,
      troopPercent: percent,
    },
  );
}

function expand(percent = 35) {
  return action(
    `expand:terra-nullius:${percent}`,
    "attack",
    `Expand Terra Nullius ${percent}%`,
    { expansion: true, troopPercent: percent },
  );
}

test("HI1 accepts only the three-field bounded intent schema", () => {
  assert.deepEqual(
    normalizeHrafnIntent({ objective: "grow", targetID: null, horizon: 6 }),
    { objective: "grow", targetID: null, horizon: 6 },
  );
  assert.deepEqual(
    normalizeHrafnIntent({ objective: "convert", targetID: "rival-a", horizon: 12 }),
    { objective: "convert", targetID: "rival-a", horizon: 12 },
  );

  for (const invalid of [
    null,
    {},
    { objective: "fortify", targetID: null, horizon: 6 },
    { objective: "grow", targetID: "rival-a", horizon: 6 },
    { objective: "convert", targetID: null, horizon: 6 },
    { objective: "convert", targetID: " rival-a", horizon: 6 },
    { objective: "grow", targetID: null, horizon: 1 },
    { objective: "grow", targetID: null, horizon: 13 },
    { objective: "grow", targetID: null, horizon: 6.5 },
    { objective: "grow", targetID: null, horizon: 6, risk: "low" },
  ]) {
    assert.equal(normalizeHrafnIntent(invalid), null);
  }
});

test("HI1 canonical JSON recursively sorts objects and preserves arrays", () => {
  assert.equal(
    canonicalHrafnIntentJSON({ z: 1, a: { z: 2, a: 3 }, list: [{ z: 4, a: 5 }, 6] }),
    '{"a":{"a":3,"z":2},"list":[{"a":5,"z":4},6],"z":1}',
  );
});

test("HI1 rejects non-string and duplicate legal action IDs before selection", () => {
  const foe = rival({ id: "foe", name: "Foe" });
  const hold = action("hold", "hold", "Hold");
  const base = attack(foe);

  for (const invalidActions of [
    [{ ...base, id: 7 }, hold],
    [{ ...base, id: "" }, hold],
    [base, { ...hold, id: base.id }],
  ]) {
    assert.throws(
      () => chooseHrafnIntentDecision({
        actions: invalidActions,
        observation: observation({ rivals: [foe] }),
      }),
      /legal action ID|duplicate legal action ID/,
    );
  }
});

test("exact-v5 compatibility restores the frozen support precedence", () => {
  const odin = rival({
    id: K1Z_MEMBERS[0].id,
    name: "K1Z odin free",
    tileShare: 0.04,
    isAllied: true,
  });
  const leader = rival({
    id: "leader",
    name: "Richard Higgins",
    tileShare: 0.22,
    relativeTroopRatio: 1.5,
  });
  const donation = action(
    "donate_troops:odin",
    "donate_troops",
    "Donate troops to odin free",
    { recipientID: odin.id, recipientName: odin.name },
  );
  const actions = [donation, attack(leader), action("hold", "hold", "Hold")];
  const obs = observation({ tileShare: 0.12, rivals: [odin, leader] });

  assert.equal(chooseHrafnAction(actions, obs).policyMarker, "vr1");
  assert.equal(
    chooseHrafnAction(actions, obs, [], { exactV5: true }).policyMarker,
    "dn1",
  );
});

test("exact-v5 compatibility restores its original social fallback", () => {
  const chat = action("chat:raven", "quick_chat", "Raven signal");
  const hold = action("hold", "hold", "Hold");
  assert.equal(
    chooseHrafnAction([hold, chat], observation(), [], { exactV5: true }).id,
    chat.id,
  );
});

test("grow intent can redirect an exact-v5 conversion into legal expansion", () => {
  const auri = rival({ id: "auri", name: "Auri", tileShare: 0.25 });
  const actions = [attack(auri), expand(), action("hold", "hold", "Hold")];
  const obs = observation({ rivals: [auri] });
  const result = chooseHrafnIntentDecision({
    actions,
    observation: obs,
    history: [],
    intent: { objective: "grow", targetID: null, horizon: 6 },
  });

  assert.equal(result.baseline.id, "attack:auri:25");
  assert.equal(result.action.id, "expand:terra-nullius:35");
  assert.equal(result.intentValid, true);
  assert.equal(result.intentApplied, true);
  assert.equal(result.actionDelta, true);
  assert.equal(result.action.intentMarker, "hi1");
  assert.equal(publicHrafnReason(result.action), "[K1Z] r4vn:atk:hi1");
});

test("convert intent binds exact-v5 autonomy to one exact outsider", () => {
  const leader = rival({ id: "leader", name: "Leader", tileShare: 0.3 });
  const side = rival({ id: "side", name: "Side", tileShare: 0.18 });
  const actions = [
    attack(leader),
    attack(side),
    expand(),
    action("hold", "hold", "Hold"),
  ];
  const result = chooseHrafnIntentDecision({
    actions,
    observation: observation({ rivals: [leader, side] }),
    history: [],
    intent: { objective: "convert", targetID: side.id, horizon: 4 },
  });

  assert.equal(result.baseline.id, "attack:leader:25");
  assert.equal(result.action.id, "attack:side:25");
  assert.equal(result.intentApplied, true);
  assert.equal(result.action.intentMarker, "hi1");
});

test("target-player-only conversion falls back without HI1 reach", () => {
  const foe = rival({ id: "foe", name: "Foe", tileShare: 0.3 });
  const targetPlayer = action(
    `target:${foe.id}`,
    "target_player",
    "Target Foe",
    { targetID: foe.id, targetName: foe.name },
  );
  const actions = [targetPlayer, action("hold", "hold", "Hold")];
  const observationValue = observation({ rivals: [foe] });
  const result = chooseHrafnIntentDecision({
    actions,
    observation: observationValue,
    intent: { objective: "convert", targetID: foe.id, horizon: 4 },
  });
  const snapshot = buildHrafnIntentSnapshot({
    actions,
    observation: observationValue,
  });

  assert.equal(result.action.id, result.baseline.id);
  assert.equal(result.intentValid, false);
  assert.equal(result.intentApplied, false);
  assert.equal(result.actionDelta, false);
  assert.equal(result.reason, "intent_unreachable");
  assert.equal(result.action.intentMarker, undefined);
  assert.deepEqual(snapshot.convertTargets, []);
});

test("an intent with no action delta has no public HI1 marker", () => {
  const leader = rival({ id: "leader", name: "Leader", tileShare: 0.3 });
  const actions = [attack(leader), expand(), action("hold", "hold", "Hold")];
  const result = chooseHrafnIntentDecision({
    actions,
    observation: observation({ rivals: [leader] }),
    intent: { objective: "convert", targetID: leader.id, horizon: 4 },
  });

  assert.equal(result.action.id, result.baseline.id);
  assert.equal(result.actionDelta, false);
  assert.equal(result.action.intentMarker, undefined);
  assert.doesNotMatch(publicHrafnReason(result.action), /hi1/);
});

test("unknown, allied, and every K1Z target fail back to exact-v5", () => {
  const outsider = rival({ id: "outsider", name: "Outsider", tileShare: 0.3 });
  for (const protectedTarget of [
    rival({ id: "ally", name: "Ally", isAllied: true }),
    ...K1Z_MEMBERS.map((member) => rival({
      id: member.id,
      name: member.names[0],
    })),
  ]) {
    const actions = [
      attack(outsider),
      attack(protectedTarget),
      expand(),
      action("hold", "hold", "Hold"),
    ];
    const result = chooseHrafnIntentDecision({
      actions,
      observation: observation({ rivals: [outsider, protectedTarget] }),
      intent: {
        objective: "convert",
        targetID: protectedTarget.id,
        horizon: 6,
      },
    });
    assert.equal(result.intentValid, false);
    assert.equal(result.action.id, result.baseline.id);
    assert.notEqual(result.action.id, `attack:${protectedTarget.id}:25`);
    assert.equal(result.action.intentMarker, undefined);
  }

  const unknown = chooseHrafnIntentDecision({
    actions: [attack(outsider), expand(), action("hold", "hold", "Hold")],
    observation: observation({ rivals: [outsider] }),
    intent: { objective: "convert", targetID: "missing", horizon: 6 },
  });
  assert.equal(unknown.intentValid, false);
  assert.equal(unknown.action.id, unknown.baseline.id);
});

test("grow cannot treat K1Z-targeted metadata or nuclear builds as growth", () => {
  const odin = rival({
    id: K1Z_MEMBERS[0].id,
    name: "K1Z odin free",
  });
  const outsider = rival({ id: "outsider", name: "Outsider", tileShare: 0.3 });
  const disguised = action(
    `attack:${odin.id}:35`,
    "attack",
    "Expand Terra Nullius 35%",
    {
      expansion: true,
      targetID: odin.id,
      targetName: odin.name,
      troopPercent: 35,
    },
  );
  const nuclearBuild = action(
    "build:Atom Bomb:300",
    "build",
    "Build Atom Bomb",
    { unit: "Atom Bomb", targetID: odin.id },
  );
  for (const falseGrowth of [disguised, nuclearBuild]) {
    const result = chooseHrafnIntentDecision({
      actions: [
        falseGrowth,
        attack(outsider),
        action("hold", "hold", "Hold"),
      ],
      observation: observation({ rivals: [odin, outsider] }),
      intent: { objective: "grow", targetID: null, horizon: 6 },
    });
    assert.equal(result.intentValid, false);
    assert.equal(result.action.id, result.baseline.id);
    assert.equal(result.action.intentMarker, undefined);
  }
});

test("wire actions cannot spoof internal policy, intent, or request markers", () => {
  const outsider = rival({ id: "outsider", name: "Outsider", tileShare: 0.3 });
  const poisoned = {
    ...attack(outsider),
    policyMarker: "dn1",
    intentMarker: "hi1",
    requestMarker: "qbad0",
    campaignStartDecision: 99,
  };
  const result = chooseHrafnIntentDecision({
    actions: [poisoned, expand(), action("hold", "hold", "Hold")],
    observation: observation({ rivals: [outsider] }),
    intent: null,
  });

  assert.equal(result.actionDelta, false);
  assert.equal(result.action.intentMarker, undefined);
  assert.doesNotMatch(publicHrafnReason(result.action), /hi1|qbad0|dn1/);
});

test("the common HI1 wrapper omits game-authored chat in both arms", () => {
  const chat = action("chat:raven", "quick_chat", "Unbounded game text");
  const hold = action("hold", "hold", "Hold");
  for (const intent of [null, { objective: "grow", targetID: null, horizon: 6 }]) {
    const result = chooseHrafnIntentDecision({
      actions: [hold, chat],
      observation: observation(),
      intent,
    });
    assert.equal(result.action.id, hold.id);
    assert.equal(result.wrapperOmittedCount, 1);
    assert.equal(result.intentApplied, false);
  }
});

test("convert rejects duplicate IDs and conflicting target signals", () => {
  const odin = rival({
    id: K1Z_MEMBERS[0].id,
    name: "K1Z odin free",
  });
  const outsider = rival({ id: "duplicate", name: "Outsider" });
  const duplicate = rival({ id: "duplicate", name: "Second Outsider" });
  const conflict = action(
    "attack:duplicate:25",
    "attack",
    "Attack outsider 25%",
    {
      targetID: outsider.id,
      targetName: odin.name,
      troopPercent: 25,
    },
  );
  for (const rivals of [[odin, outsider], [outsider, duplicate]]) {
    const result = chooseHrafnIntentDecision({
      actions: [conflict, expand(), action("hold", "hold", "Hold")],
      observation: observation({ rivals }),
      intent: {
        objective: "convert",
        targetID: outsider.id,
        horizon: 6,
      },
    });
    assert.equal(result.intentValid, false);
    assert.equal(result.action.intentMarker, undefined);
    assert.notEqual(result.action.id, conflict.id);
  }
});

test("intent cannot override spawn or severe defense", () => {
  const foe = rival({ id: "foe", name: "Foe", tileShare: 0.3 });
  const spawn = action("spawn:100", "spawn", "Spawn 100");
  const spawning = chooseHrafnIntentDecision({
    actions: [spawn, attack(foe), expand()],
    observation: observation({ rivals: [foe] }),
    intent: { objective: "grow", targetID: null, horizon: 6 },
  });
  assert.equal(spawning.action.id, spawn.id);
  assert.equal(spawning.intentApplied, false);

  const sam = action("build:SAM Launcher", "build", "Build SAM Launcher");
  const pressured = chooseHrafnIntentDecision({
    actions: [sam, attack(foe), expand(), action("hold", "hold", "Hold")],
    observation: observation({
      troopRatio: 0.6,
      incomingAttacks: 1,
      incomingAttackPlayerIDs: [foe.id],
      rivals: [{ ...foe, incomingAttack: true }],
    }),
    intent: { objective: "convert", targetID: foe.id, horizon: 6 },
  });
  assert.equal(pressured.action.id, sam.id);
  assert.equal(pressured.action.policyMarker, "sk1");
  assert.equal(pressured.intentApplied, false);
});

test("intent cannot override K1Z alliance or Odin support", () => {
  const unalliedOdin = rival({
    id: K1Z_MEMBERS[0].id,
    name: "K1Z odin free",
    tileShare: 0.04,
    isAllied: false,
  });
  const alliedOdin = { ...unalliedOdin, isAllied: true };
  const foe = rival({ id: "foe", name: "Foe", tileShare: 0.3 });
  const alliance = action(
    `alliance_request:${unalliedOdin.id}`,
    "alliance_request",
    "Alliance with Odin",
    {
      recipientID: unalliedOdin.id,
      recipientName: unalliedOdin.name,
      relation: 1,
    },
  );
  const donation = action(
    `donate_troops:${alliedOdin.id}`,
    "donate_troops",
    "Support Odin",
    { recipientID: alliedOdin.id, recipientName: alliedOdin.name },
  );
  for (const [protectedAction, odin] of [
    [alliance, unalliedOdin],
    [donation, alliedOdin],
  ]) {
    const result = chooseHrafnIntentDecision({
      actions: [protectedAction, attack(foe), expand(), action("hold", "hold")],
      observation: observation({ rivals: [odin, foe] }),
      intent: { objective: "grow", targetID: null, horizon: 6 },
    });
    assert.equal(result.action.id, protectedAction.id);
    assert.equal(result.intentApplied, false);
    assert.equal(result.reason, "intent_hard_guard");
  }
});

test("planner snapshot exposes affordances and target IDs but no legal-action text", () => {
  const foe = rival({ id: "foe-id", name: "Do Not Leak This Label" });
  const actions = [attack(foe), expand(), action("hold-secret", "hold", "Secret Hold")];
  const snapshot = buildHrafnIntentSnapshot({
    actions,
    observation: observation({ rivals: [foe] }),
    history: [],
  });
  const bytes = JSON.stringify(snapshot);

  assert.equal(snapshot.growPossible, true);
  assert.equal(snapshot.convertTargets[0].targetID, foe.id);
  assert.doesNotMatch(bytes, /attack:foe-id:25/);
  assert.doesNotMatch(bytes, /Do Not Leak This Label/);
  assert.doesNotMatch(bytes, /hold-secret/);
  assert.doesNotMatch(bytes, /Secret Hold/);
});

test("Ollama planner enforces root JSON and returns truthful failures", async () => {
  let capturedBody;
  const planner = createOllamaHrafnIntentPlanner({
    fetchImpl: async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          model: "llama3:latest",
          response: JSON.stringify({
            objective: "grow",
            targetID: null,
            horizon: 6,
          }),
        }),
      };
    },
    now: (() => {
      let value = 100;
      return () => value += 5;
    })(),
  });
  const planned = await planner.plan({
    growPossible: true,
    convertTargets: [],
    own: { tileShare: 0.05, troopRatio: 1 },
  });

  assert.equal(planned.ok, true);
  assert.deepEqual(planned.intent, {
    objective: "grow",
    targetID: null,
    horizon: 6,
  });
  assert.equal(capturedBody.stream, false);
  assert.equal(capturedBody.format.additionalProperties, false);
  assert.deepEqual(capturedBody.format.required, [
    "objective",
    "targetID",
    "horizon",
  ]);

  const malformed = createOllamaHrafnIntentPlanner({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ model: "llama3:latest", response: "{not-json" }),
    }),
  });
  const failure = await malformed.plan({ growPossible: true, convertTargets: [] });
  assert.equal(failure.ok, false);
  assert.match(failure.error, /invalid planner JSON/);
  assert.equal(failure.intent, null);
});

test("Ollama planner rejects missing or wrong returned model identity", async () => {
  const validIntent = JSON.stringify({
    objective: "grow",
    targetID: null,
    horizon: 6,
  });
  for (const [body, expected] of [
    [{ response: validIntent }, /missing returned model/],
    [{ model: "gemma3:27b", response: validIntent }, /returned model mismatch/],
  ]) {
    const planner = createOllamaHrafnIntentPlanner({
      fetchImpl: async () => ({
        ok: true,
        json: async () => body,
      }),
    });
    const result = await planner.plan({ growPossible: true, convertTargets: [] });
    assert.equal(result.ok, false);
    assert.equal(result.intent, null);
    assert.match(result.error, expected);
  }
});

test("Ollama planner reports HTTP, transport, and timeout failures", async () => {
  const http = createOllamaHrafnIntentPlanner({
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  assert.match((await http.plan({})).error, /planner HTTP 503/);

  const transport = createOllamaHrafnIntentPlanner({
    fetchImpl: async () => {
      throw new Error("connection refused");
    },
  });
  assert.match((await transport.plan({})).error, /connection refused/);

  const timeout = createOllamaHrafnIntentPlanner({
    timeoutMs: 10,
    fetchImpl: async (_url, { signal }) => await new Promise((_, reject) => {
      signal.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    }),
  });
  assert.equal((await timeout.plan({})).error, "planner timeout");
});

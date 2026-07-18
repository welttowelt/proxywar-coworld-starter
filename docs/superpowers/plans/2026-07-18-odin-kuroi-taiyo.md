# Odin Kuroi Taiyō Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Tsukuyomi no Kage into a deterministic nuclear kingmaker that protects `odin free`, launches every safe non-Odin nuke, and makes Odin the winner.

**Architecture:** Keep the existing single-file deferred Claude planner, but make the local legal-action scorer authoritative for the kingmaker invariants. Add Node built-in tests that construct live-shaped observations and actions, then deploy the tested image as the next `tsukuyomi-no-kage` policy version and verify hosted replay evidence.

**Tech Stack:** Node.js ES modules, `node:test`, JavaScript, Docker `linux/amd64`, Coworld CLI, hosted ProxyWar replay JSONL.

## Global Constraints

- `odin free` is the only protected player and the intended winner.
- Never choose a targeted attack, boat, warship, nuke, embargo, target mark, alliance rejection, or alliance break against Odin.
- Build one Missile Silo at the first legal opportunity.
- Choose every known-target nuclear action offered against a living non-Odin rival.
- Preserve a 750,000-gold Atom Bomb reserve before making gold donations when possible.
- Keep Japanese-inspired Tsukuyomi no Kage / Kuroi Taiyō language.
- Preserve the current deferred Bedrock planner, websocket protocol, anti-loop logic, and the pre-existing uncommitted v34 work in `llm-player.mjs`.
- Do not commit the dirty `llm-player.mjs` without explicit user authorization; deployment does not require a source commit.

---

## File map

- Modify `llm-player.mjs`: Kuroi Taiyō strategy text, Odin protection, rival targeting, Missile Silo priority, safe nuclear scoring, and Odin support.
- Create `llm-player.test.mjs`: deterministic live-shaped decision tests.
- Modify `package.json`: expose the Node test command.
- Do not modify `launch.sh`: its existing Docker upload path already produces the next policy version.

### Task 1: Add failing kingmaker decision tests

**Files:**

- Create: `llm-player.test.mjs`
- Modify: `package.json`
- Test: `llm-player.test.mjs`

**Interfaces:**

- Consumes: exported `choose(actions, observation)` from `llm-player.mjs`.
- Produces: `npm test`, a deterministic test gate for safe nukes, Odin protection, silo construction, and strongest-rival targeting.

- [ ] **Step 1: Add the test script to `package.json`**

Insert this field before `dependencies`:

```json
"scripts": {
  "test": "PROXYWAR_SELF_TEST=1 node --test llm-player.test.mjs"
},
```

- [ ] **Step 2: Create the live-shaped test fixture**

Create `llm-player.test.mjs` with this complete content:

```js
import test from "node:test";
import assert from "node:assert/strict";

process.env.PROXYWAR_SELF_TEST = "1";
const { choose } = await import("./llm-player.mjs?kuroi-taiyo-test");

const player = (name, playerID, tileShare, overrides = {}) => ({
  name,
  playerID,
  isAlive: true,
  tileShare,
  relativeTroopRatio: 1.5,
  sharesBorder: true,
  canAttack: true,
  isAllied: false,
  ...overrides,
});

const observation = (rivals) => ({
  turnNumber: 12000,
  phase: "active",
  ownState: {
    tileShare: 0.24,
    troops: 2_000_000,
    troopRatio: 0.8,
    gold: 10_000_000,
    incomingAttacks: [],
  },
  visiblePlayers: rivals,
  endgame: {
    leaderName: "odin free",
    leaderTileShare: 0.4,
    ownTileShare: 0.24,
    turnsToTimer: 100,
  },
  tacticalAffordances: {
    transportTroopBanking: { incomingThreatRatio: 0 },
    economyCadence: {
      homeDanger: "low",
      recommended: false,
      recentExpansionCount: 4,
      recentBuildCount: 1,
    },
    navalControl: { recommended: false },
  },
});

const odin = player("odin free", "odin-1", 0.4, { isAllied: true });
const strong = player("Takeda Rival", "rival-strong", 0.32, { relativeTroopRatio: 1.2 });
const weak = player("Mori Rival", "rival-weak", 0.1, { relativeTroopRatio: 2.2 });
const obs = observation([odin, strong, weak]);

const hold = { id: "hold", kind: "hold", risk: { level: "low" }, metadata: {} };
const attack = (target, percent = 40) => ({
  id: `attack:${target.playerID}:${percent}`,
  kind: "attack",
  risk: { level: "medium" },
  metadata: {
    targetID: target.playerID,
    targetName: target.name,
    relativeTroopRatio: target.relativeTroopRatio,
    targetTileShare: target.tileShare,
  },
});
const nuke = (unit, target, priority = 180) => ({
  id: `build:${unit}:silo-1`,
  kind: "nuke",
  risk: { level: "high" },
  metadata: {
    unit,
    targetID: target.playerID,
    targetName: target.name,
    nuclearTargetPriority: priority,
    targetStructurePriority: 94,
    targetSamCoverage: 0,
  },
});

test("Kuroi Taiyo always fires a safe non-Odin nuke", () => {
  assert.equal(choose([attack(strong), nuke("Atom Bomb", strong), hold], obs).kind, "nuke");
});

test("Kuroi Taiyo never fires a nuke at Odin", () => {
  assert.equal(choose([nuke("Atom Bomb", odin), hold], obs).id, "hold");
});

test("Kuroi Taiyo prefers MIRV when nuclear target priority is equal", () => {
  assert.equal(
    choose([nuke("Atom Bomb", strong), nuke("Hydrogen Bomb", strong), nuke("MIRV", strong)], obs).metadata.unit,
    "MIRV",
  );
});

test("Kuroi Taiyo builds its first Missile Silo before ordinary combat", () => {
  const silo = {
    id: "build:Missile Silo:440044",
    kind: "build",
    risk: { level: "low" },
    metadata: { unit: "Missile Silo", cost: "1000000" },
  };
  assert.equal(choose([attack(weak), attack(strong), silo, hold], obs).id, silo.id);
});

test("Kuroi Taiyo attacks the strongest reachable non-Odin rival", () => {
  assert.equal(choose([attack(weak), attack(strong), hold], obs).metadata.targetID, strong.playerID);
});

test("Kuroi Taiyo never breaks its alliance with Odin", () => {
  const breakOdin = {
    id: "break_alliance:odin-1",
    kind: "break_alliance",
    risk: { level: "low" },
    metadata: { targetID: odin.playerID, targetName: odin.name },
  };
  assert.equal(choose([breakOdin, hold], obs).id, "hold");
});
```

- [ ] **Step 3: Run the tests and verify the old scorer fails the new requirements**

Run:

```bash
npm test
```

Expected: FAIL for safe nuke selection, MIRV preference, first Missile Silo priority, and strongest-rival targeting. Odin-protection tests may already pass.

### Task 2: Implement deterministic Kuroi Taiyō scoring

**Files:**

- Modify: `llm-player.mjs:37-61`
- Modify: `llm-player.mjs:199-269`
- Modify: `llm-player.mjs:278-335`
- Modify: `llm-player.mjs:375-473`
- Test: `llm-player.test.mjs`

**Interfaces:**

- Consumes: live `legalActions`, `visiblePlayers`, `ownState`, `endgame`, and action `metadata` fields already passed to `scoreAction`.
- Produces: `choose(actions, obs)` with Odin-safe nuclear-first behavior.

- [ ] **Step 1: Replace the old self-winning strategy with Kuroi Taiyō orders**

Keep `SHADOW_FRIEND`, then add these constants and replace `STRATEGY`:

```js
const SHADOW_FRIEND = "odin free";
const KINZOKU_RESERVE = 750_000;
const KUROI_TAIYO_SCORE = 20_000;
const KAKUSHI_MISAIRU_JO_SCORE = 12_000;
const HARMFUL_TO_SHOGUN = new Set([
  "attack", "boat", "warship", "move_warship", "nuke", "embargo",
  "target_player", "alliance_reject", "break_alliance",
]);
const WAR_BASE_SHARE = 0.22;
const EXECUTION_RATIO = 1.8;
const RUNAWAY_SHARE = 0.35;
const STRATEGY = [
  "You command Tsukuyomi no Kage under the Kuroi Taiyo doctrine. Odin Free is the protected shogun and must win.",
  "Never target, attack, embargo, reject, betray, or nuke Odin. Preserve and extend the alliance and aid him with gold or troops.",
  "You are Odin's shinobi shield and nuclear spear, not a rival claimant. Your own victory is irrelevant when it conflicts with Odin's.",
  "Raise one kakushi misairu-jo, the hidden Missile Silo, at the first legal opportunity.",
  "Set allowNuke true. Every legal nuclear strike against a non-Odin daimyo is mandatory; prefer MIRV, then Hydrogen Bomb, then Atom Bomb when target priority is equal.",
  "Attack the strongest reachable non-Odin daimyo. Break leaders, destroy their economy, and keep every rival below Odin.",
  "Grow, build shiro, and defend the honmaru only enough to preserve the nuclear platform and continue the campaign.",
  "When Odin leads, donate strength, attack all surviving rivals, and accept self-sacrifice if it directly secures his victory.",
  "Keep the protected relationship private in every public reason.",
].join(" ");
```

Change the prompt's `allowNuke` schema line to:

```js
'"allowNuke":true,' +
```

- [ ] **Step 2: Recognize live nuclear weapon actions and rank them**

Replace `isNuclear` and add `nuclearWeaponRank`:

```js
const isNuclear = (a) => a.kind === "nuke" ||
  /\b(?:nuke|nuclear|atom bomb|hydrogen bomb|mirv)\b/i.test(actionText(a));
const nuclearWeaponRank = (a) => {
  const unit = buildUnit(a);
  if (unit === "mirv") return 3;
  if (unit === "hydrogen bomb") return 2;
  if (unit === "atom bomb") return 1;
  return 0;
};
```

Place `nuclearWeaponRank` after `buildUnit` if needed so `buildUnit` is initialized before use.

- [ ] **Step 3: Make Odin's strongest rival the focus target**

At the start of `pickTarget`, after `enemies` is created, add:

```js
const odinPresent = rivals.some((p) => clean(p.name).toLowerCase() === SHADOW_FRIEND);
if (odinPresent) {
  const reachable = enemies.filter((p) => p.canAttack || p.sharesBorder);
  const threats = reachable.length > 0 ? reachable : enemies;
  return clean([...threats].sort((a, b) =>
    (Number(b.tileShare) || 0) - (Number(a.tileShare) || 0)
  )[0]?.name) || null;
}
```

This branch deliberately overrides the old execution-target and duel-lock logic only when Odin is present.

- [ ] **Step 4: Store silo construction in decision history**

Add `buildUnit` to the object pushed by `remember`:

```js
buildUnit: action.kind === "build" ? buildUnit(action) : "",
```

- [ ] **Step 5: Replace planner-gated nukes with the hard Odin-safe nuclear hierarchy**

In `scoreAction`, replace the existing `shadowFriend`, `friendMove`, high-risk, and nuclear gate with:

```js
const shadowFriend = rivals.find((p) => clean(p.name).toLowerCase() === SHADOW_FRIEND);
const friendMove = mentions(a, SHADOW_FRIEND) || Boolean(shadowFriend && targetsPlayer(a, shadowFriend));
const friendSafe = ["alliance_request", "alliance_extend"].includes(kind) ||
  isSupport(a) || ["quick_chat", "emoji", "hold"].includes(kind);

if (friendMove && (isNuclear(a) || HARMFUL_TO_SHOGUN.has(kind))) return -Infinity;
if (friendMove && !friendSafe) return -Infinity;
if (kind === "embargo_all") return -Infinity;
if (isNuclear(a)) {
  const knownTarget = Boolean(actionTargetName(a) || actionTargetID(a));
  if (!knownTarget) return -Infinity;
  const priority = Number(a?.metadata?.nuclearTargetPriority) || 0;
  const structure = Number(a?.metadata?.targetStructurePriority) || 0;
  const samCoverage = Number(a?.metadata?.targetSamCoverage) || 0;
  return KUROI_TAIYO_SCORE + priority * 10 + structure +
    nuclearWeaponRank(a) * 250 - samCoverage * 500;
}
if (a.risk?.level === "high") return -Infinity;
```

Remove the old `plan?.allowNuke` condition. The local safety invariant is authoritative.

- [ ] **Step 6: Give the first Missile Silo absolute non-nuclear priority**

At the beginning of the `kind === "build"` branch, use `buildUnit(a)` instead of `actionText(a)` for the unit name and insert:

```js
const unit = buildUnit(a);
if (unit === "missile silo") {
  const siloAlreadyOrdered = history.some((decision) => decision.buildUnit === "missile silo");
  return siloAlreadyOrdered ? 520 : KAKUSHI_MISAIRU_JO_SCORE;
}
```

Update the existing unit tests inside that branch from `unit.includes(...)` to continue working with the normalized unit string.

- [ ] **Step 7: Raise Odin alliance and aid above ordinary actions without outranking silos or nukes**

Replace alliance and support scores with:

```js
if (kind === "alliance_request") {
  const alreadyRequestedFriend = history.some((d) => d.kind === "alliance_request");
  return friendMove && !alreadyRequestedFriend ? 3_000 : -Infinity;
}
if (kind === "alliance_extend") return friendMove ? 3_200 : -Infinity;
if (isSupport(a)) {
  const recentAid = history.slice(-8).some((d) => d.kind === kind);
  const keepsReserve = kind !== "donate_gold" || Number(own.gold) >= KINZOKU_RESERVE * 3;
  return friendMove && keepsReserve && !recentAid ? 2_400 : -Infinity;
}
```

- [ ] **Step 8: Run the deterministic test gate**

Run:

```bash
npm test
node --check llm-player.mjs
git diff --check
```

Expected: six tests pass, syntax check exits 0, and diff check prints nothing.

### Task 3: Build, upload, submit, and verify hosted behavior

**Files:**

- Read: `Dockerfile`
- Read: `launch.sh`
- Read: hosted replay `decisions.jsonl`

**Interfaces:**

- Consumes: tested local `llm-player.mjs` and active Softmax login.
- Produces: next `tsukuyomi-no-kage` policy version, league submission, policy ID, and hosted evidence.

- [ ] **Step 1: Build the exact hosted image**

Run:

```bash
docker build --platform linux/amd64 -t proxywar-agent-llm:latest .
```

Expected: build exits 0 and the image contains `/app/llm-player.mjs`.

- [ ] **Step 2: Upload the next Japanese policy version**

Run:

```bash
bash launch.sh tsukuyomi-no-kage --yes
```

Expected: upload succeeds and prints the new policy-version ID. Record both version label and UUID.

- [ ] **Step 3: Submit it to the active league with automatic champion promotion**

Resolve the uploaded version and UUID, then submit that exact version:

```bash
read -r VERSION POLICY_ID < <(
  uvx --from coworld python - <<'PY'
from coworld.api_client import CoworldApiClient
with CoworldApiClient.from_login(server_url="https://softmax.com/api") as client:
    pv = client.lookup_policy_version(name="tsukuyomi-no-kage")
    print(f"v{pv.version} {pv.id}")
PY
)
uvx --from coworld coworld submit "tsukuyomi-no-kage:${VERSION}" \
  --league league_cb60d526-ecfd-4836-ab3a-81fc6cf7dc42 \
  --no-open-browser \
  --auto-champion always
```

Expected: a submission ID is printed and qualifier episodes are scheduled.

- [ ] **Step 4: Verify membership and submission state**

Run:

```bash
uvx --from coworld coworld memberships --mine --json > /tmp/kuroi-memberships.json
uvx --from coworld coworld submissions --mine --json > /tmp/kuroi-submissions.json
jq '.[] | select(.league_id=="league_cb60d526-ecfd-4836-ab3a-81fc6cf7dc42")' /tmp/kuroi-memberships.json
jq '.[0]' /tmp/kuroi-submissions.json
```

Expected: the new submission is qualifying or placed; after qualification, membership champion policy version matches the new UUID.

- [ ] **Step 5: Download all available hosted replays for the new version**

Run:

```bash
uvx --from coworld coworld episodes \
  --policy "tsukuyomi-no-kage:${VERSION}" --mine --with-replay --limit 1000 --json \
  > /tmp/kuroi-episodes.json
mkdir -p /tmp/kuroi-replays
jq -r '.[] | [.id,.replay_url] | @tsv' /tmp/kuroi-episodes.json |
while IFS=$'\t' read -r id url; do
  curl -fsSL "$url" -o "/tmp/kuroi-replays/${id}.replay"
done
```

Expected: every completed hosted episode with a replay URL has a local replay file.

- [ ] **Step 6: Audit selected actions and nuclear opportunities**

Run:

```bash
for replay in /tmp/kuroi-replays/*.replay; do
  jq -r '.inlineRunArtifacts["decisions.jsonl"] // empty' "$replay"
done > /tmp/kuroi-decisions.jsonl

jq -s '
  [ .[] | select(.username=="katanasan") ] as $ours |
  {
    decisions: ($ours|length),
    rejected: ([$ours[] | select(.result.accepted != true)]|length),
    fallback: ([$ours[] | select(.fallbackUsed == true)]|length),
    degraded: ([$ours[] | select(.llmPlannerDegraded == true)]|length),
    silo_builds: [$ours[] | select(.selectedLegalActionId|contains("Missile Silo")) | {turnNumber,selectedLegalActionId,accepted:.result.accepted}],
    nukes: [$ours[] | select(.selectedActionKind=="nuke") | {turnNumber,weapon:.selectedActionMetadata.unit,target:.selectedActionMetadata.targetName,accepted:.result.accepted}],
    harmful_to_odin: [$ours[] |
      select(((.selectedActionMetadata.targetName // "")|ascii_downcase)=="odin free") |
      select(.selectedActionKind as $kind |
        ["attack","boat","warship","move_warship","nuke","embargo","target_player","alliance_reject","break_alliance"] |
        index($kind)
      )
    ] | length
  }
' /tmp/kuroi-decisions.jsonl
```

Expected: rejected 0, fallback 0, harmful_to_odin 0; if a Missile Silo was legal it appears as an accepted build; every selected nuke names a non-Odin target and is accepted.

- [ ] **Step 7: Check for missed safe nuclear opportunities**

Run:

```bash
jq -s '
  [ .[] | select(.username=="katanasan") |
    select((.legalActionIDsByKind.nuke // [] | length) > 0) |
    select((.tacticalAffordances.lateGameStrikeTargeting.bestStrikeTargetName // "" | ascii_downcase) != "odin free") |
    select(.selectedActionKind != "nuke") |
    {turnNumber, target:.tacticalAffordances.lateGameStrikeTargeting.bestStrikeTargetName, legalNukes:.legalActionIDsByKind.nuke, selectedLegalActionId}
  ]
' /tmp/kuroi-decisions.jsonl
```

Expected: `[]`. If nuclear actions are absent because the environment never offered a safe target, report that honestly and continue verification on competition replays.

- [ ] **Step 8: Report the handoff**

Report the new policy-version ID, version label, submission ID, champion state, qualifier results, accepted Missile Silo and nuke counts, Odin-harm count, and any remaining evidence gap. Do not claim nuclear success unless a hosted replay contains an accepted non-Odin `nuke` action.

# Return: underpants planner-transport repair (review lane → build lane)

Answers `handoffs/2026-08-08-claude-odin-underpants.md`. Full forensics:
`/tmp/claude-proxywar-review-underpants.md` (mirrored as a claude.ai artifact).
Patch: `handoffs/patches/2026-08-08-underpants-planner-transport-repair.patch`
(+401/−21 on `084e82d6`, applies clean with `git apply`).

## Verdict

`underpants switch speed:v2` degraded 464/488 decisions because its strict
whole-response planner parser rejects provider-framed replies (markdown
fences, leading/trailing prose) that carry a valid typed packet. Board-state
independent; all 18 successes were null-target intents; the same
`us.anthropic.claude-sonnet-4-6` planned successfully through the lenient
fa2ea1e8-era parser in a third-party fork the same day. The six
unknown-action holds were stale `alliance:<code>` selections absent from the
turn's legal set. The deployed v2 source itself is unrecoverable — built
2026-08-07 from an uncommitted tree; its compound-intent dialect exists in no
commit — so the repair applies to the nearest committed source (fa2ea1e8
chassis + `intent-controller.mjs`).

## The patch (parsing + identity only; selector untouched)

- `intent-controller.mjs`: transport recovery — accept exactly one complete
  top-level JSON object per reply (string-aware balanced scan; one whole-reply
  fence stripped). Zero/multiple objects, stray braces, truncation → null.
  Semantic layer unchanged: exact keys, exact rival-ID identity, integer
  horizon, unknown intents rejected.
- `llm-player.mjs`: wire-boundary identity gate — never emit an ID absent
  from the current legal list; stale plan target → plan-free deterministic
  selection (never unknown, never synthetic hold); flags report `planApplied`.
- `.dockerignore`: **landing-path fix** — the committed allowlist never
  included `intent-controller.mjs` / `captain-underpants-production-doctrine.mjs`,
  so a clean-tree `docker build --target production` fails at HEAD (every
  captain image to date was built from a locally-dirty tree). Two lines added.
- Tests: new `test/planner-contract-regression.test.mjs` (red on parent at
  exactly the round-1325 classes); the two wrapper-rejection assertions
  (unit + integration) updated to the renegotiated transport contract —
  that is the entire doctrine change, made loudly.

## Verification

- Full suite: parent 8 fails (6 pre-existing r8/r9/rci + 2 designed reds);
  candidate 411/417 — only the 6 pre-existing, both reds green.
- Matched fixture arms (identical scripted decisions, parent | candidate):
  fenced-grow refresh failures 2|0, degraded 24|1 (first plan in flight);
  extra-keys and truncated stay fail-closed on both (by design);
  unknown IDs 0|0 and holds 0|0 in every arm; framed-vs-bare tactical
  selections identical.
- **Real-engine gate** (local `coworld run-episode`, proxywar 0.1.25
  certification fixture, both slots on one image, identical prose-framed
  fixture reply): parent image logs one planner refresh failure per player
  (`plan refresh failed: plan reply had no valid intent`) and finishes its
  active decision degraded (`dgd:err:atk`, fallbackUsed=true); the candidate
  image logs **zero** refresh failures and executes the plan
  (`pln:atk`, fallbackUsed=false); every selection was engine-accepted
  (no unknown IDs, no rejects). Also confirms
  `deterministic fairness-assigned spawn slot` is engine-emitted.
- Runner notes for reproduction: repo-pinned `coworld==0.1.28` cannot parse
  the 0.1.25 manifest (`episode_timeout_minutes`, `tags` unexpected) — use
  coworld ≥0.1.38; player images need `--run node --run /app/llm-player.mjs`
  because the manifest's default player argv points at the engine's own
  starter file.

## Ship runbook (build lane's call — nothing platform-side was touched)

The `odinfree max underpants` credential is the default bound player on this
Mac, and league `auto_champion` is `always`: an upload is live next round.

```bash
git apply handoffs/patches/2026-08-08-underpants-planner-transport-repair.patch
node --test   # planner suite green; 6 pre-existing r8/r9/rci fails unrelated
docker build --target production -t proxywar-underpants-v3:$(git rev-parse --short HEAD) .
uvx --from coworld==0.1.28 coworld upload-policy \
  proxywar-underpants-v3:$(git rev-parse --short HEAD) \
  --name "underpants switch speed" \
  --use-bedrock --bedrock-model us.anthropic.claude-sonnet-4-6 \
  --secret-env PLAN_MODE=on \
  --tag repair=planner-transport --tag source=$(git rev-parse HEAD)
uvx --from coworld==0.1.28 coworld submit   # then watch next round telemetry
```

Decision points: local fixtures cannot measure the live sonnet reply-shape
distribution (no host Bedrock credentials anywhere reachable); the first
post-upload round IS the live probe. Success = BOOTSTRAP failure share
collapses toward genuine semantic rejections; INTENT share dominates.
Tag the upload with the source SHA so v3 never repeats the v2 provenance gap.

## #1 campaign ladder (Oli goal 2026-08-08: dominate, rank 1)

1. **Land this repair** — at rank 21 with 95.7% degraded runtime nothing else
   is measurable. Gate: BOOTSTRAP share ≈ 0 in next-round telemetry.
2. **Deal engagement arm** — the committed selector is deal-blind
   (`deal_propose`/`deal_accept` appear nowhere; round 1325 offered deals on
   485 decisions, selected 0) while 0.1.24+ scoring/design centers
   negotiation, trust, and betrayal. Separate arm, per the handoff's
   no-mixing rule.
3. **Targeted-intent tactics** — only after live telemetry shows healthy
   convert-intent flow (all v2 successes were null-target; measure how often
   the model names eligible targets before tuning).
4. **Switch-speed semantics** — if wanted, re-derive from the committed
   grow|convert dialect with committed tests; the deployed compound dialect
   is gone and should not be reverse-worshipped.

— Claude-Proxywar, 2026-08-08

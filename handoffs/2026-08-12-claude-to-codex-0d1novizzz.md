# Handover: 0d1novizzz returns to Codex

From the Claude lane, 2026-08-12 ~14:15Z, on Oli's instruction. Everything below is
receipt-backed on branch `claude/0d1novizzz-candidate` @ 444f4cfd (pushed); the full
per-ship receipt chain lives in `experiments/receipt-0d1novizzz-candidate-v11-20260809.md`.

## Current verified state

- Player: `0d1novizzz` / ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863 (softmax account also
  carries `odinfree max underpants` — the account's DEFAULT player; see gotcha 1).
- Live policy: `xX_UwU_Senpai_420_Xx:v17`, pv 65fab9b8-3eed-4689-a5fb-5a515fa54461,
  sub_af93ce15 (placed), membership lpm_487f5bf0 — auto-champion; swap from v16 was
  pending verification at handover time.
- Standing: #8, score 9.94 (daveey #1 at 17.76, Jordan 15.71, Calc 12.92). League =
  16P variants, engine 0.1.35, ~7.9 rounds/day.
- Watch loop: STOPPED at handover. No Claude-side mutations will follow.

## The scoring model (reverse-engineered, fit SSE 0.00018)

standing = 100 × EWMA(per-round episode-win share), λ = 0.9707 per played round,
half-life ≈ 23 rounds (~3 days). Round score = wins/episodes that round. Steady state =
100 × win-share: sustain 0.27 to tie daveey's form, 0.33 to take #1 in ~2 days. A zero
round costs 2.9% of standing; everything self-heals — consistency > peaks.

## Ship chain (all under verified 0d1novizzz unless noted)

- v12 (a1946e26): deal desk (accept NAP/TSP, propose 1 NAP, pact-keeping in
  rivalIsProtected) + Dockerfile/.dockerignore repro fix. 2 outright wins early.
- v13 (234377dc): +44 spawn fingerprints (0.1.35/16P sets incl. regenerated
  Pangaea/World; ambiguity rule: colliding tile → no fingerprint) + ah1 (accept pending
  inbound native alliance offers, gates: prey≥1.3/convert-target/2-ally-cap/1-per-6).
- v14 (01b82cb0): +ne1 (multi-silo rotation to 4, silo>port, nk1 share gate 0.08).
  ne1 never fired live — we die before the build economy matters.
- v15 (05a67103): +PLAN_MODE=on — RACED onto underpants by a concurrent context flip;
  contained (lpm_5af1ae95 retired). DO NOT reuse v15.
- v16 (b636e4ee): same, correct player. Proved PLAN_MODE=on takes effect but planner
  DEGRADES (dgd:err:*) — hosted pods 403 direct Bedrock calls.
- v17 (65fab9b8, LIVE): + sidecar fix — client now uses AWS_ENDPOINT_URL_BEDROCK_RUNTIME
  as baseURL (pods front Bedrock with a per-pod sidecar since ~2026-07-30; v10's
  planner-ON era predated it, all Claude rebuilds v12-v14 ran planner-OFF entirely —
  that deployment regression is the chain's root).

## Open items, in priority order

1. VERIFY v17 mechanism: first v17 replay's sampled decisions must show pln:* reasons
   (planner alive through sidecar). If still dgd:err:*, try --secret-env
   BEDROCK_MODEL=us.anthropic.claude-haiku-4-5-20251001-v1:0 or read episode-logs.
2. Preregistered bar on v17: promote ≥0.15 mean win-share over first 3 scored rounds;
   kill <0.066 → rollback to v13 (v14's kill bar already fired; v13's window was closed
   early with documented rationale — see receipts).
3. The 16P autopsy (5-agent, 18 replays — full transcripts in the session workflow dir,
   summary in receipts) says the losses are multi-front gang-kills; winners' separators:
   nuke economy on the Jordan/Calc clock (17.4 bombs/ep vs our 0.9 — ne1 was the first
   cut, insufficient alone), 2-8x strike mass (rejected as high regression risk),
   native alliance conversion (ah1 shipped; zero offers appeared since — the offer wave
   may have been a 12P-era behavior).
4. NorthAmerica-16P + Europe spawn tiles unharvested (no replays seen yet); recipe in
   strategy-engine.mjs comments (2-episode agreement, collision check — precedent 534350).
5. Structured-deal contract v2 (upstream DEALS.md): joint_attack accepts are free value
   (proposer-only obligation), rivalReliability floor, proposalOptions — the desk
   predates all of it. Upstream starter also carries prompt-hardening + cost controls.

## Gotchas (each cost us something)

1. PLAYER CONTEXT RACES: `softmax player use` is account-global state; concurrent
   sessions flip it. ALWAYS: switch → upload → submit → VERIFY the submission's player
   field, as one uninterrupted sequence. Two cross-lane mis-ships happened (v11, v15);
   both contained by retire + audit note.
2. Underpants lane: mass-disqualified by Oli-as-Odin deliberately. Leave it alone.
3. 0.1.35 hosted replays have NO inline decisions.jsonl — mine spectatorReplay.snapshots
   (sampled decisions incl. reasons + menus), deal-ledger.json, game-record.json intents.
   The collector handles this (deals.ndjson staged; missing decision streams non-fatal).
4. qd1n-mutation tests fail unless branch HEAD is pushed to origin (receipt tests).
5. coworld==0.1.28 CLI has manifest-schema skew vs new engines; use coworld==0.1.38.
   API is slow/flaky: validate JSON before parsing, retry once, background long calls.
6. Scoring nuance: rounds where we're unseated don't decay the EWMA (played rounds only).

## Standing orders inherited

Oli (as Odin): "we must be number 1". The lane goal is sustained ≥0.33 round win-share.
The Claude lane stands down on submits/retires/memberships from now; available for
review/analysis on request.

— Claude (0d1novizzz lane)

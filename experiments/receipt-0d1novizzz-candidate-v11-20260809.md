# 0d1novizzz candidate v11 — receipt chain (prepared, NOT uploaded)

Prepared 2026-08-09 by the Claude 0d1novizzz lane under Oli's "fix everything"
directive. Upload/submit deliberately NOT executed: both are named in the
handover boundary (handoffs/2026-08-08-claude-0d1novizzz.md) and in Odin's
fail-closed guard. Everything below is hash-bound so either operator can ship
it with one command and a verified chain.

## Source

- Branch: `claude/0d1novizzz-candidate` (pushed to origin)
- HEAD: `a2065d8b` — "recover the rotating-map meta: fingerprints,
  map-agnostic ug1, collector"
- Merge lineage: `claude/0d1novizzz-deals` @ 025b6d00 (deal desk +
  pact-keeping + build-reproducibility fix) × `claude/0d1novizzz-ug1` @
  bea41b2e (upgrade-lock conversion guard, adversarially verified) over
  origin/main @ 30906cb9.
- Suite at HEAD: 437 pass / 6 fail — failures are the pre-existing live-state
  baseline set (mickey r8/r9 manifests, launchd reaper, live RCI), none in
  policy code. qd1n-mutation receipt tests: 6/6 green with HEAD pushed.

## What changed vs deployed v10 (three arms, all evidence-backed)

1. Structured deals (0.1.26): deterministic deal desk on the separate
   `selectedDealActionId` slot + pact-keeping across the whole move channel.
   Observed live locally (4P Pangaea self-play): 20 NAPs, 11 accepted,
   0 pact violations. Field gap: round 1331 had 91 proposals, 0 accepts
   league-wide.
2. Rotating-map recovery: spawn-tile fingerprints for BlackSea/EastAsia/
   NorthAmerica/Oceania (deterministic, harvested from live replays;
   ambiguous tile 534350 fingerprints as neither), and the collapse-window
   root cause addressed.
3. Map-agnostic ug1: upgrade-lock conversion release now fires on any map;
   all safety gates intact (share band [0.002, 0.15), 8-decision pressure
   lookback, troopRatio >= 0.8, shared cv1/ug1 1-per-7 cooldown,
   authoritative-target-only release, pact partners refused).

## Image

- Local build: `proxywar-agent-candidate:local`
- Image ID: `sha256:b17245a03304dc667c27b0b120de95ab349eb97948bf0bfbc3a1576fd302d070`
- Built from HEAD `a2065d8b` with `docker build --platform linux/amd64
  --build-arg POLICY_CODENAME=b0lverk-h0gg .` — reproducible from the branch
  (the .dockerignore allowlist gap that made v10 unreproducible is fixed in
  this lineage).

## Local observation runs

- 4P Pangaea (deals arm, image from 025b6d00): winner = most active
  dealmaker; ledger `scratchpad/play4p/proxywar-runs/*/deal-ledger.json`.
- 4P Europe (new-generation map, full candidate image, engine 0.1.26):
  VERDICT HEALTHY — 400 decisions, 0 fallbacks, full 10,300-turn match on an
  unfingerprinted map; 21 deals proposed / 9 accepted; action mix 271 attack /
  79 boat / 26 build / 1 upgrade (no upgrade-lock formed, ug1 correctly
  silent; cv1 fired 5x); all four seats alive at the end. The exact regime
  where v10 posted five 0-win rounds.

## Ship commands (operator-only, in order)

```bash
# 1) upload as the next version of the live policy (creates v11, changes nothing live)
uvx --from coworld==0.1.38 coworld upload-policy proxywar-agent-candidate:local \
  --name "xX_UwU_Senpai_420_Xx" --use-bedrock \
  --run node --run /app/llm-player.mjs \
  --tag codename=b0lverk-h0gg --tag source_commit=a2065d8b

# 2) verify the returned policy_version id, then submit to the league
#    (this is the live action: membership lpm_2b006ee6-4787-4325-a00d-ee6a25f8418a)
uvx --from coworld==0.1.38 coworld submit <policy_version_id>
```

## Shipped receipts (2026-08-09, on Oli's explicit "Ship it now")

- Uploaded: `xX_UwU_Senpai_420_Xx:v11`, policy_version
  `0898bd15-2bbd-438f-add3-a6775fc1e2f6` (image sha256:b17245a0..., source
  commit a2065d8b).
- Submitted: `sub_40bb7ac9-b0bb-4fa3-b183-3c3cf285d392`, league
  `league_cb60d526-ecfd-4836-ab3a-81fc6cf7dc42`, status pending,
  auto-champion: always (placement async).
- Membership: lpm_2b006ee6-4787-4325-a00d-ee6a25f8418a — verify champion swap
  to v11 once placement completes.

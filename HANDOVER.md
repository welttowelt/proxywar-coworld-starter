# ProxyWar Qd1n lane — handover (2026-07-19)

**Roles: Codex Odin owns this lane** (implementation, deployments, runner,
league operations). **Kimi K3 Max remains the external moonshot adviser**
(review, deep diagnosis, coalition continuity). Kimi is not a Codex/GPT agent.
Address implementation requests to Codex Odin; coordinate strategic forks with
the real Kimi K3 through the established mailbox or handoff channel.

**Hrafn is a separate writable game operator**, not a Codex subagent. Hrafn
owns `hrafn-fylking` code and league versions from
`/Users/olifreuler/proxywar-k1z-hrafn`; Codex Odin owns `qd1n` from this
repository. Each operator builds, uploads, submits, and promotes only its own
policy. The user granted standing authorization on 2026-07-19 for automatic
promotion after every gate in `AUTONOMOUS_PROMOTION.md` passes; no additional
user `GO` is required. Cross-audits are read-only and travel through the team
mailbox.

New worker: this is the live state and the next work. Read `AGENTS.md`,
`MERIT.md` (the merit ledger — every arm verdict), and
`experiments/README.md` first. Everything below is verified there or in the
stormforge mailbox.

## Mission

Return `odin free` to overall #1 and build toward a verified 1000 consecutive
official first-place streak (interim milestone 100). Never report the streak
as achieved before the official completed-round sequence proves it. Current
verified streak: **0/1000** (latest completed checkpoint: round 527, rank 2).
Daveey leads overall (`32.3469` vs Odin `20.9567`); round 528 was still
running at the 2026-07-19 07:36 UTC audit.

## Live deployment truth

- `K1Z odin free` — player `ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c`.
  Champion: **qd1n:v89** (`ca4a4e76-fd83-4c92-bf9f-f2440d1f867f`, submission
  `sub_d159efaa`, membership `lpm_7f695f76-b1d6-43e9-8af6-338a041ccfa6`).
- Coalition (all protect each other by pinned ID + canonical name):
  `K1Z katanasan` `ply_8b6cec26...` on `tsukuyomi-no-kage:v39`;
  `K1Z juryoku-koku` `ply_c0dfb76c...` on `santai-juryoku:v3`;
  `K1Z Hrafn` `ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863` on `hrafn-fylking:v5`
  (champion `10c32300`).
- qd1n:v89 enforces: mx3 base (ia1 Asia attribution, pc1 World counter),
  kp1/kp2 kingmaker (protect + alliance-request all three allies, 6-decision
  per-partner retry), nk1 nukes on outsiders only. Zero harmful actions vs
  allies is contract-absolute.

## The campaign so far (all rejected, all in MERIT.md)

OE1, NF1, NC1, NC2, NR1, NR2, PN1, US1, PE1(v90), DP1(v91), GC1-v1 — none
produced a matched advantage. Key confirmed diagnoses:

1. **Social churn**: v91 leaders spent 122 and 82 of 503 capped decisions on
   alliance requests (per-partner cooldown x 3 partners = permanent stream);
   territory froze at peak. GC1 (global 8-decision cadence) cut request rate
   ~30% but tied tiles exactly — non-promotable, gate closed.
2. **Upgrade churn**: R516 slot 8 (island seat) burned 167/171 decisions on
   productive upgrades while frozen at 25,519 tiles, 98% troop cap, 3 legal
   boat launches, banking recommended. US1 (the naval escape arm) already
   tested and rejected. DP1 (Defense Posts) rejected.
3. **GC1 generic bypass**: `bestAllianceRequest` issues unmarked generic
   requests after the kp2 gate — v1's requests split 62 tagged + 21 unmarked.

## Current experiment: GC2

GC2 implements the assigned isolated global alliance-request arbitration gate
over tagged `kp2` and generic `bestAllianceRequest` output. Any outbound
request resets one eight-decision clock; incoming K1Z reverse handshakes bypass
the clock; suppression requires a concrete chooser-approved tactical action;
the request is retained instead of producing hold or protected-K1Z harm.

- Branch: `rci/gc2`
- Commit: `9efe990d900f16ff6ae08013d0c48bfad0092a4b`
- Exact parent commit: `f1347251834a6283182b631e1336595eb2e08342`
- Candidate strategy SHA-256:
  `7270e4175b25f31844e16d3f0a80211e6c6beeb27d5c3f9f5e567dd1b8838a18`
- Candidate player SHA-256:
  `e34e62dcb306ae82dbc419d2a0d5bf2ec5240fb2d17609568e378be1437abc7c`
- Tests: `152/152`
- Local image: `proxywar-agent-llm:qd1n-v89-gc2-amd64`,
  `sha256:593eedf2fa9dd7ee70c24800da6fedcbc203baf5b8310ca0185022be14207677`,
  verified `linux/amd64` with both files byte-identical to the commit.

Hrafn released build and matched Pangaea testing in mailbox commit `551992b`.
Source and image identity pass; Coworld qualifier, replay-visible reach, and
the matched candidate-versus-parent verdict are still pending. Stop on zero
GC2 reach, any rejection, unexplained hold, K1Z harm, or absent matched
advantage. Hosted, upload, submission, membership, champion, and league work
remain closed.

Hrafn's setup RCI at mailbox commit `1229a93` supersedes the earlier immediate
runner release. Keep GC2 source unchanged. Before the qualifier or matched
pair, validate
`experiments/preflight-qd1n-global-alliance-arbitration-gc2.json`, use the
repository mirror auditor, pin `coworld==0.1.30`, record the exact manifest,
game-config, parent-image, candidate-image, and fresh A/B request hashes, and
report container marker reach as pending until the matched replay proves it.
Run GR1 only after the isolated GC2 verdict; never fuse the two arms.

## Coordination protocol (coalition)

- Mailbox: git repo `welttowelt/stormforge-ecdsa-team-mailbox` at
  `/Users/olifreuler/.stormforge/team-mailbox` (pull --ff-only, plain-English
  markdown files, commit + push). Kimi deleted the former watcher and handed
  polling to Codex Odin. Check explicitly during active work; do not claim a
  background monitor or recreate a scheduler without an operator request.
- Runner discipline: never start a local Coworld episode while another lane's
  gate owns the runner; coordinate in the mailbox first and use
  `scripts/proxywar-runner-lease.sh acquire odin|hrafn`. Release the lease after
  every episode or completed batch.
- Mailbox writes use the atomic lock at
  `/Users/olifreuler/.stormforge/proxywar-operators/mailbox-write.lock`: acquire,
  pull fast-forward only, write/commit/push, then release.
- Hrafn is a local best friend and an independent auditor — expect red-first
  review of any candidate; they will find your hold paths and confounds.
- Public in-game text: short leetspeak. Repo/mailbox prose: plain English.

## Automatic operator and promotion protocol

- Odin is launched from this repository, so its project configuration loads
  `gpt-5.6-sol` at high reasoning. Hrafn is launched from
  `/Users/olifreuler/proxywar-k1z-hrafn`, which loads xhigh reasoning.
- The launch agents are event-driven. A mailbox change wakes both lanes; Odin
  also performs a bounded hourly refresh and Hrafn a bounded four-hour refresh.
  Lock files prevent overlapping cycles.
- Operators act only in their own policy lane. At the pre-run,
  pre-diagnostic-upload, and final-promotion checkpoints, the other operator
  reviews the committed branch and returns an `APPROVE`, `REVISE`, `REJECT`, or
  `INSUFFICIENT` mailbox verdict.
- Diagnostic upload and hosted testing proceed automatically after the local
  gates and cross-audit pass. League submission and champion promotion proceed
  automatically after hosted `4/4`, regression `20/20`, final cross-audit, live
  identity verification, and immutable image verification pass.
- `AUTONOMOUS_PROMOTION.md` is authoritative for state transitions and failure
  handling. No current GC2 gate is waived by this authority change.

## Working setup

- Main repo: `/Users/olifreuler/proxywar-coworld-starter` (GitHub
  `welttowelt/proxywar-coworld-starter`). A background dashboard updater
  advances main and dirties `data/` — recheck status before every
  integration, never stage data files, integrate worktree commits via
  cherry-pick or clean file checkout.
- Candidate worktree: `/Users/olifreuler/proxywar-qd1n-gc2`, branch
  `rci/gc2`, exact commit `9efe990d`.
- Tests: `npm test` (`152/152` on GC2).
  Red-first discipline: every guard gets a failing test before the fix.
- GC2 qualifier and local mirrors: pin `coworld==0.1.30`. Do not substitute
  another runtime without a new matched preflight.
- Images: `docker build --platform linux/amd64 --build-arg
  POLICY_CODENAME=s4ntai -t proxywar-agent-llm:<tag> .`; verify with
  `docker run --rm --entrypoint cat <img> /app/strategy-engine.mjs | diff -q
  - strategy-engine.mjs`.
- League CLI: `uvx --from coworld==0.1.28 coworld <cmd>` (upload-policy,
  submit, memberships, submissions, episodes, run-episode). Auth: softmax
  session (check `softmax player list` — should show K1Z odin free active);
  listings may need the user token (`softmax.auth.load_user_token`) when a
  player session scopes them.
- Hosted diagnostics: POST `/api/observatory/v2/experience-requests`
  (8/12 policy-version IDs per episode); roster reference in
  `HRAFN_TO_ODIN_GC1_LIVE_AUDIT_20260719.md` and `/tmp/oe1-hosted-prep.json`
  if still present.

## Standing rules

Sanctioned play only (no cheating, no credential access, no opponent
infrastructure). No league change from local results alone — matched
advantage, then hosted gate, then league. Record everything truthfully in
MERIT.md including rejections; a tidy NO SUBMIT beats a hopeful upload.

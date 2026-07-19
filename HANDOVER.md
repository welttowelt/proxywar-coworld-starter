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
verified streak: **1/1000**. Round 534 completed with Odin rank 1 at `0.75`:
three episode wins from
four appearances, including two outright wins and one turn-cap top score. The
previous round 533 was rank 10, so the streak starts at round 534. Overall
Competition standings after round 534 are daveey `31.03102579981558` and Odin
`22.27009729025311`, a gap of `8.760928509562472`. Round 535 was running at
the 2026-07-19 15:11 UTC audit and does not count yet. Refresh live state
before reporting a later result. Exact `qd1n:v89` remains sealed as Odin's
champion.

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

## Current experiment: PG2

GC2, GR1, and ZG1 are closed. PG2 is the sole active Odin arm. It changes only
the commitment of an already selected productive neutral-land attack during
the first twenty decisions: when exact v89 selected a legal 10% or 20%
frontier expansion under the preregistered safety conditions, PG2 selects the
largest otherwise identical legal option up to 35%. It does not change the
action class or K1Z priority.

- Clean candidate worktree: `/Users/olifreuler/proxywar-qd1n-pg2`
- Branch and commit: `origin/rci/pg2@42e9a181`
- Exact parent: `f1347251834a6283182b631e1336595eb2e08342`
- Strategy SHA-256:
  `7bd75b1c7f85030083eb6416c0b966508e6c81227ac02c674742cdb2b999540b`
- Player SHA-256:
  `1154115fdf5ebb89fa170bba6060d5a730615970d4cc23c00dbfa97e42b31563`
- Candidate tests: `163/163`
- Linux/amd64 image:
  `proxywar-agent-llm:qd1n-v89-pg2-amd64`,
  `sha256:3f01ffafd10079a3f0a9ead1704481df623bceedad0ad0f7f47fea77344e6b5d`
- Immutable archive:
  `/private/tmp/proxywar-pg2-reach-bundle-42e9a181.tar.gz`,
  SHA-256
  `d2f2f154a67f43008a9b8f7cc0e2c66d44d825e088434cf165fe3b751240b9cd`
- Formal A/B request SHA-256:
  `a2e75d096904e0612d083d9bb58aafc7ab8cae75f0e2f6cc073eb800b6e8341c`
  and
  `7df76692757232999644d2deb9d011597ae8bc12be025ebc89cf2815044d6c22`

The repaired review request is mailbox commit `a0e233f`. Old approval
`ee7ea9b` covers defective, superseded bytes and grants no run authority.
Before any execution, require a fresh committed Hrafn approval naming repaired
commit `42e9a181`, image `3f01ffaf...`, and archive `d2f2f154...`.

The first approval can open only a remote linux/amd64 validate-only transport
check followed by one supervised same-host sequential formal A-then-B reach
pair. Both arms use seed `20260720`, Pangaea Compact, the same four-policy K1Z
roster, and an 80-decision horizon. Stop after the pair and request an evidence
verdict. Zero reach, action-class divergence, unexplained hold/reject, fallback
regression, K1Z harm, transport drift, or non-positive candidate evidence
rejects PG2. A positive canary may request the preregistered 24-pair matrix; it
does not authorize upload, submission, membership, or champion mutation.

## Coordination protocol (coalition)

- Mailbox: git repo `welttowelt/stormforge-ecdsa-team-mailbox` at
  `/Users/olifreuler/.stormforge/team-mailbox` (pull --ff-only, plain-English
  markdown files, commit + push). Kimi deleted the former watcher and handed
  polling to Codex Odin. Check explicitly during active work; do not claim a
  background monitor or recreate a scheduler without an operator request.
- Runner discipline: never start a local Coworld episode while another lane's
  gate owns the runner. Coordinate in the mailbox, then put the complete
  episode or batch under the long-lived supervisor:

  ```bash
  scripts/proxywar-runner-lease.sh run odin RUN_ID \
    --output /private/tmp/new-output-a \
    --output /private/tmp/new-output-b \
    -- /absolute/path/to/batch-script.sh
  ```

  Use `hrafn` for the Hrafn lane. When detaching, the screen session must run
  this wrapper; do not acquire in a short-lived shell and launch Coworld
  separately. The v2 lock binds lane, run ID, opaque token, supervisor PID/start
  signature, child PID/process group, acquisition time, and output paths.
  `RUN_ID` is capped at 80 safe characters. Each output must be a nonexistent
  dedicated directory under `PROXYWAR_RUNNER_OUTPUT_ROOTS` (default
  `/private/tmp`); the supervisor pre-creates it with a token/inode ownership
  marker. Same-lane and cross-lane re-entry are strictly busy, and a successful
  foreground batch releases only its own exact lease.
- Inspect runner state with
  `scripts/proxywar-runner-lease.sh status --json`. Never delete `runner.lock`,
  quit another run's screen, kill its supervisor, or broadly stop
  `coworld-run-*` containers. After a crash, read the exact run ID and token
  from the lock and use
  `scripts/proxywar-runner-lease.sh reap-stale odin|hrafn RUN_ID TOKEN`.
  Reaping refuses a live supervisor, terminates only its bound child process
  group, removes only containers mounted to its recorded output directories,
  re-scans Docker, and moves ownership-validated partial outputs to timestamped
  `aborted` paths with non-evidence receipts. Docker or ownership uncertainty
  preserves the lock and output. The JSON lifecycle events on stderr provide
  acquisition, child, signal, cleanup, quarantine, refusal, and release
  receipts without exposing the token.
- Migration boundary: the two-argument `release <lane>` exists only so the
  pure tokenless v1 lock present during rollout can release once. Standalone
  `acquire` is a fail-closed transition shim and never creates a lock. Before
  deploying v2, Hrafn's lane owner must commit and acknowledge a prompt that
  uses the supervised `run` form. The launcher refuses an old Hrafn `acquire`
  prompt before touching the mailbox, cursor, or wake marker, including when
  the command is line-wrapped. It opens only after positively matching the
  complete lane-specific `run ... --output ... -- command` protocol.
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
  Operator locks prevent overlapping automatic cycles. A live same-lane runner
  lease also stops the launcher before Codex starts, without advancing the
  mailbox cursor or consuming the wake marker. The same fail-closed behavior
  applies to stale same-lane, legacy same-lane, initializing, reaping, corrupt,
  invalid-status, and unmigrated-prompt states. A launch/run race still closes
  at the runner's atomic mutation guard and tokenized lock.
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
- Candidate worktree: `/Users/olifreuler/proxywar-qd1n-pg2`, branch
  `rci/pg2`, exact commit `42e9a181`.
- Tests: `npm test` (`163/163` on PG2). Runner/bundle verification is
  `192/192`.
  Red-first discipline: every guard gets a failing test before the fix.
- PG2 execution uses the runtime and exact requests embedded in the immutable
  bundle. Do not substitute another runtime or rebuild from current main.
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

# ProxyWar Qd1n lane — handover (2026-07-19)

New worker: this is the live state and the next work. Read `AGENTS.md`,
`MERIT.md` (the merit ledger — every arm verdict), and
`experiments/README.md` first. Everything below is verified there or in the
stormforge mailbox.

## Mission

Keep `odin free` overall #1 and build toward a verified 1000 consecutive
official first-place streak (interim milestone 100). Never report the streak
as achieved before the official completed-round sequence proves it. Current
verified streak: **0/1000** (latest: round 524, rank 10). daveey leads
overall (~31.5 vs ~22.8).

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

## NEXT ASSIGNED WORK (from Hrafn, `b445628`)

Build **one isolated global alliance-request arbitration gate** (`ga1`
suggested): cover BOTH the tagged kp2 path AND the generic
`bestAllianceRequest` path, preserve K1Z no-harm and immediate acceptance of
incoming K1Z offers. Gates required before any league change: replay-visible
reach, accepted tactical replacement, zero unexplained holds/rejects, exact
matched advantage, hosted 4/4, regression 20/20. Do NOT start US1, DP1,
hosted, upload, submission, membership, or champion work.

**GC1-v2 receipt delivered** (mailbox `5194875`): pangaea-a byte-identical
to v1, pangaea-b trajectory shifted by the patch (no advantage claimed);
holds 1 — the pre-existing turn-9,700 unexplained class (attacks+boats
legal, no alliance legal), confirmed separate from the suppression-to-hold
bug; rejects 0, K1Z harm 0, suppression stack persisted. GC1 is fully
closed. Hrafn's quarantined DP1+CF1 composition owns the runner next.

## Coordination protocol (coalition)

- Mailbox: git repo `welttowelt/stormforge-ecdsa-team-mailbox` at
  `/Users/olifreuler/.stormforge/team-mailbox` (pull --ff-only, plain-English
  markdown files, commit + push). A 15-min cron (`4592fe28`) watches it —
  recreate an equivalent watcher.
- Runner discipline: never start a local Coworld episode while another lane's
  gate owns the runner; coordinate in the mailbox first.
- Hrafn is a local best friend and an independent auditor — expect red-first
  review of any candidate; they will find your hold paths and confounds.
- Public in-game text: short leetspeak. Repo/mailbox prose: plain English.

## Working setup

- Main repo: `/Users/olifreuler/proxywar-coworld-starter` (GitHub
  `welttowelt/proxywar-coworld-starter`). A background dashboard updater
  advances main and dirties `data/` — recheck status before every
  integration, never stage data files, integrate worktree commits via
  cherry-pick or clean file checkout.
- Candidate worktree: `/tmp/proxywar-rci11-mapmix` (detached; HEAD
  `aa11ece7` = adopted GC1-v2 == main `eb53b530` content).
- Tests: `npm test` (main 154/154; worktree has extra legacy files).
  Red-first discipline: every guard gets a failing test before the fix.
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

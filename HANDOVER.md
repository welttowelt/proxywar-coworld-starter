# ProxyWar / Qd1n LLM handover

Snapshot: `2026-07-20T18:23:19Z`

> **Archived snapshot — do not execute its operator sequence.** The local
> Hrafn lane was retired on 2026-07-21. Hrafn now operates `hrafn-fylking`
> from Studio only. Mickey owns this Mac's local source, evaluation, Docker,
> and CPU-fanout work through the `mickey` runner lease; Mickey has no inherited
> player or league authority. Current operational truth lives only in
> [`.codex/active-arm.json`](.codex/active-arm.json),
> [`MISSION_COMMAND.md`](MISSION_COMMAND.md), and
> [`AUTONOMOUS_PROMOTION.md`](AUTONOMOUS_PROMOTION.md).

Canonical repository:
[`welttowelt/proxywar-coworld-starter`](https://github.com/welttowelt/proxywar-coworld-starter)

## Mission in one paragraph

Codex Odin operates `K1Z odin free` and must retake the ProxyWar lead by
improving general first-place conversion. Exact `qd1n:v89` remains the live
control while one bounded candidate is tested at a time. The current candidate
is `OS1`, a deterministic decision-20 opening scheduler derived from public
replay evidence. Its source is green, reviewed, committed, and pushed, but it
has no accepted image gate, qualifier, runtime evidence, upload, submission, or
league state. Do not describe it as an improvement until matched outcomes prove
one.

## Bootstrap order

Read these files in order:

1. [`.codex/active-arm.json`](.codex/active-arm.json) contains the dynamic arm and gate
   truth.
2. [`MISSION_COMMAND.md`](MISSION_COMMAND.md) contains the commander's intent.
3. [`AUTONOMOUS_PROMOTION.md`](AUTONOMOUS_PROMOTION.md) defines mutation authority
   and the complete promotion ladder.
4. [`experiments/daveey-policy-factory-invariant-20260720.md`](experiments/daveey-policy-factory-invariant-20260720.md)
   contains current opponent evidence and the OS1 rationale.
5. [`MERIT.md`](MERIT.md) stores terminal historical evidence. Do not treat every
   retained source row as live.

Before any current-state claim or external mutation, refresh the API. Cached
dashboard files and the replay profiler can lag the live league.

## Live state

The hash-bound
[`live handover snapshot`](experiments/receipt-qd1n-live-handover-20260720.json)
records the read-only API and local lock checks:

- Active identity: `K1Z odin free`
  (`ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c`).
- The shared CLI identity is set to Odin, not Hrafn. This says nothing about
  Hrafn's league membership.
- Sole active Qd1n champion: `qd1n:v89`.
- Policy-version ID: `ca4a4e76-fd83-4c92-bf9f-f2440d1f867f`.
- Competing membership: `lpm_7f695f76-b1d6-43e9-8af6-338a041ccfa6`.
- Runner lease: `free`.
- Qd1n mutation lock: `free`.
- Leaderboard: Daveey first at `41.8191`, Odin second at `17.8826`.
- Latest completed round: `577`; Odin rank `10`, score `0`.
- Odin ranks in rounds `570–577`: `3, 9, 2, 10, 3, 10, 8, 10`.
- Verified current first-place streak: `0`.

These values are timestamped evidence, not permanent constants.

Post-snapshot coordination update at `2026-07-20T18:47:21Z`: Odin switched the
shared Coworld identity to `K1Z Hrafn` for the separately bounded C4 local
window. The runner and Qd1n mutation locks remained free. The sealed advisory
receipt is mailbox commit
[`1b8b2b6`](https://github.com/welttowelt/stormforge-ecdsa-team-mailbox/commit/1b8b2b6add8100c69b2f228de7283b374242c548).
Hrafn must restore `K1Z odin free` after its second mirror or an earlier stop.
This identity handoff did not change a policy, membership, champion, or league
state.

Repository history records live v89 submission
`sub_d159efaa-f3f1-4641-acd0-51bba2e04a72`. Git and executable-file
comparison, rather than the league API, establish
`f1347251834a6283182b631e1336595eb2e08342` as the exact executable parent for
candidate comparisons.

## Authority and lane separation

- Codex Odin is the only writable `qd1n` operator.
- Hrafn is a separate `hrafn-fylking` operator. It may run a separately
  user-authorized local experiment under its own runner lease. It cannot edit
  or run Qd1n, upload or submit a policy, change memberships, or change champion
  state.
- Kimi K3 Max is an external adviser. Treat its proposals as hypotheses until
  repository evidence verifies them.
- The Codex Wrapper Observer is read-only. It may report contradictions to the
  user but has no source, runner, identity, approval, or league authority.
- Automatic diagnostic upload and league promotion need no new user `GO` after
  every objective gate passes. Failed or ambiguous gates stop automatically.
- Slack is frozen through `2026-08-09T11:27:17Z`. Do not read, search, draft,
  post, react, or delegate any Slack work.

## Daveey evidence and its limits

The bounded evidence combines official rounds `557–576`, eight public hosted
Pangaea diagnostics from the same day and current top-12 field, a cross-game
membership census, and Auri's operator explanation. It is not a cross-map
runtime sample.

Verified replay facts:

| Signal | Daveey | Odin |
| --- | ---: | ---: |
| First-20 conquest decisions | 89.0% | 67.1% |
| First-20 social decisions | 0.5% | 21.5% |
| Median neutral commitment | 35% | 16% |
| Median rival commitment | 25% | 10% |
| Median first build turn | 800 | 1,600 |
| Median first rival attack turn | 1,700 | 6,250 |
| Median territory at decision 20 | 86,652 | 26,491 |

Across Daveey's eight sampled hosted replays:

- `881/881` non-spawn actions were accepted.
- Active decisions crossed Coworld's exact-action player bridge.
- `fallbackUsed=false` on all sampled decisions.
- Decision latency was median `2 ms`, p95 `4 ms`, maximum `35 ms`.
- Structured reasons use `WC24[boot]` and `WC24[open]`.
- Every sample built its first City on active decision five / turn `800`.
- The first rival action in every sample used `10%`.
- First rival contact entered around a `1.65–1.77` relative troop ratio.

The table's `25%` rival commitment is the overall median, not the first strike.

The best-supported invariant is a fast, work-conserving exact-action controller:
early City, nearly continuous conquest, early conversion from neutral to rival
land, and little opening social work. It is not fixation on one opponent.

### Correct attribution

Auri did **not** say Daveey uses external HTTP. Auri described his own starter
architecture: a model proposes focus, target, and preferred action types, then
deterministic `choose()` selects the exact offered legal action ID. He also said
the hard-coded rules and weights came from more than a month of scenario A/B
testing.

The Telegram sentence about a workflow "not accruing its learnings" came from
Calcutator, not Daveey. Keep these sources separate.

### What the Coworld bridge label proves

`brainType="external-http"` is a Coworld bridge label, not a Daveey-specific
architecture disclosure. The same replay assigns it to every entrant,
including Odin, Hrafn, Auri, Richard Higgins, Ron, and Daveey.
`externalActionCall=true` means an active policy decision crossed that bridge.
It does not reveal a private Daveey endpoint.

Coworld runs each player in a short-lived, one-episode container with
`restart_policy="Never"`, no ordinary persistent player volume, and a
digest-pinned hosted image. Cross-episode learning would need another
persistence path, such as an external database or service contacted by the
policy.

No public replay, repository artifact, or Telegram statement proves Daveey uses
such a path. The safe conclusion is:

- developer learning and repeated version promotion: proved;
- fixed-policy adaptation to each board: proved;
- parameter or memory updates between matches: unproved.

### Why unchanged v24 can dominate without a hidden update

The exact v24 UUID remained unchanged across Daveey's competition appearances
from rounds 518 through 577. Its mean raw score rose from `0.2935` over
R518-544 to `0.5051` over R545-577, while rank-one appearances rose from `5/23`
to `24/33`. The result change is real, but it is not a controlled experiment:
rosters, seats, seeds, maps, and spawn geometry changed.

Auri reported that the live leaderboard uses a 24-round EWMA and begins
decaying after two days. The implementation is not public, so treat this as
operator testimony. If accurate, recent field-relative results can make an
unchanged policy rise while older evidence loses weight. The scoring window and
field evolution form one plausible explanation. The public evidence does not
require or establish autonomous cross-match learning.

### Cross-game inference

Daveey's account shows a repeatable policy factory: 13 current champion-tier
memberships, six rank-one policies, 354 membership records, and 327 distinct
league/policy combinations at the recorded census. Several games show long,
named algorithm families and repeated revisions. Daveey is not universally
dominant. Crewrift Prime was rank 13, so the transferable edge appears to be the
evaluation-and-promotion loop, not one universal tactic.

This proves structured iteration and promotion. Replay-driven, manual, or
offline iteration are plausible mechanisms, not verified facts. The history
does not prove that ProxyWar v24 learns online.

## What not to copy from Daveey

- Do not replace Qd1n's hybrid selector with a pure synchronous LLM. Auri's
  starter description and Qd1n's own runtime support a deterministic executor
  with slower planning above it. Daveey's hidden upstream architecture remains
  unknown.
- Do not force `35%` attacks everywhere. GR1, EF2, and PG2 already tested the
  commitment-only variable and failed.
- Do not build a Daveey-only assassin. Direct-target arms failed to produce a
  general conversion edge.
- Do not accept decision-20 territory alone. TPL1 produced an early lift that
  vanished by decisions 30 and 50.
- Do not promote telemetry. ODC1 reached cleanly and still went `0/4` hosted.

## Current candidate: OS1

Source:

- Branch:
  [`rci/os1-opening-scheduler`](https://github.com/welttowelt/proxywar-coworld-starter/tree/rci/os1-opening-scheduler)
- Commit: `316c7a111aeebed4ebce00032287773492e39912`
- Exact parent: `f1347251834a6283182b631e1336595eb2e08342`
- Marker: `os1`
- Full suite: `158/158`
- Focused strategy suite: `114/114`
- Postimplementation RCI: `SHIP_TO_MECHANISM_SCREEN`

OS1 is a thin wrapper over exact v89 during the first 20 active decisions:

1. Preserve current pressure, collapse recovery, stalled-frontier recovery,
   spawn, positions at or above `0.12` tile share, and all post-window parent
   behavior.
2. After those delegation guards, accept a genuinely pending K1Z reverse
   handshake even if a request cooldown
   or another proactive partner would otherwise hide it.
3. Otherwise, on active decision five only, build the first legal non-high-risk
   City.
4. Otherwise convert into a bordered, attackable, non-K1Z rival when the replay-backed
   relative troop ratio is at least `1.6`.
5. Otherwise keep exact-parent attack cadence and commitment choices.
6. Mark only actions whose ID differs from the parent.

RCI caught and fixed two edge defects before source freeze: pending K1Z offers
could be lost inside the retry cooldown, and the City rule could fire after
decision five. Both now have regressions.

OS1 is only `SOURCE_READY`. A supervised attempt at `18:38:36Z` exited with
status 1 before a qualifier result or either orientation was produced. The
runner quarantined all three output roots as non-evidence. The attempted image
was locally observable and its extracted strategy bytes matched the candidate,
but that observation does not pass the image gate because the attempt preceded
the required hash-bound job addendum. No accepted qualifier, local mechanism
trace, matched outcome, upload, submission, membership, or champion change
exists. See the
[`aborted-attempt receipt`](experiments/receipt-qd1n-os1-aborted-local-attempt-20260720.json).

## Historical OS1 sequence

The sequence formerly recorded here is closed and must not be resumed. Read
`.codex/active-arm.json` for the single current transition. Local runs use only
`odin` or `mickey`; any `hrafn` runner command must fail closed.

The preregistered
[`local screen contract`](experiments/contract-qd1n-os1-local-screen-20260720.json)
defines the action sets, denominator, paired aggregation, tie handling, and
missing-data failure rule. Its short form:

- at least one `os1` marker in each orientation and one marked strong-rival
  conversion across the pair;
- at least `17/20` accepted land attacks in each candidate opening;
- at most one proactive social action in each candidate opening;
- candidate aggregate decision-20 tiles strictly above parent;
- candidate aggregate decision-50 tiles at least equal to parent;
- candidate placement points strictly above `1.0/2.0`;
- zero unexplained holds;
- zero rejected or degraded decisions;
- zero harmful action against K1Z.

An `os1` marker without territory and placement lift is a rejection.

## Runner and mutation discipline

Every local episode or batch must remain under:

```bash
scripts/proxywar-runner-lease.sh run odin RUN_ID \
  --output /private/tmp/new-output-a \
  --output /private/tmp/new-output-b \
  -- /absolute/path/to/batch-script.sh
```

Start only when `scripts/proxywar-runner-lease.sh status --json` reports
`free`. Use fresh output directories. Never release or reap another
supervisor, stop broad Coworld containers, or reuse another run's outputs.

All upload and league mutations must use
`scripts/proxywar-qd1n-mutation.sh run` after the required gate.

## Working-tree exclusions

At this handover snapshot, main contained updater-owned changes in:

- `data/processed/manifest.json`
- `data/processed/official_streak.json`

It also contained an untracked Python cache and PG2 helper script whose
ownership was not established. A concurrent worker also left
`scripts/run-os1-local-screen-316c7a11.sh`; it produced the quarantined attempt
and is not the immutable job addendum required by the current contract. Do not
stage, delete, reuse, or claim ownership of those files during the handover
commit.

## Durable evidence

- [Daveey policy-factory and opening invariant](experiments/daveey-policy-factory-invariant-20260720.md)
- [Read-only live handover snapshot](experiments/receipt-qd1n-live-handover-20260720.json)
- [OS1 source and RCI audit](experiments/audit-qd1n-os1-source-rci-20260720.json)
- [OS1 preregistered local screen](experiments/contract-qd1n-os1-local-screen-20260720.json)
- [OS1 quarantined non-evidence attempt](experiments/receipt-qd1n-os1-aborted-local-attempt-20260720.json)
- [ODC1 hosted rejection](experiments/audit-qd1n-odc1-rci2-hosted-4x-20260720.json)
- [Opening commitment overlap audit](experiments/audit-qd1n-opening-commitment-overlap-20260720.json)
- [Autonomous promotion states](AUTONOMOUS_PROMOTION.md)
- [Terminal merit ledger](MERIT.md)
- [Hrafn-hosted Daveey replay provenance](https://github.com/welttowelt/proxywar-coworld-starter/blob/rci/hrafn-dv1/experiments/hrafn-dv2-hosted-verdict-and-dv3-rci-20260720.md)

The coordination repository is
[`welttowelt/stormforge-ecdsa-team-mailbox`](https://github.com/welttowelt/stormforge-ecdsa-team-mailbox).
Use it only for exact review requests, runner handoffs, concrete blockers, and
terminal receipts.

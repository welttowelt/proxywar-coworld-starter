# Odin lean dominance mission

## Commander's intent

Retake the ProxyWar lead by improving Odin's general first-place conversion,
not by specializing against one opponent. Preserve exact `qd1n:v89` as the
live control and evaluate one bounded Qd1n mechanism at a time.

## Current truth

- Live control: `qd1n:v89`.
- Active candidate: `NB1 safe frontier boats`.
- Closed: PG2, A1, A2, A3, GR1, EF1, EF2, OE1, TPL1, and every other rejected
  arm in `MERIT.md`.
- PR1 is closed before source mutation because its Defense Post mechanism
  duplicates the rejected DP1 family.
- Frozen support: `hrafn-fylking:v5`, `tsukuyomi-no-kage:v39`, and
  `santai-juryoku:v3`.
- No direct-daveey or other named-opponent branch may open.
- KF1 remains a separate frozen K1Z-only endgame converter and must not be
  combined with NB1.

## NB1 hypothesis

Exact-v89 replay evidence exposes a repeated safe naval undercommitment. Across
the four PG2 hosted losses, Odin produced 43 safety-clean decisions where the parent selected
a neutral 8-percent boat, a same-destination 16-percent boat was legal, troop
ratio was at least 0.87, and current threat was zero. The same clean opportunity
appeared at turn 1600 in all four replays with troop ratio 0.95 and low danger.

NB1 changes exactly one already-selected action:

```text
parent selected a neutral 8-percent boat
AND troop ratio >= 0.87
AND current and protocol-level incoming threat are zero
AND a neutral 16-percent boat to the same destination is legal
=> select that 16-percent boat and emit nb1
```

Every other path remains exact v89. NB1 adds no opponent names, map routing,
target selection, action priority, diplomacy change, rival boat, or K1Z
exception.

## Promotion funnel

1. `SOURCE_READY`
   - branch from exact parent `f1347251834a6283182b631e1336595eb2e08342`;
   - red replay fixtures fail on the parent and pass with NB1;
   - threat, low-cap, rival/K1Z boat, and non-boat paths remain exact;
   - full suite passes and source is pushed.
2. `LOCAL_QUALIFIED`
   - exact linux/amd64 image matches committed source;
   - qualifier boots with accepted decisions;
   - one World and one Pangaea candidate-parent pair run under one foreground
     runner lease, four episodes total;
   - NB1 reaches in both candidate maps;
   - every marker is an accepted same-destination 16-percent neutral boat with
     the 8-percent form legal, troop ratio at least 0.87, and zero threat;
   - unexplained holds, rejects, and K1Z harm are zero;
   - combined first-launch ten-decision tile-gain delta is positive, retreat
     count does not increase, and combined paired score is positive.
3. `HOSTED_PASSED`
   - current-roster diagnostic completes `4/4`;
   - replay audit records reach, accepted decisions, placements, outcome,
     holds, rejects, K1Z safety, and replay hashes;
   - telemetry without a clean outcome is not a pass.
4. `REGRESSION_PASSED`
   - separate map-and-seat regression completes `20/20`;
   - immutable candidate and parent images are used throughout.
5. `RCI_AUDIT_PASSED`
   - final fail-closed audit has no unresolved source, image, roster, runtime,
     safety, identity, or outcome discrepancy.
6. Automatic deployment
   - upload/hosted, submission, placement, sole champion verification, and
     first completed official round remain separate recorded states;
   - no additional user `GO` is required after every objective gate passes.

The former 24-pair pre-hosted matrix is removed. PG2 passed 20 of 24 local
pairs and then failed hosted `0/4`, so that matrix was slow and weakly
predictive. The `20/20` regression runs only after hosted success.

## Failure rules

Close NB1 immediately on:

- zero mechanism reach in either declared map;
- an unexplained hold or rejected decision;
- harmful K1Z action;
- source, image, roster, runtime, or identity drift;
- non-positive combined first-launch ten-decision tile-gain delta;
- increased retreat count;
- non-positive combined paired score;
- hosted or regression failure.

Do not tune NB1 thresholds or create NB2. If NB1 fails, stop micro-guards and
request one structural mechanism review from the real Kimi K3 Max.

## Operating model

- Codex Odin is the sole writable operator and mutates Qd1n only.
- Hrafn is retired as an operator. Its live support policy is frozen.
- Kimi K3 Max is an external adviser and never mutates league state.
- All Coworld runs use `scripts/proxywar-runner-lease.sh run`.
- RunPod CPUs are evidence workers, not policy owners: four lanes for the
  two-pair screen, then scale only for the post-hosted `20/20`.
- Build each image once and distribute the immutable digest.
- `.codex/active-arm.json` is current operational truth.
- `MERIT.md` stores terminal evidence only.
- Mailbox writes are limited to terminal verdicts, exact review requests, or
  concrete blockers.
- Slack is frozen through 2026-08-09T11:27:17Z. No Slack interaction is
  permitted.

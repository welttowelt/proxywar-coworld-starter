# Captain Underpants Maximum Aura — CU1 plan

Recorded: 2026-07-23

## Entrant

- Player name: `Captain Underpants Maximum Aura`
- Proposed policy: `captain-underpants-max-aura:v1`
- Source branch: `rci/captain-underpants-cu1-20260723`
- Worktree: `/private/tmp/proxywar-captain-underpants-source-20260723`
- Exact behavioral parent: Mickey live-source commit
  `ce5c15b0a423590340595537ac5d7483e61d41a4`
- Candidate mechanism source: MR2 commit
  `c50025ef2775fcc5193b2cdb56b0abbbd7f71261`
- Live-player state: dedicated player
  `ply_02c1e39b-94af-4b38-8e12-645e6cd06ec1` exists. It has no policy,
  submission, league membership, or placement.

This entrant is separate from Odin, Hrafn, and Mickey. Mickey's source, image,
policy, membership, and account stay unchanged.

## RCI diagnosis

### Problem 1: model-centric attribution is false

Mickey's 644-episode snapshot used one fixed policy version and showed no
positive chronological learning curve. Strong finishes occurred with both
plan-heavy and almost entirely degraded/fallback decision streams. The
deterministic selector is the stable performance-bearing layer.

Smallest correction: make the first Captain Underpants experiment
deterministic-only. Do not introduce a model swap, prompt rewrite, or
cross-game learner in CU1.

### Problem 2: raw aggregate score hides seat and opening variance

Mickey's twelve-player mean score ranged from almost zero in seats 2 and 3 to
`0.323606` in seat 7. A pooled before/after comparison can therefore select a
seat mix instead of a mechanism.

Smallest correction: every CU1 decision uses mirrored candidate/control seats
and fixed map, roster, runtime package, parent image, and decision horizon.
Report each seat before any aggregate.

### Problem 3: repeated opening social actions consume growth windows

The MR2 diagnosis found 357 alliance requests in 1,637 recent Pangaea
decisions, with a static upper bound of 265 repeated requests. In two mirrored
20-active-decision openings, replacing eligible repeats with the unchanged
neutral-growth selector produced 111,584 candidate tiles versus 76,376 parent
tiles (`+46.098%`). Both arms used deterministic planner fallback throughout.

Smallest correction: carry exactly this one bounded replacement into CU1.

### Problem 4: current planner telemetry cannot prove a call

Background Bedrock calls do not set decision-time `externalPlannerCall`.
Reason prefixes prove whether a current plan reached the selector, but not
whether a background request succeeded.

Smallest correction: keep CU1 planner-off for the causal gate. Preregister a
separate telemetry-only planner instrumentation arm after CU1 receives a
terminal verdict; do not combine it with CU1.

## CU1 mechanism

During the first 20 active Pangaea decisions:

1. Preserve immediate inbound handshakes from protected partners.
2. Preserve the exact parent under current pressure or territorial collapse.
3. Allow an optional outbound protected-partner request when its 24-decision
   cooldown has elapsed.
4. When the exact parent repeats an outbound protected-partner request inside
   cooldown and a non-high-risk neutral expansion is legal, rerun the unchanged
   selector without alliance actions.
5. Accept the replacement only when that unchanged selector returns a legal
   neutral expansion.
6. Emit `cu1` on the replacement. Otherwise return the exact parent action.

The route table must include the two replay-proven Pangaea spawn tiles
`856604` and `855528`. Route recognition is reachability plumbing, not another
policy mechanism.

Hrafn remains protected in source until Softmax confirms the player is disabled
or deleted. Retirement intent is not sufficient evidence that the identity can
never reappear in a roster.

## Policy population

| Arm | Purpose | Planner | Behavioral delta |
| --- | --- | --- | --- |
| `CU0` | immutable control | off | exact `ce5c15b0` deterministic selector |
| `CU1` | opening-social-loop correction | off | one cooldown-bound neutral-growth replacement |
| `CU1-P` | future attribution arm | on, instrumented | none beyond CU1 |

`CU1-P` stays unopened until CU1 is accepted or rejected. This prevents planner
availability from confounding the deterministic correction.

## Preregistered local gate

### Phase A: red-first reach

- Exact parent fixture selects the repeated outbound alliance request.
- CU1 selects the exact offered neutral expansion and emits `cu1`.
- Inbound handshake, pressure, collapse, cooldown expiry, non-Pangaea, and
  no-neutral-action cases stay byte-for-byte parent-equivalent.
- Focused selector, deployed-player, and production-separation tests pass.
- The full suite introduces no failure beyond the four already-recorded,
  absolute-path-bound Mickey CPU-fanout activation failures.

### Phase B: matched full-game evidence

- Four mirrored twelve-player Normal Pangaea pairs.
- Cover two historically weak seats, the high-performing seat 7 context, and a
  late seat.
- Candidate and control swap seats within each pair.
- Hold map, roster, package, parent image, runtime version, and declared seed
  treatment fixed.
- One pre-announced run per cell; no quiet rerolls.

Required record per replay:

- replay SHA-256 and image/source identity;
- seat, spawn tile, final placement, win, survival, final tiles;
- tiles at turns 500, 1,000, 2,000, and 5,000;
- accepted decisions, holds, rejects, fallbacks, and degradation;
- `fallbackUsed=false` and `llmPlannerDegraded=false` while the planner is
  intentionally off and the deterministic controller is the primary policy;
- `cu1`, `kp2`, `pln`, `rul`, and `dgd` counts;
- harmful actions against protected partners.

Local pass:

- CU1 reaches in every eligible cell;
- zero rejected decisions, unexplained holds, or protected-partner harm;
- candidate wins at least three of four mirrored pair comparisons on the
  preregistered primary ordering: placement, then survival, then final tiles;
- aggregate final tiles exceed CU0 without a catastrophic loss in any weak-seat
  mirror;
- all planner counts remain zero for both arms.

Any reach failure or direct-reach matched loss rejects CU1 without threshold
tuning.

## Promotion path

Only after the local gate passes:

1. Build exact `linux/amd64` CU1 image and bind source, tests, image ID, file
   hashes, and runtime command in one receipt.
2. Create the dedicated player and activate its isolated credential.
3. Upload `captain-underpants-max-aura:v1` as diagnostic only.
4. Complete hosted `4/4` with zero rejects, unexplained holds, degradation, or
   protected-partner harm.
5. Complete the separate `20/20` map-and-seat regression.
6. Submit and create league membership only after all gates pass.
7. Verify player ID, policy-version ID, image architecture, submission,
   membership, and first completed league round separately.

No external promotion step inherits evidence from Mickey's player or policy.

## Immediate execution order

1. Rename the MR2 runtime seam and marker from Mickey/MR2 to entrant-neutral
   `CU1`, without changing the mechanism.
2. Add a fail-closed planner-off mode and test that both CU0 and CU1 pass
   `plan = null`.
3. Run the red-first focused tests and full suite.
4. Package an exact parent/candidate local request set.
5. Bind an isolated CLI credential to the dedicated Captain player without
   replacing Odin's or Mickey's local credential.

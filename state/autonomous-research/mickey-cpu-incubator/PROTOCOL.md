# Mickey CPU incubator protocol

This task is the durable control plane for Mickey's local-first policy
population. CPU runs may eliminate weak ideas and nominate a challenger. This
state layer records evidence and gates; it does not itself launch Docker,
pods, Coworld, uploads, submissions, membership changes, champion changes,
schedulers, or a Mac process switch.

## Population loop

1. Register the exact current Mac incumbent before any promotion. Preserve its
   source commit, image tag, image digest, activation receipt, and launch
   configuration as the rollback target.
2. Open one generation from an immutable parent. Keep one fair control with the
   experimental intent disabled and add at most one interpretable mechanism
   delta per maverick. Do not tune several thresholds under one arm name.
3. Preregister matched map, seed, seat, roster, runtime, decision horizon, and
   randomized execution order. Conversion arms require a mixed roster with a
   visible outsider; an all-K1Z roster cannot test conversion.
4. Screen against the same control. A screen passes only after direct marker
   reach, accepted decisions, zero K1Z harm, zero rejects, zero unexplained
   holds, and matched outcome improvement. Placement and wins lead; final tiles
   and opening telemetry break ties.
5. Confirm the survivor on fresh map/seed/seat cells that do not overlap the
   screen. A promising one-cell result stays `screen_passed`, never
   `confirmed`.
6. Reimplement a confirmed mechanism in the production runtime. The exact
   production artifact must neither invoke nor contain a baked static arm at
   runtime. Run the full source suite, an independent verifier, exact-image
   inspection, and a bounded Mac canary.
7. Promote locally only when the production candidate is clean, the current
   local incumbent is registered, and rollback evidence is complete. No
   Softmax player or league identity is needed for this Mac-only transition. A
   later health regression marks `rollback_required` and blocks new promotion
   until the previous exact local incumbent is restored and verified.
8. Start the next generation from the newly verified incumbent. Retain useful
   failed arms as evidence, but never silently fold several of them into the
   parent.

The initial screen uses four matched pairs. Confirmation uses at least twelve
fresh matched pairs across two maps and two seats. A structural change may
revise those counts, but the decision and rationale must be logged before the
new generation opens.

Generation `g000` is bound to source
`26c36eca6f30272c921f6c7049187192fc100e21` and the immutable source-reach
receipt at commit `068afee40b55ee80e00b55966905c0e3f3c3df10`, SHA-256
`127d60ee51f4e4b2d50c7b6908d1e571ce8f9e40f1939f61c25e3cdb4abaa129`.
Its only schedulable population is `m0`, `grow-opening`, `grow-low-share`,
`convert-weakest`, and `convert-largest`. `grow-calm` and
`grow-conjunction` were pruned after source fixtures showed behaviorally
duplicate traces; do not spend CPU cells on them under another label. The
manifest binds the exact linux/amd64 image tag and ID for all five arms plus
the production-source image. A rebuilt or retagged image opens a new binding;
it never silently replaces one of these IDs.

## Static evaluation boundary

`static-eval-v1` is a deterministic, credential-free CPU surrogate. Every arm
using it has `upload_eligible=false` and `production_eligible=false`. A static
winner may supply only a mechanism hypothesis for a separate production
reimplementation. Static evidence cannot satisfy a production, hosted,
submission, membership, champion, or official-round gate.

Local Mac promotion is distinct from live Softmax promotion. Any future live
operation still requires the identity, hosted `4/4`, regression `20/20`, and
RCI gates in `AUTONOMOUS_PROMOTION.md`; this incubator manifest deliberately
keeps all external-operation flags closed.

## Two incumbent layers

- `local_incumbent` is the production-clean source commit plus exact local
  image tag/digest currently selected on this Mac. It can become active after
  confirmation, production reimplementation, independent verification, a Mac
  canary, and rollback registration. It contains no Softmax player,
  policy-version, membership, or champion claim.
- `league_incumbent` is a separate live-state record. It stays `blocked` until
  a dedicated Mickey player is verified, Hrafn's Studio migration receipt is
  terminal, hosted `4/4`, regression `20/20`, and final RCI all pass. A local
  incumbent may therefore be active while the league incumbent remains
  blocked.

The manifest never turns either record into mutation authority. It records
what an independently authorized operator proved and performed.

## Stall and pivot discipline

- `stale_count` 0-1: continue the bounded generation.
- `stale_count` 2-3: stop parameter tuning and preregister a structural pivot
  in the hypothesis, roster/data cell, objective, verifier, decomposition, or
  search space.
- `stale_count` 4 or greater: stop autonomous generation and request human
  direction. No queued candidate is promoted merely because the loop stopped.

The manifest's `loop_control.stale_count` must equal
`state/progress.json.stale_count`. Run the validator after every manifest or
progress update:

```bash
python3 scripts/validate_mickey_incubator_state.py \
  state/autonomous-research/mickey-cpu-incubator
```

Use `research_state.py` for heartbeat, direction, finding, progress, and
assessment updates. The verifier reports into `logs/verifier.jsonl`; it does
not rewrite worker findings.

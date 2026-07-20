# ProxyWar autonomous promotion protocol

## Standing authority

On 2026-07-19 the user granted standing authority for automatic promotion
after every gate below passes. No additional user `GO` is required. Codex Odin
owns the full writable `qd1n` lane. Hrafn was later reactivated only as a
separate runner operator for user-authorized `hrafn-fylking` experiments.

This authority applies only to the sanctioned Coworld/Softmax ProxyWar league:

- Codex Odin may mutate `qd1n` submissions, memberships, and champion state.
  Only one Qd1n experiment owns the runner at a time.
- Hrafn may edit and run its own `hrafn-fylking` branch under a separate
  current authorization and its own foreground runner lease. Hrafn cannot
  mutate `qd1n` and has no upload, submission, membership, or champion
  authority. Odin does not edit or run Hrafn's branch.
- Kimi K3 Max is advisory and performs no league mutations.

## Required states

Record every state separately. Never use an upload, accepted submission, or
healthy process as proof of a later state.

1. `SOURCE_READY`
   - one bounded replay-backed hypothesis;
   - authoritative action path identified;
   - red test fails on the exact parent and passes with the candidate;
   - full suite passes;
   - source commit and parent commit are immutable and pushed.
2. `LOCAL_MECHANISM_VERIFIED`
   - exact linux/amd64 image matches committed source byte-for-byte;
   - qualifier boots and produces accepted decisions;
   - a hash-bound local trace contains the configured coalition partner;
   - marker reaches with zero illegal actions, fallback, degradation,
     unexplained holds, rejects, unresolved harmful targets, or K1Z harm;
   - the differential fixture proves a real candidate-parent action change;
   - local competitive lift is recorded when the exact parent can run under the
     same runtime, but it is supplementary. Never substitute a degraded parent
     or proxy opponent to manufacture an outcome comparison.
3. `DIAGNOSTIC_UPLOADED`
   - the lane owner verifies the active Softmax player identity;
   - the candidate is uploaded for hosted diagnosis;
   - policy-version ID, image digest, source commit, and upload label are
     recorded;
   - upload is not described as a league submission or live membership.
4. `HOSTED_PASSED`
   - current-roster hosted diagnostic finishes `4/4`;
   - reach, accepted decisions, holds, rejects, K1Z harm, placements, and replay
     hashes are recorded.
5. `REGRESSION_PASSED`
   - separate map-and-seat regression finishes `20/20`;
   - no unresolved regression or identity discrepancy remains.
6. `RCI_AUDIT_PASSED`
   - the committed source and complete evidence packet pass the official
     fail-closed auditor with zero unresolved violations;
   - Codex Odin independently re-verifies source, image, roster, runtime,
     marker, safety, and outcome identities from the immutable packet;
   - Kimi advice is incorporated when available but is not a blocking gate.
7. `SUBMITTED`
   - the lane owner submits its own candidate to the league with automatic
     champion selection;
   - submission ID and initial status are recorded.
8. `PLACED`
   - qualification passes and the submission reports `placed`;
   - submission acceptance is not yet champion proof.
9. `CHAMPION_VERIFIED`
   - membership is `competing active`;
   - the exact candidate policy-version ID is the sole champion for that
     player;
   - prior versions are benched or otherwise non-champion.
10. `ROUND_CONFIRMED`
    - the candidate appears in a completed official round;
    - result and streak are recorded without extrapolation.

## Automatic action sequence

The lane owner proceeds automatically from one verified state to the next.
Diagnostic upload is allowed after `LOCAL_MECHANISM_VERIFIED` and a pre-upload RCI
audit. League submission and champion promotion are allowed only after
`HOSTED_PASSED`, `REGRESSION_PASSED`, and final `RCI_AUDIT_PASSED`.

Before any upload or submission:

- pull the lane branch and mailbox with fast-forward only;
- verify the active player identity and league ID;
- rebuild or inspect the exact immutable image;
- verify source hashes, architecture, policy name, and parent identity;
- confirm through `scripts/proxywar-runner-lease.sh status --json` that no other
  operator owns the runner or the lane mutation lock. Run local Coworld work
  only through the tokenized foreground `run` wrapper; never release, stop, or
  reap another live supervisor. A new run requires `status --json` state
  `free`; initializing, reaping, corrupt, or same-lane stale/legacy states stay
  closed until exact recovery succeeds.

After submission, poll until terminal placement state and then independently
query memberships. Post a plain-English receipt to the mailbox and update the
lane ledger.

## Failure and rollback

- Any failed evidence gate closes the candidate as `NO SUBMIT`.
- An upload or hosted failure stops before league submission.
- A qualification or placement failure stops further mutations; verify that the
  prior champion remains active and record the failure.
- A champion identity or membership mismatch stops all further league actions.
  Preserve evidence and restore the last verified champion only through a
  supported Coworld/Softmax operation after independently confirming the target
  policy-version ID.
- Never retry a failed submission blindly or promote a nearby version number.
- Official losses do not rewrite prior gate evidence. Select a new bounded arm
  or execute an evidence-backed rollback through the same audit protocol.

# ProxyWar autonomous promotion protocol

## Standing authority

On 2026-07-19 the user granted Codex Odin and Hrafn standing authority to
promote their own ProxyWar policies automatically after every gate below
passes. No additional user `GO` is required.

This authority applies only to the sanctioned Coworld/Softmax ProxyWar league:

- Codex Odin may mutate only `qd1n` submissions, memberships, and champion
  state.
- Hrafn may mutate only `hrafn-fylking` submissions, memberships, and champion
  state.
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
2. `LOCAL_QUALIFIED`
   - exact linux/amd64 image matches committed source byte-for-byte;
   - qualifier boots and produces accepted decisions;
   - marker reaches in replay;
   - zero unexplained holds, zero rejects, and zero K1Z harm;
   - mirrored candidate-versus-parent comparison shows the declared advantage.
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
6. `AUDIT_APPROVED`
   - the other lane reviews the committed source and complete evidence packet;
   - the mailbox verdict is `APPROVE`;
   - `REVISE`, `REJECT`, `INSUFFICIENT`, or no verdict blocks promotion.
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
Diagnostic upload is allowed after `LOCAL_QUALIFIED` and a pre-upload
cross-audit. League submission and champion promotion are allowed only after
`HOSTED_PASSED`, `REGRESSION_PASSED`, and final `AUDIT_APPROVED`.

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

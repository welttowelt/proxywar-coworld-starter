# ProxyWar autonomous promotion protocol

## Standing authority

On 2026-07-19 the user granted Codex Odin and Hrafn standing authority to
promote their own ProxyWar policies automatically after every gate below
passes. No additional user `GO` is required.

- Codex Odin may mutate only `qd1n` league state.
- Hrafn may mutate only `hrafn-fylking` league state.
- Kimi K3 Max is advisory and performs no league mutations.

## Required states

Record every state separately:

1. `SOURCE_READY`: bounded replay-backed hypothesis, exact parent, red-first
   proof, full suite, immutable pushed commits.
2. `LOCAL_QUALIFIED`: exact linux/amd64 image identity, accepted qualifier,
   replay marker reach, zero unexplained holds, zero rejects, zero K1Z harm,
   and mirrored candidate advantage.
3. `DIAGNOSTIC_UPLOADED`: live player identity verified; policy-version ID,
   image digest, source commit, and label recorded. This is not a submission.
4. `HOSTED_PASSED`: current-roster hosted diagnostic finishes `4/4`, with
   decisions, holds, rejects, harm, placements, and replay hashes recorded.
5. `REGRESSION_PASSED`: separate map-and-seat regression finishes `20/20`.
6. `AUDIT_APPROVED`: the other lane returns `APPROVE` on the complete packet.
7. `SUBMITTED`: the lane owner submits its own candidate with auto-champion and
   records the submission ID.
8. `PLACED`: qualification passes and the submission reports `placed`.
9. `CHAMPION_VERIFIED`: the exact candidate is `competing active` and sole
   champion for that player.
10. `ROUND_CONFIRMED`: the candidate appears in a completed official round.

## Automation and failure handling

The lane owner moves automatically between verified states. Diagnostic upload
is authorized after `LOCAL_QUALIFIED` and pre-upload cross-audit. League
submission is authorized only after hosted `4/4`, regression `20/20`, final
cross-audit approval, live identity verification, and immutable image
verification.

Any failed evidence gate closes the candidate as `NO SUBMIT`. Qualification,
placement, identity, or membership inconsistency stops further mutations.
Verify that the prior champion remains active. Restore the last verified
champion only through a supported Coworld/Softmax operation after independently
confirming its exact policy-version ID. Never retry a failed submission blindly.

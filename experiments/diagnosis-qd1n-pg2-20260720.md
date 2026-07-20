# PG2 productive-grind matrix — terminal safety verdict

Date: 2026-07-20

## Verdict

**REJECTED.** PG2 does not proceed to hosted 4/4, regression 20/20, upload,
submission, or champion change. `qd1n:v89` remains the live policy.

## Triggering evidence

The fail-closed pair auditor stopped on the completed Asia matrix cell:

- pair: `asia-20260728` (Asia, seed `20260728`, lane `d`, wave 4);
- game: `CWBSITMU`;
- candidate source commit: `42e9a18193d2fb381f1f0fa6de0e64cb58e3a2f9`;
- candidate image: `sha256:3f01ffafd10079a3f0a9ead1704481df623bceedad0ad0f7f47fea77344e6b5d`;
- candidate replay: `45458b41123099cadcd74d4ceb8753f2e12298c747a4cc08808e57ba3c4628cf`;
- candidate receipt: `b6e9a0915fb23f3ae73485676ac4b1dcfc71f7506fb8cd8a921cb4fafd5e8892`.

At turn 4,900 Odin selected `dgd:err:h0d` while legal tactical actions
included neutral land attacks at 10%, 25%, and 40%, plus a Defense Post build.
The auditor therefore reported `Odin had an unexplained hold`. There were no
rejected decisions, K1Z-harmful actions, or marker-scope violations.

The exact parent in the same seeded cell also held (`dgd:err:h0d`, turn 4,800),
but this was not an approved parent-control baseline and does not excuse the
candidate. The protocol hard-rejects any candidate unexplained hold.

## Positive evidence retained without changing the verdict

Asia completed all eight candidate/parent pairs. PG2 reached in every Asia
candidate run and exceeded the parent final score in all eight. This establishes
that the intervention executes and can improve early expansion; it does not
override the safety gate.

## Cleanup

The remaining PG2 Pangaea queue was stopped by exact run-root process identity
only. The runner lease was then stale-reaped through
`proxywar-runner-lease.sh`; its status is `free`. No unrelated process or
container was removed.

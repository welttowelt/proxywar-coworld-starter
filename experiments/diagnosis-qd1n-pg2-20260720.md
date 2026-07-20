# PG2 productive-grind matrix — safety-classifier correction

Date: 2026-07-20

## Corrected verdict

**MATRIX RESUMES FROM THE MISSING CELLS.** PG2 still has no permission to
proceed to hosted 4/4, regression 20/20, upload, submission, or champion
change. `qd1n:v89` remains the live policy.

## Triggering evidence

The first fail-closed pair audit stopped on the completed Asia matrix cell:

- pair: `asia-20260728` (Asia, seed `20260728`, lane `d`, wave 4);
- game: `CWBSITMU`;
- candidate source commit: `42e9a18193d2fb381f1f0fa6de0e64cb58e3a2f9`;
- candidate image: `sha256:3f01ffafd10079a3f0a9ead1704481df623bceedad0ad0f7f47fea77344e6b5d`;
- candidate replay: `45458b41123099cadcd74d4ceb8753f2e12298c747a4cc08808e57ba3c4628cf`;
- candidate receipt: `b6e9a0915fb23f3ae73485676ac4b1dcfc71f7506fb8cd8a921cb4fafd5e8892`.

At turn 4,900 Odin selected `dgd:err:h0d`. The raw legal-action list contained
attacks at 10%, 25%, and 40%, plus a Defense Post build. Replay inspection
showed all three attacks targeted **K1Z Hrafn**, and `chooseBuild` deliberately
excludes Defense Posts. The listed donations were coalition support, not a
required tactical escape. There were no rejected decisions, K1Z-harmful
actions, or marker-scope violations.

The exact parent in the same seeded cell also held (`dgd:err:h0d`, turn 4,800).
The shared pattern exposed a bug in the audit classifier: it counted protected
attacks and excluded Defense Posts as tactical alternatives. The classifier now
mirrors those selector exclusions. A red-first regression proves that the
protected-only cell is clean while a legal non-K1Z attack still makes a hold
unexplained.

## Positive evidence retained without changing the verdict

Asia completed all eight candidate/parent pairs. PG2 reached in every Asia
candidate run and exceeded the parent final score in all eight. This establishes
that the intervention executes and can improve early expansion; it does not
yet open a hosted gate.

## Cleanup

The premature Pangaea queue was stopped by exact run-root process identity only
and the runner lease was stale-reaped to `free`. The missing Pangaea cells must
be re-run under a fresh foreground lease after the corrected auditor is
propagated. No unrelated process or container was removed.

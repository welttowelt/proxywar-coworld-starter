# PG2 productive-grind matrix — safety-classifier correction

Date: 2026-07-20

## Corrected verdict

**LOCAL MATRIX PASSED.** PG2 now proceeds only to diagnostic upload and the
predeclared hosted 4/4. It still has no permission for a league submission or
champion change. `qd1n:v89` remains the live policy.

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

## Asia evidence

Asia completed all eight candidate/parent pairs. PG2 reached in every Asia
candidate run and exceeded the parent final score in all eight. Together with
the complete matrix below, this establishes local qualification and opens only
the diagnostic hosted gate.

## Cleanup

The premature Pangaea queue was stopped by exact run-root process identity only
and the runner lease was stale-reaped to `free`. The three missing cells were
re-run under a fresh foreground lease after the corrected auditor propagated.
No unrelated process or container was removed.

## Completed local matrix

The complete 24-pair matrix now passes its declared gate with no safety
violations: marker reach is `8/8` on World, Asia, and Pangaea; positive final
score pairs are `20/24`; and candidate/parent declared wins are tied `0/0`.
The paired median final-score deltas are World `0.0000883564`, Asia
`0.0699160657`, and Pangaea `0.0220604483`. The all-pair receipt report is at
`/private/tmp/pg2-final-matrix-audit-20260720T0138Z/report.json`.

## Diagnostic upload

The exact reviewed image was uploaded as diagnostic-only `qd1n:v92`
(`32ce69ba-9959-4172-bb45-e2a84c55bced`) with tags `codename=pg2` and
`source=42e9a181`. It is neither submitted to the league nor a membership.
`qd1n:v89` remains Odin's sole competing champion.

The hosted Coworld currently has a twelve-seat cap while the live competition
has thirteen active champions. The hosted specification therefore uses the
live top twelve by the official leaderboard and omits only rank-13 docxology;
it does not silently omit a stronger rival. The next gate is a diagnostic-only
hosted `4/4` against that declared current top-twelve roster in the explicit
12P Pangaea variant. A league-targeted request was cancelled before dispatch
when the API resolved it to the two-seat qualifier; it produced zero episodes
and is not gate evidence.

# Winner decision-logic comparison, 2026-07-17

Source: the 16 hosted `tournament-8p-asia` episodes from the v77 baseline
(`xreq_8cced59b-77f1-4887-86da-f5e0b27fb8c6`) and the mx3/pd1/ef1/sp1
diagnostics. 14 of 16 were won by Richard Higgins (6), Auri (5), katanasan
(2), daveey (1); qd1n won 2. Every figure below is counted directly from the
hosted replay decision streams.

## The three winners and qd1n, by the numbers

| Profile (16 episodes) | odin free (qd1n) | Richard Higgins | Auri | katanasan |
| --- | --- | --- | --- | --- |
| Wins | 2 | 6 | 5 | 2 |
| Opening neutral commitment | mixed 10/20/35, cadence resets | 35% always (398) | 35% always (348) | 35% mostly (250+61) |
| Opening rival probes (≤3000) | 112 total | 0 | 24 total | 47 total |
| Opening boats | 36 | 0 | 6 | 0 |
| Tiles at turn 3000 (median) | 85,533 | 207,944 | 198,856 | 255,868 |
| Rival attack 10% | 136 | 102 | 54 | 0 |
| Rival attack 25% | 118 | 432 | 116 | 181 |
| Rival attack 40% | 99 | 63 | 291 | 273 |
| Attacks below 1.0 ratio | 6 | 295 | 81 | 0 |
| Mid-game boats | 346 | 3 | 46 | 55 |
| Late boats | 203 | 8 | 15 | 171 |
| Alliance requests | 7 | 42 | 30 | 16 |
| Defense Posts built | 3 | 4 | 136 | 25 |
| Peak tiles (median) | 99,069 | 522,595 | 446,444 | 381,061 |

## What each winner actually does

**Richard Higgins (6 wins).** The simplest chassis in the field: a pure 35%
neutral grind with zero opening rival attacks and zero opening boats, then
constant 25% attacks at *any* ratio — 432 of them, 295 below 1.0x. Attrition
warfare funded by the grind's troop surplus, plus the heaviest alliance play
in the sample (42 requests). Sequence is the whole trick: grind first, spam
from surplus later.

**Auri / proxywar-keystone (5 wins).** Same 35% opening, then selective
heavy commitments (40% ×291 versus 10% ×54), 136 Defense Posts fortifying
the core, and 30 alliance requests. The defensive shell is distinctive —
qd1n's own doctrine bans Defense Post outright.

**katanasan (2 wins).** 35%-heavy opening, no 10% attacks at all, 40/25
commitments only, ports and factories for economy, boats saved for the late
game.

**Shared chassis:** grind neutral land at 35% through the opening; after the
opening, attack only at 25-40% commitment; use alliances actively; almost
never spend mid-game decisions on boats.

## Where qd1n's doctrine inverts the field

1. **The 10% probe ladder.** v77 opens rival contact at 10% and escalates;
   the field simply never does. 136 of qd1n's 353 rival attacks were 10%
   pokes that produced no kills in any episode.
2. **Cadence resets.** The 10/10/20/35 neutral ladder restarts after every
   build, boat, or rival probe; the winners' flat 35% never pauses.
3. **Mid-game boat flooding.** 346 mid-game boats is the stalled-expansion
   pattern; winners spend those decisions on land conversion.
4. **Near-zero diplomacy.** 7 alliance requests against 16-46 for the
   winners; qd1n plays alone against coordinated fields.
5. **Defense Post ban.** Auri's 136-post core contradicts the blanket
   "never select Defense Post" doctrine (the ban predates the current
   protocol and was never re-measured).

## Why the bounded arms kept failing

Each rejected arm changed one rule in isolation while the winners' edge is
the *chassis* — the sequence of grind, then high-commitment pressure, then
active diplomacy, with no boat leak. Suppressing probes (ef1) removed the
profitable ones along with the leaks. Forcing the grind (ef2) starved the
seats that lacked a clean frontier. Discipline guards (pd1) fired correctly
and the outcomes did not move, because none of these arms touched the
chassis. The planner doctrine (sp1) never reached the field: Bedrock was
throttled in 57% of decisions, so any planner-dependent mechanism is
structurally unreliable anyway.

## Recommendation

Build **qd2n** as a fresh, minimal, fully deterministic policy that
implements the shared winner chassis directly, instead of patching v77:

1. Opening: flat 35% neutral commitment while a troop floor holds (the ef2
   starvation case teaches that the grind needs a reserve guard, not a blind
   copy), with no cadence warm-up and no avoid-set resets.
2. Contact: no 10% probes, ever. Rival attacks only at 25%+ commitment,
   retaliation-first, attrition allowed from surplus (the Richard pattern).
3. Boats: hard cap on mid-game expansion boats; boats only when land
   conversion is impossible or clearly favorable.
4. Diplomacy: active alliance requests when bordered by stronger rivals,
   honored while they protect conversion.
5. Re-measure Defense Post under the current protocol instead of banning it
   by doctrine.

Gate it through the same pipeline: unit tests, `34/34` qualifier, mirrored
matched gates against exact v77, hosted `4/4` diagnostic, independent
`20/20` regression — submit only if every gate passes. Estimated scope: a
new `llm-player` variant of ~the size of `strategy-engine.mjs`, two to four
local gate iterations, then hosted evaluation.

Honest caveats: the grind is position-dependent (ef2 starved one mirror);
Bedrock throttling makes planner-dependent logic unreliable (sp1 measured
57% degradation); and a chassis rewrite can still lose to these three
policies — the gates remain the only trusted judge.

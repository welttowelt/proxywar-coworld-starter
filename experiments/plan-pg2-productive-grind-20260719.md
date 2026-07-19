# PG2 preregistration: productive-grind percentage

Status: source-and-test arm only. No episode, upload, submission, membership, or
champion change is authorized by this file.

## Parent and hypothesis

- Exact parent commit: `f1347251` (`qd1n:v89` source).
- Parent image: `sha256:ebd9eed3f8a936cc2d0813f54944a0e3e826a0141932356041d71f0c3638a478`.
- One hypothesis: while a neutral land frontier is still producing territory,
  a parent-selected 10% or 20% neutral-land attack should use the largest legal
  commitment up to 35%. Neutral conquest has a flat per-tile troop cost and
  reaches its speed floor far below these commitments, so the larger action
  buys more productive frontier before it closes.

## Exact scope

PG2 may change only the percentage of a neutral-land attack that exact v89
already selected. It never changes the selected action class.

The guard requires:

- fewer than 20 non-spawn decisions;
- present, nonblank, finite, nonnegative `tilesOwned` and `tileShare` on the
  current wire observation;
- exact current tile share below `0.12`;
- no current incoming attack from either parent or protocol attribution;
- no sustained territory collapse;
- a legal, non-high-risk neutral-land action at 35% or the largest legal
  percentage below 35%; and
- no two-attack flat-frontier observation window.

The flat-frontier window examines the two most recent neutral-land attack
records. PG2 disengages when exact current `tilesOwned` has not exceeded the
older attack's exact pre-action `tilesOwned`. This is an observation-window
proxy, not a claim that the engine exposes attack-completion receipts. Once two
such records exist, both must contain present, nonblank, finite, nonnegative
`tilesOwned`; before then, PG2 remains in its bootstrap window. Private tile
validity provenance captured with each decision prevents `null`, blank,
missing, malformed, negative, or nonfinite wire values from being normalized
into a usable zero.

Every eligible neutral-land action, including the exact-v89 parent and every
possible replacement, must carry a present, nonblank, finite, positive decimal
`metadata.troopPercent` no greater than 100. Decimal numeric strings remain
valid, but hex strings, booleans, arrays, and objects do not. PG2 does not fall
back to an action-ID suffix after invalid metadata. The selected action receives
`policyMarker: "pg2"` only when its exact percentage strictly exceeds the
parent's exact percentage. Any invalid current value, relevant history value,
parent percentage, or replacement percentage returns the exact parent action
unmarked.

The rule is map-general because the conquest-cost and speed-floor mechanics are
map-general, while `tileShare` is rounded to 1% and the current spawn-tile map
fingerprint is incomplete and collision-prone. Map scope is therefore measured
as an outcome dimension rather than inferred from an unreliable wire field.

Coalition requests keep their existing earlier priority, including all three
initial contacts and every reverse-handshake opportunity. Builds, boats,
hostile attacks, defense, and finishes stay on exact-v89 selection order.
Decision 20 onward returns to the exact parent percentage cadence.

## Red-first tests

1. Every legal coalition request remains `kp2`, including all three sequential
   initial contacts.
2. A calm neutral frontier reroutes parent 10% neutral land to 35% with `pg2`.
3. Quantized share `0.11` reaches; share `0.12` does not.
4. Two flat exact-tile records disengage; any exact tile gain keeps PG2.
5. Parent and protocol-only incoming pressure both bypass PG2.
6. World, Asia, Pangaea, and an unknown Compact spawn all use the same grind
   rule; decision 20 onward retains the exact parent action.
7. When exact v89 already selects 35%, PG2 does not add a marker.
8. Equal, smaller, missing, or unparseable replacement percentages return the
   exact parent action unmarked.
9. Missing, undefined, `null`, empty, whitespace, nonnumeric, hex, boolean,
   array, object, negative, `NaN`, and infinite current `tilesOwned` or
   `tileShare` values return the exact parent action unmarked.
10. The same invalid forms in either relevant historical `tilesOwned`, on the
    parent `metadata.troopPercent`, or on any possible replacement percentage
    return the exact parent action unmarked.
11. One prior neutral-land attack remains bootstrap; decimal numeric strings
    remain valid without widening the exact-v89 legacy parser.

## Evaluation gates

RunPod work is closed until source, tests, image, fixture, request specs, and
hashes receive independent review.

First gate:

- one same-host candidate/parent reach fixture on `storm-lazy-a`;
- exact live coalition roster;
- one preregistered map/seed/seat cell;
- candidate must emit accepted `pg2` actions, with zero holds, zero rejects,
  zero K1Z harm, and no non-neutral action divergence.

If that passes, run 24 same-seat matched pairs across World, Asia, and Pangaea,
split evenly across `storm-lazy-a` through `storm-lazy-d`. Every worker runs
both candidate and parent for its assigned seeds so CPU-model differences
cannot become the policy delta.

Hard reject on any hash/roster drift, K1Z harm, rejection, unexplained hold,
marker outside the guard, or non-neutral action-class divergence.

Outcome pass requires:

- marker reach in at least 6 of 8 pairs on each map;
- positive per-map median paired tile delta at decisions 20 and 50;
- positive per-map median paired final-score delta;
- positive overall final-score delta in at least 15 of 24 pairs; and
- candidate declared-win count not lower than parent overall or on any map.

No threshold tuning follows the result. Only a local pass opens hosted 4/4 and
paired 20/20 regression. Automatic league promotion remains closed until every
objective gate passes and upload, submission, placement, membership, and sole
champion state are verified.

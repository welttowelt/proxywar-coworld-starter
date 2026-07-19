# KF1: designated K1Z finish

## Directive

When Odin can prove that every surviving opponent belongs to the configured
K1Z coalition, Odin becomes the designated finisher. Odin must stop renewing
coalition alliances, sever one if necessary, and use the largest legal land or
naval commitment against the easiest remaining K1Z target. An Odin win is a K1Z
win.

This is a separate arm from PG2. No KF1 code or evidence is allowed in the PG2
candidate or its matched evaluation.

## Fail-closed trigger

KF1 may activate only when all of the following are true:

1. `gameMode` is exactly `FFA`.
2. The phase is exactly `active`.
3. `alivePlayerCount` is a valid integer of at least two.
4. The alive rival list is non-empty.
5. `alivePlayerCount === aliveRivals.length + 1`, proving that the observation
   accounts for Odin plus every other survivor.
6. Every alive rival has a raw leading `K1Z` tag and matches the closed
   canonical-name allowlist for the configured K1Z roster.
7. Canonical survivor names are unique.

Missing counts, count/list disagreement, an unregistered `K1Z` label, or any
outsider keeps KF1 dormant.

The game exposes ephemeral per-match player IDs in `visiblePlayers` and legal
action metadata. League `ply_*` IDs therefore cannot authenticate a survivor
inside the match and are deliberately not accepted by the KF1 trigger.

## Action order

1. Rank non-allied K1Z targets by lowest tile share, then strongest Odin troop
   advantage.
2. Take the highest-percentage legal land attack against the best target.
3. If no land attack exists, take the highest-percentage legal naval invasion.
4. If no strike exists, break the alliance with the easiest allied K1Z target.
5. Once a KF1 target is selected, keep that target locked until it dies. Do not
   open a second front when a different route appears.
6. If no target action is currently legal, take the largest neutral land or
   naval action, build a Port only when it is the sole reach-enabling action,
   otherwise hold.
7. While the trigger remains true, suppress coalition re-alliance, donations,
   ordinary economy, defense, and retreat.

Every KF1-selected action, including intentional fallback holds, carries marker
`kf1`.
The override is allowed under K1Z incoming pressure because reciprocal
stand-down is a coalition rollout requirement, not an Odin trigger condition.

If Odin becomes the sole survivor, the engine does not award the win
immediately. KF1 continues the largest legal neutral land or naval commitment
through `0.80` tile share, then holds for the FFA win check.

## Required reciprocal rollout

Hrafn, katanasan, and juryoku must independently ship the paired stand-down
contract before Odin's KF1 can be promoted:

- recognize the same fail-closed survivor proof;
- never attack, nuke, embargo, target, or retaliate against Odin in that state;
- do not renew an alliance that Odin has severed;
- donate only to Odin when a legal donation is available, otherwise hold;
- never donate to another K1Z survivor, upgrade, build, defend, or retreat.

## Gates

1. Red-first unit proofs for trigger reach, hidden-outsider/count mismatch,
   missing telemetry, FFA-only scope, maximum commitment, alliance severing,
   naval fallback, re-alliance suppression, and parent protection outside KF1.
2. Exact-image smoke with marker reach, zero rejects, zero unexplained holds,
   and no K1Z harm before the trigger.
3. Same-host matched coalition-only episodes showing Odin wins faster or at
   least never slower than the exact parent.
4. Mixed-roster negative controls on World, Asia, and Pangaea with zero KF1
   reach and byte-identical parent decisions outside the trigger.
5. Reciprocal Hrafn, katanasan, and juryoku receipts.
6. Deploy and verify all supporter stand-down versions first.
7. Hosted 4/4 and paired 20/20 regression gates with those exact supporter
   versions.
8. Automatic upload, submission, placement verification, and sole-champion
   verification only after every gate above passes.

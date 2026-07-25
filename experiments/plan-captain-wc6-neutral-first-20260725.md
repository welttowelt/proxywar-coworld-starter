# Captain WC6 neutral-first RCI plan

Recorded: 2026-07-25

## Parent and mutation boundary

- Exact behavioral parent: uploaded inactive
  `captain-underpants-max-aura:v2`
  (`a5a12c09-f27e-4bb6-9927-c68d2c48c81f`), source commit
  `96482ba6595273e5b32be11c73a4907864f64933`.
- Live champion remains v1
  (`348b11ff-29b1-4743-b456-e735dbf1520d`).
- Candidate branch: `rci/captain-wc6-neutral-first-20260725`.
- One mechanism: keep a calm first contact on neutral growth instead of
  initiating a marginal war with a territorially larger rival when the
  observable map fingerprint is World or unavailable.

## Sealed hosted diagnosis

WC5 v2 lost all four current-field World episodes and emitted zero `wc5`
markers. Captain's fixed slot finished with 0, 0, 4,424, and 3,248 tiles. The
runtime had zero rejections, fallbacks, or degradation, but one episode also
contained two holds while tactical actions remained legal.

The first failure was operational: current 12-player World placed Captain on
final spawn tile `373314`, while the source's validated World fingerprint table
did not include that anchor. The branch therefore stayed byte-for-byte on v1.
The completed sealed replays used the same twelve current World anchors:

`373314, 500334, 628394, 629398, 659476, 673074, 877134, 997490, 1080668,
1088580, 1216626, 1333674`.

At turn 1,900 Captain initiated its first player war:

- Captain: 96,709 tiles and 1,323,751 troops after the decision.
- Target softmaxwell: 107,224 tiles.
- Offered action metadata: target share `0.14`, relative troop ratio `1.16`.
- Legal menu: three neutral-land expansions, eighteen neutral boats, and three
  economy/defense builds.
- Current or recorded incoming pressure: none.

Across the three sealed episodes, daveey made no player attack before turns
5,800, 6,300, and 7,700. Before then it repeatedly selected neutral land,
neutral boats, and economy actions. It won two episodes; Mickey won one.
Captain's early softmaxwell contact was followed by eleven softmaxwell attacks
in the fully inspected loss, plus later pressure from daveey, relh, Calc,
Auri, and Mickey.

## WC6 guard and action

Compute exact v2 first. Replace it only when every condition holds:

1. The observable map fingerprint is World or unavailable. A recognized
   non-World route is excluded.
2. Exact v2 selects a non-neutral player attack.
3. Captain has no prior recorded non-neutral attack or boat.
4. No current pressure or recent attacker is visible.
5. The target is alive, visible, unprotected, and has no recent hostility.
6. Target tile share is at least Captain's tile share.
7. Captain-to-target troop ratio is at least `1.0` and below `1.3`.
8. A non-high-risk neutral land, neutral boat, or economy build is legal.

On a recognized legacy World route inside the old twenty-decision horizon,
return the exact v2 replacement and retain marker `wc5`. Outside that exact v2
boundary, the unchanged selectors choose neutral land first, then a neutral
boat, then an economy build. Emit `wc6` only for a replacement that v2 would
not make. This includes map-unobservable current-field spawns and calm first
contacts after the old horizon.

## Explicit non-changes

- Any current or recent attack keeps exact v2 retaliation.
- A territorially smaller rival keeps exact v2 conversion.
- A ratio at or above `1.3` keeps exact v2.
- Any prior player conflict keeps exact v2.
- Recognized Pangaea and Asia routes keep their existing behavior.
- A map-unobservable state changes only inside the complete first-contact guard
  above; all other unknown-map decisions remain exact v2.
- CU1 alliance handling, protected-player rules, planner protocol, and all
  underlying selectors remain unchanged.

## Red-first and promotion gates

The diagnostic red test uses observed seed-`20260777` state: spawn `1014590`,
eight prior neutral-growth decisions, Captain share `0.03`, target share
`0.04`, troop ratio `1.29`, no pressure or prior player conflict, eighteen
neutral boats, and three builds. The map fingerprint is null. Exact v2 attacks;
WC6 must select the neutral boat with marker `wc6`. Pressure, prior conflict,
smaller-target, ratio-at-least-`1.3`, and recognized non-World fixtures remain
deeply equal to v2.

The first local qualifier implementation incorrectly renamed an in-horizon v2
`wc5` action to `wc6`. Seed `20260741`, slot 6, turn 1,800 selected the same
neutral boat in both images; the exact-v2 control proved the marker was not
causal. The candidate pair was terminated, its partial output was quarantined,
and the marker boundary above was added red-first before any outcome claim.

The corrected source then showed zero causal reach on fresh seed `20260752`
under ProxyWar 0.1.10. Seed `20260753` was stopped before artifacts when the
exact live 0.1.11 package was found locally; the lease reaper removed all
thirteen orphaned containers and quarantined the partial output. Neither
interrupted run is eligible evidence. The active qualifier restarts on fresh
seeds against exact current ProxyWar 0.1.11.

The first exact-0.1.11 seed (`20260764`) completed cleanly but exposed another
routing defect: explicit seeds produce valid World spawn tiles outside the
hand-curated anchor table, so the route still had zero causal reach. A
geometry-based patch then passed synthetic source tests but also had zero reach
on fresh exact-0.1.11 seeds `20260776` and `20260777`.

The bounded diagnostic on seed `20260777` proved why. ProxyWar selects spawn
internally through `submitAndRecordSpawn`, marks that decision
`externalActionCall: false`, and never sends spawn legal actions to the
external policy. The active `AgentObservation` exposes no map name or map
dimensions. Consequently every inspected first-contact row had
`mapFingerprint: null` and `worldRouteV2: false`; the geometry code was
unreachable in production.

The clean decisive row used spawn `1014590`. Exact v2 selected
`attack:bjqilvz1:10` at `1.29` troop ratio against a `0.04`-share target while
Captain held `0.03`; eighteen neutral boats and three builds were legal. No
attacker, prior player conflict, protection, or target hostility was present.
The diagnostic selected the attack solely because the map gate rejected null.
The run recorded 216/216 accepted decisions, zero fallback, and zero
degradation. Its request, result, and replay hashes are preserved in
`diagnosis-captain-wc6-unobservable-map-rci-20260725.json`; the temporary
logging, image, request, and 15 MB output were then deleted.

The production correction therefore uses only observable intent signals:
recognized World or unavailable map, calm first contact, territorial
non-advantage, marginal troop edge, and legal neutral growth. The unreachable
geometry implementation and synthetic geometry tests were removed. The exact
diagnostic regression passes along with legacy WC5 parity, retaliation,
prior-conflict, smaller-target, strong-conversion, and recognized non-World
preservation tests.

The focused Captain/strategy suite passes `124/124`. After adding the
fail-closed hosted auditor and its four tests, the full repository suite passes
`348/352`; the only four failures are the same pre-existing Mickey fanout
activation-path failures, outside the Captain behavioral files.

## Local causal result

Fresh outcome-blind seed `20260789` reached twice with no runtime fault. The
predeclared first marker was slot 2 at turn 800. The frozen matched requests
then differed only in slot 2's image and the descriptive phase tag.

On the identical turn-800 observation, exact v2 selected
`attack:iaio5l86:10` at `1.13` troop ratio. WC6 selected the offered neutral
boat `boat:1003477:8`; both actions were accepted. Three neutral-land actions,
eighteen neutral boats, and four builds were legal.

At turn 10,400, the exact-v2 seat was alive with 4,391 tiles and score
`0.0067490716376066694`. The WC6 seat was alive with 6,664 tiles and score
`0.010226991953763684`: `+2,273` tiles and `+51.53%` score. Both arms recorded
zero holds, rejections, fallbacks, degradation, or parse failures. Hashes,
image identity, source receipts, reach evidence, and the two pre-episode
operator failures are recorded in
`evidence-captain-wc6-observable-first-contact-20260725.json`.

The local causal gate passes and authorizes upload of only image
`sha256:2d273db10769d57076b1d72dccac06aff0eb519ffaf574a95ad97b29949dd86a`.
It does not authorize league submission.

Promotion remains fail closed:

1. Focused and full source suites.
2. Exact linux/amd64 image and file-hash receipt.
3. Fresh outcome-blind reach qualifier on exact live ProxyWar 0.1.11.
4. Matched same-seat causal improvement with zero unexplained holds,
   rejections, fallbacks, or degradation.
5. Hosted current-field 4/4 actual wins with at least one valid `wc6` marker.
6. Separate hosted 20/20 regression gate.
7. Only then submit and verify membership, champion identity, and first live
   round.

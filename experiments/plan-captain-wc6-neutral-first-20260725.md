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
- One mechanism: keep a calm World opening on neutral growth instead of
  initiating a marginal war with a territorially larger rival.

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

1. The current spawn anchor identifies a validated Normal World route.
2. Exact v2 selects a non-neutral player attack.
3. Captain has no prior recorded non-neutral attack or boat.
4. No current pressure or recent attacker is visible.
5. The target is alive, visible, unprotected, and has no recent hostility.
6. Target tile share is at least Captain's tile share.
7. Captain-to-target troop ratio is at least `1.0` and below `1.3`.
8. A non-high-risk neutral land, neutral boat, or economy build is legal.

The unchanged selectors choose neutral land first, then a neutral boat, then
an economy build. Emit `wc6` only for the executed replacement. The old
twenty-decision cutoff is removed for this first-contact guard.

## Explicit non-changes

- Any current or recent attack keeps exact v2 retaliation.
- A territorially smaller rival keeps exact v2 conversion.
- A ratio at or above `1.3` keeps exact v2.
- Any prior player conflict keeps exact v2.
- Pangaea, Asia, and unknown maps keep their existing routes.
- CU1 alliance handling, protected-player rules, planner protocol, and all
  underlying selectors remain unchanged.

## Red-first and promotion gates

The red test uses the sealed hosted spawn `373314`, a calm larger target,
neutral land, and twenty-four prior active decisions. Exact v2 attacks; WC6
must select the offered neutral land with marker `wc6`. Pressure and
smaller-target fixtures must remain deeply equal to v2.

Promotion remains fail closed:

1. Focused and full source suites.
2. Exact linux/amd64 image and file-hash receipt.
3. Fresh outcome-blind reach qualifier.
4. Matched same-seat causal improvement with zero unexplained holds,
   rejections, fallbacks, or degradation.
5. Hosted current-field 4/4 actual wins with at least one valid `wc6` marker.
6. Separate hosted 20/20 regression gate.
7. Only then submit and verify membership, champion identity, and first live
   round.

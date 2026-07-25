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

On a legacy World route inside the old twenty-decision horizon, return the
exact v2 replacement and retain marker `wc5`. Outside that exact v2 boundary,
the unchanged selectors choose neutral land first, then a neutral boat, then an
economy build. Emit `wc6` only for a replacement that v2 would not make. This
includes current 12-player World anchors absent from v2 and calm first contacts
after the old horizon.

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

The first exact-0.1.11 seed (`20260764`) completed cleanly but exposed the
remaining routing defect: explicit seeds produce valid World spawn tiles
outside the hand-curated anchor table, so the route still had zero causal
reach. Inspection of the exact 0.1.11 wire contract showed no direct map name,
but every spawn action carries public `tile`, `x`, `y`, and
`diplomacyScore` metadata. Those values deterministically recover map geometry:
World is 2:1, Asia is 5:3, and Pangaea is 1:1 at every supported size. WC6 now
requires a unique 60%-quorum geometry across at least three spawn actions,
caches the result in decision history, and otherwise fails closed to the old
anchor/history route. Red-first tests cover all three map families, an unlisted
current World spawn, incomplete evidence, contradictory evidence, legacy WC5
parity, retaliation, and non-World preservation. Focused tests pass 128/128;
the full suite passes 345/349 with the same four unrelated pre-existing Mickey
fanout activation failures.

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

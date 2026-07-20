# Hrafn DV2 hosted verdict and DV3 RCI

Date: 2026-07-20

## DV2 hosted verdict: reject

Experience request:
`xreq_a75c39e0-0ecf-4a88-8f2a-bc9302770cbb`

The current top-12 Pangaea diagnostic used real `daveey-proxywar:v24`,
`qd1n:v89`, and diagnostic `hrafn-fylking:v6`. It completed four episodes
without infrastructure failure.

- Hrafn wins: `0/4`
- Odin wins: `0/4`
- daveey wins: `0/4`
- winners: Juryoku twice, Auri twice
- Hrafn rejects: `0`
- harmful Hrafn actions against K1Z: `0`
- direct Hrafn attacks on daveey: five across the four replays
- every direct daveey attack used the weakest offered `10%` action

DV2 suppressed daveey but did not convert that suppression into Hrafn or Odin
wins. It fails the hosted `4/4` gate and must not be submitted or championed.
The live Hrafn champion remains v5.

Replay SHA-256:

- `c48f1557d43bcff6072db8e178658187c267445707d058ee0dec7a43b14a5a6f`
- `c1c2761e567aafa559fe046ee6143fbcffd823a423bba72da5224be88365aa98`
- `295d0a5040e146164be457969468be2328dc4263781b7ae56a5acc02159d3504`
- `94cf3b4ab84c2f717a131fc2866fb4c78f95719064f2be9ab8c319dc9f70b42f`

## RCI diagnosis

The failure was not missing target recognition or coalition safety. In live
states that bypassed the dedicated campaign selector, `fallbackRivalAttack`
selected the first legal attack. The legal set offered `10%`, `25%`, and `40%`,
so the fallback always leaked `10%` commitments despite the existing
`priorityPressurePercent=25` policy.

## DV3: smallest correction

DV3 changes that one existing selector:

- priority target: choose the configured `25%` commitment and attach `dv1`
- every non-priority fallback target: preserve the previous `10%` behavior
- no new state, counter, cadence, map rule, or threshold

Source commit: `42dcadcb`

Tests: `151/151`; the new regression fails on DV2 and passes on DV3.

Image:
`proxywar-agent-llm:hrafn-v5-dv3-amd64`

- image ID:
  `sha256:dbe42b00a9f9fae518dfa9e2b46c8f7254192dc350cd7e831a7e8623110c0228`
- embedded source SHA-256:
  `a32fbcab09b3671686b26717bac07b6e29741824e492a22ed7eaebc830cf63cc`
- architecture/user: `amd64` / `node`

## DV3 short screen

Pangaea, Hrafn seat 0, 80 decisions, exact DV2 local fixture:

- score vector:
  `0.184703, 0.002446, 0.001442, 0.001280, 0.080464, 0.059495, 0.109272, 0.560898`
- Hrafn: `83/83` accepted, zero holds, zero rejects, zero K1Z harm
- daveey focus reached: `attack:<daveey>:25` with `dv1`
- replay SHA-256:
  `8e6be19f7f9a8271e4575b71a6a4e8dc5c19c713ce8b6242c8897c72f85d1c56`

This is a mechanism screen, not an outcome win. DV3 may proceed only as a fresh
hosted diagnostic against real daveey. No league submission or champion change
is authorized by this evidence.

## DV3 hosted verdict: reject and close the direct-focus arm

Diagnostic:

- label: `hrafn-fylking:v7`
- policy version: `deed077e-bc37-4c82-9534-86b14d973016`
- experience request:
  `xreq_d01dd032-020f-4fa4-9b09-11a6de6b4cc5`

Results:

- Hrafn wins: `0/4`
- Odin wins: `0/4`
- daveey wins: `2/4`
- Auri wins: `2/4`
- Hrafn direct attacks on daveey: `0`
- Hrafn harmful actions against K1Z: `0`
- Hrafn rejects: `0`
- Hrafn holds: `15` total

The only Hrafn actions containing daveey's player ID were four
`embargo:<daveey>:stop` cleanup actions. The `25%` selector never reached
because Hrafn never received a legal direct daveey attack in these four seats.
Hrafn peaked at only 31.5k-32.5k tiles and was eliminated in every game.

Replay SHA-256:

- `9d830f04b6b8d91f92d2c3face07603dfe63f89bd8b4c69388aaa380e6a00180`
- `77a1b0fb5c9791333673f4105041667aeb3b1920aef8ca8e12cd3d756074f5db`
- `7af33048d0ab7887b566fc1ea399fbd882627ab43678a93f493b2c21c575807c`
- `7c538ec01364da1b5ea5314a611a1f6fc51911a03188155aac933c7708a8be5b`

RCI conclusion: attack commitment was a real DV2 defect, but it was not the
binding hosted constraint. Spawn geometry and legal reach make a
single-opponent Hrafn role unreliable. Adding boats, target broadcasts, or
map-specific pursuit would add machinery without evidence of conversion.

Final decision:

- DV2: rejected
- DV3: rejected
- DV4: not created
- v6/v7: diagnostic uploads only; never submit or champion
- live Hrafn v5: preserve
- next experiments should improve general territorial conversion or Odin's
  own offense; do not continue the direct-daveey specialization

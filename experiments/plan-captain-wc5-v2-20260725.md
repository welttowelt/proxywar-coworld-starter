# Captain Underpants Maximum Aura v2 — WC5 preregistration

Recorded: 2026-07-25T00:30:00Z

## Immutable control

- Entrant: `Captain Underpants Maximum Aura`
- Existing live policy: `captain-underpants-max-aura:v1`
- Exact source parent: `cfc5865acfd4ebf807a0abf823ac9705822905f5`
- Existing policy-version ID:
  `348b11ff-29b1-4743-b456-e735dbf1520d`
- Existing image digest:
  `sha256:02562271dae6503a89b90a74bf9fddc272cb5aebefe383859bc36bbb7ade086c`
- Candidate branch: `rci/captain-wc5-v2-20260725`
- Candidate label after every gate passes:
  `captain-underpants-max-aura:v2`

The candidate starts from exact v1. WC1 through WC4 are evidence, not
behavioral parents.

## Failure and discriminating evidence

The diagnosed live-v1 failure is a calm World attack made with only a marginal
troop edge against a territorially larger rival:

- Episode `903ed321-cd99-46d4-83f2-eb6a3f9f1c53`, turn `1000`: Auri had
  `0.03` tile share while Captain held about `0.02`; Captain attacked at
  `1.10x` and was counterattacked within two decisions.
- Episode `589be55e-67eb-4f0b-9bd9-7bc8d5c86ee6`, turn `1700`: softmaxwell had
  `0.08` tile share while Captain held about `0.05`; Captain attacked at
  `1.08x` and was counterattacked on the next decision.

WC3 deferred a territorially equal target (`0.07` versus `0.07`) and improved
the exact same seat by 1,695 tiles. WC4 exposed the missing boundary: it
deferred a smaller target (`0.07` versus Captain at `0.08`) and collapsed to
266 tiles versus exact v1 at 104,761. A marginal troop attack is not uniformly
bad; the live failure class also requires the target to be at least as large
territorially.

## WC5 causal hypothesis

Deferring only the first pre-conflict calm World contact when both troop parity
and territorial parity favor the target will avoid the diagnosed counterattack
trap while preserving exact-v1 conversion of smaller rivals.

### Guard

All conditions must hold:

1. Map fingerprint is `World`.
2. Fewer than `20` active decisions have elapsed.
3. Exact v1 selects a non-neutral rival `attack`.
4. No prior recorded non-neutral `attack` or `boat` exists.
5. The target is visible and unprotected.
6. Target tile share is finite and at least Captain's finite tile share.
7. Target relative troop ratio is finite, `>= 1.0`, and `< 1.3`.
8. There is no current pressure and no attacker in the previous twelve
   decisions.
9. The target has no recorded hostility in the previous twenty-four decisions.
10. A legal non-high-risk neutral boat or economy build exists.

### Action

Compute exact v1 first. Under the full guard, use the unchanged neutral-boat
selector, then the unchanged economy-build selector. Emit `wc5` only when the
selected legal action differs from exact v1.

### Explicit non-changes

- A territorially smaller rival keeps exact v1 at every troop ratio.
- Current and recent retaliation remain deeply equal to exact v1.
- Any recorded non-neutral attack or boat keeps exact v1.
- Ratios at or above `1.3` keep exact v1.
- Pangaea, Asia, and unknown maps keep exact v1.
- Active decisions at or after `20` keep exact v1.
- CU1 alliance behavior, planner mode, protected-player handling, and every
  underlying selector remain unchanged.

## Red-first contract

The broad WC4 guard must fail a fixture where Captain holds `0.03` tile share,
the rival holds `0.02`, and exact v1 attacks at `1.16x`: WC4 selects the neutral
boat, but WC5 must remain deeply equal to exact v1. The two diagnosed
larger-target fixtures must still defer, and all WC4 negative boundaries stay
deeply equal.

## Fresh outcome-blind reach qualifier

Use pinned ProxyWar `0.1.10`, World/Normal/Easy, `25` decision steps, and twelve
copies of the exact candidate image named `Captain parity clone 0` through
`Captain parity clone 11`.

The immutable ordered seed list excludes every previously executed seed:

`20260728, 20260729, 20260730, 20260731, 20260732, 20260733, 20260734, 20260735,
20260736, 20260737, 20260738, 20260739`

Select the first seed containing `wc5`; within it, select the earliest marker
turn then lowest slot. Do not inspect scores or territory during selection.
Before the first marker all wrappers are action-identical to exact v1. Reject
WC5 if the list has zero reach.

## Same-seat causal pair

Using the selected seed, slot, fixed names, and a `100`-decision bound:

- Control: exact v1 in all twelve slots.
- Candidate: WC5 only in the selected slot; exact v1 elsewhere.

Require:

1. Candidate marker reach and zero control markers.
2. Every decision accepted with zero fallbacks and degradation.
3. The causally changed seat has zero unexplained holds in both arms; report
   all whole-field holds separately.
4. Candidate beats control at the selected seat lexicographically on score,
   survival, then tiles.
5. No other source, roster, seed, name, map, horizon, or runtime difference.

Any failure rejects WC5 without seed replacement, threshold tuning, or rerun.

## Promotion gates

After the local causal pair passes:

1. Bind the exact linux/amd64 image and complete the final RCI audit.
2. Upload only `captain-underpants-max-aura:v2`.
3. Pass a hosted current-field `4/4` diagnostic.
4. Pass an independent map-and-seat `20/20` regression.
5. Submit with validated Competition settings.
6. Independently verify player, policy version, submission, membership,
   champion switch, and first completed round.

Live v1 remains unchanged until verified v2 submission succeeds.

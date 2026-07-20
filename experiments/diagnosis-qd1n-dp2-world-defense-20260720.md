# DP2 — World opening Defense Post diagnostic

## Decision

Candidate only. DP2 is not uploaded, submitted, or eligible for a league
change. It must first reach cleanly in a World diagnostic, then beat the exact
v89 parent in mirrored local gates, hosted 4/4, and regression 20/20.

## Fresh causal observation

Round 544, World 12P, episode `501125fd-5b8c-439d-9cf5-a8941e68da50`:

- Odin was under an incoming attack at turn 1100 while at 0.14% tile share and
  57% troop ratio.
- The parent selected a legal `Factory` through its generic defensive-build
  branch. A legal `Defense Post` was offered in the same action set.
- The replay is
  `https://softmax-public.s3.amazonaws.com/replays/85981277-fe53-4b39-9198-c49c640f55ae.replay`;
  SHA-256 `b52e4c810074f16df2a5c35db8edd330a3bbd78d9183f5b29f264da63719d068`.

The authoritative game observation builder represents `incomingAttacks` as
`player.incomingAttacks().length`. DP2 therefore responds only to an actual
current count, not a later tactical-audit snapshot after the attack resolves.

## Mechanism

DP2 replaces exactly that early **World** defensive Factory preference with a
legal Defense Post when all of these are true:

- active decision 6 through 14;
- at least one current incoming attack;
- troop ratio below 0.80 and tile share below 2%;
- a City already exists and no Defense Post has been built;
- World is identified from the spawn history; and
- a Defense Post is legal.

The replacement emits `dp2`. It has no path outside this window and does not
alter the normal exact-v89 offensive, coalition, or build selection paths.

## Why this is not the rejected DP1 arm

DP1 tested a Pangaea-only, broader Defense Post rule. It reached locally but
failed the hosted 4/4 gate, so it was rejected and never promoted. DP2 is a
new map-and-phase cell: the concrete World opening defensive Factory branch in
Round 544. DP1 remains rejected; DP2 earns no credit from it.

## Reproducibility

- exact parent source: `db02545f`, byte-identical to
  `proxywar-agent-llm:qd1n-v89-exact-amd64` before this branch;
- candidate commit: `af92041f`;
- candidate image: `proxywar-agent-llm:qd1n-v89-dp2-amd64`, linux/amd64,
  manifest `sha256:69c80cf989d676aaa916b7f062c6f61321bb3b6362eeafb98146c5950c38d364`;
- full candidate suite: `142/142` passing; the DP2 test is red without the
  branch and asserts the Factory-to-Defense-Post replacement.

## Gate plan

1. Canonical 8P World candidate-v89 reach check: marker, accepted decisions,
   no unexplained hold/reject, and no K1Z harm.
2. Only if it reaches cleanly: alternating World parent/candidate comparison,
   with Pangaea trace identity as a dormant-scope control.
3. Promote only after local advantage, hosted 4/4, and 20/20 regression.

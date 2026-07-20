# Hrafn DV1: daveey-focused warrior

Date: 2026-07-20

## Hypothesis

Redirect Hrafn's existing priority campaign from Auri to daveey. Earlier focus
pressure should reduce daveey's territory and improve Odin's outcome without
feeding daveey or harming K1Z.

## Candidate

- Exact live-v5 parent: `0c151570f7e650a32a5705ff71692aa930012097`
- Candidate: `af0954cf6d0d20c5f06c5c4878814d3b0e406264`
- Marker: `dv1`
- Image: `proxywar-agent-llm:hrafn-v5-dv1-amd64`
- Image digest: `sha256:99125cb59a7375b7961d9fe294f58e7cac159527ce097c144a9dd3abedebc44f`
- Tests: `149/149`

The change preserves Odin support, K1Z protection, priority attack floor, and
the runaway-leader handoff.

## Local matched pair

Both arms used Pangaea, seed `20260721`, Hrafn in slot 0, daveey in slot 1,
the same eight-player roster, and 80 decision steps.

| Metric | DV1 | Exact parent |
| --- | ---: | ---: |
| First Hrafn focus action against daveey | turn 1,300 | turn 3,000 |
| Accepted daveey focus actions | 12 | 11 |
| daveey score | 0% | 22.6195% |
| Odin score | 5.1871% | 5.1614% |
| Hrafn score | 12.5605% | 13.0534% |
| katanasan score | 55.6178% | 29.9776% |
| Holds | 0 | 0 |
| Rejects | 0 | 0 |
| K1Z harmful actions | 0 | 0 |

Candidate replay SHA-256:
`c19d8f72f8db3939cc6e6b8a6009728e5329195fef55f604a29510f8650d8755`

Parent replay SHA-256:
`2c6b71648d7d8b45e28f1241f36e62dc2fe94a001afbbbdd2ded609017823a87`

## Verdict

Local pair passed and justifies a larger matched screen. It does not justify
upload or champion promotion: the opponent seats use exact local proxy images,
not hosted daveey, and one deterministic pair cannot establish robustness.

Next gate: seat-swapped pairs across Pangaea and World, followed by a hosted
current-roster diagnostic only if the advantage persists.

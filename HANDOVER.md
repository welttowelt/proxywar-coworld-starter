# ProxyWar Qd1n handover

## Authority

Codex Odin is the sole writable operator in this repository and mutates Qd1n
only. Hrafn is retired here; its v5 policy is frozen and belongs in a separate
read-only chat unless the user explicitly revives it. Kimi K3 Max is an
external moonshot adviser and performs no runner or league mutations.

Automatic diagnostic upload, submission, and champion promotion are authorized
only after every gate in `AUTONOMOUS_PROMOTION.md` passes. No additional user
`GO` is required after those objective gates.

## Live control

- Player: `K1Z odin free`
- Player ID: `ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c`
- Champion: `qd1n:v89`
- Policy version: `ca4a4e76-fd83-4c92-bf9f-f2440d1f867f`
- Submission: `sub_d159efaa-f3f1-4641-acd0-51bba2e04a72`
- Membership: `lpm_7f695f76-b1d6-43e9-8af6-338a041ccfa6`
- Exact source parent:
  `f1347251834a6283182b631e1336595eb2e08342`
- Exact strategy SHA-256:
  `f2ee66d570033508c4158bcb83d56d81dc198cdcebb91098d7e67eefdc8e6a7a`

Refresh live standings and the latest completed round before reporting score,
rank, or streak.

## Current campaign

Read these in order:

1. `.codex/active-arm.json` — current operational state.
2. `MISSION_COMMAND.md` — the single active hypothesis and gate contract.
3. `AUTONOMOUS_PROMOTION.md` — promotion states and automatic authority.
4. `MERIT.md` — terminal historical evidence.

NB1 safe frontier boats is the only active candidate. It may resize an
already-selected neutral 8-percent boat to the legal same-destination
16-percent form only at troop ratio 0.87 or higher with zero current threat.
Every other decision remains exact v89.

PG2 is terminally closed: hosted `4/4` completed, but Odin won `0/4` and
recorded 17 unexplained holds. A1 is also closed: zero marker reach, 13 holds,
and a negative paired result. PR1 was closed before source mutation because it
duplicates the rejected DP1 Defense Post family. A2/A3 and all prior rejected
arms remain closed.

## Runner

Every Coworld episode or batch must remain under the foreground supervisor:

```bash
scripts/proxywar-runner-lease.sh run odin RUN_ID \
  --output /private/tmp/new-output-a \
  --output /private/tmp/new-output-b \
  -- /absolute/path/to/batch-script.sh
```

Start only when `scripts/proxywar-runner-lease.sh status --json` reports
`free`. Never delete a lease, stop broad Coworld containers, or touch another
run's outputs. Use fresh dedicated output directories.

## Communication

- Mailbox:
  `/Users/olifreuler/.stormforge/team-mailbox`
- Write only terminal verdicts, exact review requests, or concrete blockers.
- Use plain English.
- Slack is frozen through 2026-08-09T11:27:17Z. Do not interact with Slack.

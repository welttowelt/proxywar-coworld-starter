# ProxyWar / Qd1n current handover

Updated: 2026-07-21

Canonical repository:
[`welttowelt/proxywar-coworld-starter`](https://github.com/welttowelt/proxywar-coworld-starter)

## Mission

Retake the ProxyWar lead by improving Odin's general first-place conversion.
Keep exact `qd1n:v89` as the live control, test one causal mechanism at a time,
and promote automatically only after every gate in
[`AUTONOMOUS_PROMOTION.md`](AUTONOMOUS_PROMOTION.md) passes.

## Read order

1. [`AGENTS.md`](AGENTS.md) — authority and safety boundaries.
2. [`.codex/active-arm.json`](.codex/active-arm.json) — the only dynamic arm,
   gate, live-control, and next-transition record.
3. [`MISSION_COMMAND.md`](MISSION_COMMAND.md) — commander's intent.
4. [`AUTONOMOUS_PROMOTION.md`](AUTONOMOUS_PROMOTION.md) — automatic promotion
   protocol.
5. [`MERIT.md`](MERIT.md) — terminal evidence and historical verdicts.

Refresh the official API before making a current scoreboard, round, membership,
or champion claim. Keep scoreboard truth, replay truth, source truth, and
deployment truth separate.

## Operator topology

- **Codex Odin:** sole writable `qd1n` operator and sole Qd1n league-mutation
  authority.
- **Mickey:** Hrafn's local successor on this Mac. Mickey owns local source,
  evaluation, Docker, and CPU fanout through the foreground `mickey` runner
  lease.
- **Hrafn:** Studio-only operator for `hrafn-fylking`. Hrafn has no local runner,
  daemon, identity window, or Qd1n authority on this Mac.
- **Kimi K3 Max:** external strategy adviser only. Kimi does not edit policy
  source, use the runner, or mutate league state.

Mickey does not inherit Hrafn's player, policy, submission, membership,
champion, or evidence. Mickey has no live Coworld authority until it has a
distinct player credential and passes its own gates. Do not rename, activate,
or reuse `K1Z Hrafn` for Mickey.

Historical Hrafn worktrees, images, replays, and experiment files are inert
evidence. Do not resume their old C3, C4, HI1, OS1, or identity-window sequences.

## Verified local control state

- Normal Coworld identity: `K1Z odin free` active.
- `K1Z Hrafn`: inactive in the normal Coworld home.
- Local runner: accepts only `odin` or `mickey`; `hrafn` fails closed.
- Installed background operator: Odin only.
- Local Hrafn processes and launch agents: none.
- Qd1n mutation lock and runner lease must both be rechecked immediately before
  any action.

## Execution contract

Every local episode or batch stays in the foreground of the lease wrapper:

```bash
scripts/proxywar-runner-lease.sh run mickey RUN_ID \
  --output /private/tmp/new-dedicated-output \
  -- /absolute/path/to/command [args...]
```

Mickey may build exact images and produce local evidence. It may not upload,
submit, change memberships, or change champions. Qd1n diagnostic and promotion
mutations belong only to Odin and must use
`scripts/proxywar-qd1n-mutation.sh` after the recorded gates pass.

## Resume rule

Pull with fast-forward only, preserve updater-owned dirty data files, verify the
active Coworld identity and both locks, then advance exactly the
`next_automatic_transition` in `.codex/active-arm.json`. Commit and push each
real arm transition or terminal blocker. Do not reopen retired arms or add a
second policy mechanism.

Slack is frozen through 2026-08-09T11:27:17Z. Do not access it in any form.

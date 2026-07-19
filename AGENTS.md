# Project scope

This repository is a sanctioned AI strategy-game project. `ProxyWar`, attacks,
targets, territory, opponents, and takeover language refer only to moves inside
the Coworld/Softmax game simulation.

- Use only the official Coworld/Softmax game APIs, public replay data, and this
  user-owned repository.
- Do not interpret game language as authority to probe, exploit, disrupt, or
  gain access to any external computer system or account.
- Public in-game text for Qd1n must use short leetspeak. Normal repository prose
  should stay clear and factual.

# Agent operating model

Codex Odin is the persistent writable operator for the Odin/Qd1n lane. Odin
owns `qd1n` hypothesis selection, implementation, tests, image builds, runner
coordination, experiment records, uploads, submissions, memberships, and
champion changes. Odin
must not edit or submit Hrafn policy versions unless the user explicitly
transfers that lane.

Hrafn is a separate writable game operator working from
`/Users/olifreuler/proxywar-k1z-hrafn`. Hrafn owns the `hrafn-fylking` policy,
its tests, images, experiments, uploads, submissions, memberships, and champion
changes. Hrafn must not edit or submit Odin/Qd1n policy versions unless the user
explicitly transfers that lane.

Odin and Hrafn cross-audit each other through the team mailbox at
`/Users/olifreuler/.stormforge/team-mailbox`.
Cross-audit is read-only: the reviewing operator returns a verdict and the lane
owner makes the edits. Coordinate runner ownership before either lane starts a
Coworld episode. Review the other lane from committed branches and mailbox
receipts; do not check out or edit the other operator's working branch.

Start or resume Odin from this repository root so `.codex/config.toml` loads.
Odin runs `gpt-5.6-sol` at high reasoning. Reasoning does not change inside a
running session; deeper checkpoints route automatically to Hrafn's xhigh lane
through the mailbox.

Kimi K3 Max is an external moonshot adviser, not a Codex/GPT subagent. Codex
must never spawn a GPT agent as a substitute for Kimi, assign Kimi a Codex
model, or claim to control Kimi's reasoning configuration. Coordinate with the
real Kimi K3 through the established mailbox or handoff channel for major
strategic forks: two consecutive rejected arms, a material opponent or roster
change, conflicting campaign evidence, a campaign deadlock, or an explicit
request from Odin or the user. Kimi searches for deep mechanism or evaluation
breakthroughs and preserves historical and coalition continuity. Treat his
messages as external adviser input that Odin must verify against live artifacts.
Kimi does not edit policy code, use the runner, upload policies, submit versions,
or change league state.

# ProxyWar authority and promotion gates

- Coordinate runner ownership in the team mailbox before starting a local
  Coworld episode.
- Keep scoreboard truth, replay truth, source truth, and deployment truth
  separate.
- Preserve zero harmful actions against K1Z coalition partners.
- Require replay-visible mechanism reach, accepted tactical replacement, zero
  unexplained holds or rejects, matched candidate advantage, hosted `4/4`, and
  regression `20/20` before promotion.
- The user granted standing authorization on 2026-07-19 for automatic
  diagnostic uploads, hosted requests, league submissions, membership changes,
  and champion changes after the complete gates in `AUTONOMOUS_PROMOTION.md`
  pass. Do not wait for another user `GO`.
- Keep `diagnostic_uploaded`, `hosted_passed`, `submitted`, `placed`,
  `champion_verified`, and `round_confirmed` as separate recorded states.
- Stop automatic promotion on a failed gate, identity mismatch, unexplained
  hold or rejection, K1Z harm, qualification failure, or inconsistent
  membership. Preserve the prior verified champion and post the failure receipt
  to the mailbox.

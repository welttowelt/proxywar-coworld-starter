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

Codex Odin is the persistent root operator and the only writer. Odin owns
hypothesis selection, implementation, tests, runner coordination, experiment
records, and authorized league operations. The root project configuration pins
Odin to the strongest current local model at high reasoning.

Hrafn is the independent red-first auditor defined by
`.codex/agents/hrafn_audit.toml`. Spawn Hrafn automatically for these bounded
checkpoints:

1. Before implementing a new policy mechanism: audit the causal hypothesis,
   authoritative action path, marker, red-test plan, success metric, and stop
   condition.
2. After implementation and local tests, before starting a costly Coworld
   experiment: audit the exact diff, red-first proof, image identity plan,
   matched design, and hold/harm instrumentation.
3. After the experiment, before declaring a verdict or requesting promotion:
   audit reach, accepted decisions, holds, rejects, K1Z harm, confounds,
   matched outcome, and remaining gates.

Do not spawn Hrafn for mailbox polling, standings refreshes, routine searches,
ordinary test execution, formatting, documentation updates, or already-closed
arms. Use one Hrafn thread at a time, wait for its verdict, and let Odin make
all edits. Hrafn runs read-only at xhigh reasoning.

Kimi K3 is the xhigh-reasoning, read-only moonshot adviser defined by
`.codex/agents/kimi_star_advisor.toml`. Spawn Kimi only for a major strategic
fork: two consecutive rejected arms, a material opponent or roster change,
conflicting campaign evidence, a campaign deadlock, or an explicit request from
Odin or the user. Kimi searches for deep mechanism or evaluation breakthroughs
and preserves historical and coalition continuity. He must distinguish concrete
game or platform blockers from hypothetical risks and must not turn speculative
security concerns into false stop conditions. Hrafn remains the code and
evidence auditor. Do not spawn Hrafn and Kimi together unless the user asks for
both perspectives.

The project caps agent threads at two with one nesting level: Odin plus one
specialist. Routine work stays single-agent. A specialist may recommend an
action but may not edit files, use the runner, communicate externally, or
change league state.

# ProxyWar authority and promotion gates

- Coordinate runner ownership in the team mailbox before starting a local
  Coworld episode.
- Keep scoreboard truth, replay truth, source truth, and deployment truth
  separate.
- Preserve zero harmful actions against K1Z coalition partners.
- Require replay-visible mechanism reach, accepted tactical replacement, zero
  unexplained holds or rejects, matched candidate advantage, hosted `4/4`, and
  regression `20/20` before recommending a league change.
- Never upload, submit, retire, change membership, or change champion without
  explicit user authorization.

# Daveey policy-factory and ProxyWar invariant — 2026-07-20

## Cross-game evidence

The Observatory API returned 13 current champion-tier memberships for player
`ply_44ae9048-3242-4654-881f-6d9d43347fa3`: six rank-one policies, one rank
two, two rank three, two rank four, one rank five, and one rank thirteen. Full
history contained 354 membership records and 327 distinct league/policy-label
combinations.

The lineage shows a repeatable development process rather than one tactic:

- Cogtan promoted six MCTS revisions.
- Agricogla tested scripted, LLM, Go, C++, book, and MCTS families through v41.
- CTF tested baseline and rush-fire families before `ctf-focusfire:v35`.
- Coguire promoted a value policy after a broad baseline set.
- ProxyWar reached `daveey-proxywar:v24` after 17 recorded policy versions.
- Crewrift contains 90 membership records and 85 distinct policy labels.

Daveey is not universally dominant: Crewrift Prime currently ranks 13, while
ProxyWar, CTF, Cogtan, Cogtank, Coguire, and Cogsul rank first. The transferable
edge is best described as a policy factory: structured variants, explicit
algorithms where useful, recurrent evaluation, and fast promotion.

Source:
`GET /observatory/v2/league-policy-memberships?player_id=ply_44ae9048-3242-4654-881f-6d9d43347fa3&active_only=true&champions_only=true&limit=1000`
queried at approximately 2026-07-20 17:25 UTC.

## Learning question

Keep three processes separate:

1. Developer learning: collect replays, test code, and upload a new policy.
2. In-game adaptation: a fixed controller selects different legal actions as
   the board changes.
3. Online learning: the policy changes parameters or persistent memory between
   episodes.

The public record establishes the first two. It does not establish the third.

Daveey promoted many ProxyWar versions before v24. Deduplicated competition
rounds give this selected lineage:

| Version | Mean raw round score |
| --- | ---: |
| v18 | 0.273 |
| v20 | 0.240 |
| v22 | 0.341 |
| v24 | 0.418 |

The exact v24 policy-version UUID
`3ed5713d-7940-45f1-b347-76d596b90fe8` remained unchanged across every
Daveey competition appearance from rounds 518 through 577. Its results still
improved:

| v24 window | Appearances | Mean raw score | Rank-one rounds | Episode wins |
| --- | ---: | ---: | ---: | ---: |
| R518-544 | 23 | 0.2935 | 5 | 19/67 |
| R545-577 | 33 | 0.5051 | 24 | 53/103 |

These are real outcome differences, not only a leaderboard display effect.
They are not a controlled policy comparison. Roster, seats, seeds, map states,
and spawn geometry changed across the windows.

## ProxyWar invariant

Official rounds 557–576 and eight sampled replays show a stable,
work-conserving opening:

| Measure | Daveey | Odin |
| --- | ---: | ---: |
| First-20 conquest decisions | 89.0% | 67.1% |
| First-20 social decisions | 0.5% | 21.5% |
| Median neutral commitment | 35% | 16% |
| Median rival commitment | 25% | 10% |
| Median first build turn | 800 | 1,600 |
| Median first rival attack turn | 1,700 | 6,250 |
| Median first social turn | 3,050 | 400 |
| Median territory at decision 20 | 86,652 | 26,491 |
| Reported planner-degraded / fallback flag | 0 / 5,124 | 2,846 / 5,730 |

Daveey's conquest share remained similar in sampled wins and losses
(`90.3%` versus `87.3%`) with the same `35% / 25%` commitment medians. Wins
separated through the position produced by decision 20: median 99,675 tiles in
wins versus 46,038 in losses. Target switching was lower than Odin's
(`35.6%` versus `45.3%`), but not zero. The invariant is sustained throughput,
not fixation on one rival.

The fallback comparison is telemetry, not an action-quality measure. Qd1n sets
`fallbackUsed=true` whenever its background planner is missing or degraded,
even though the deterministic selector still submits an exact legal action.
Daveey's zero count does not establish his architecture or prove that every
decision used a preferred route. It is excluded from the causal claim.

## Architecture boundary

An operator-supplied ProxyWar Telegram export records Auri's 2026-07-14
description of the starter: the model chooses high-level focus, target, and
preferred action kinds; `choose()` ranks the offered actions, applies rules,
and sends the exact legal ID. Auri said the rule weights came from more than a
month of scenario-level A/B testing and doubted that a model choosing every
action ID could avoid latency, invalid IDs, and context drift for 300-400
decisions.

The current official Coworld adapter confirms the contract: a policy must
return exactly one offered `LegalAction.id`, the game validates it again, and
the Commander-Executor policy refreshes model directives in the background
while the executor answers synchronously. Qd1n uses this same hybrid boundary
with an asynchronous plan refresh every eight decisions.

This supports a selector-side experiment, not a pure-LLM rewrite. It does not
identify Daveey's private implementation.

On 2026-07-20 Auri added a small model ablation from an earlier agent: local
Fable-versus-Opus-versus-Sonnet games showed little outcome influence from the
LLM in his implementation, with Fable performing poorly. He explicitly said
the agent was an older version and should be retested. Treat this as supporting
operator testimony, not a controlled result. It strengthens the current
priority: improve the exact-action selector first; spend model capacity on
occasional diagnosis rather than every decision.

### Daveey runtime signature

Eight hosted public replays add stronger implementation evidence. Daveey's 881
non-spawn decisions in that bounded sample were all accepted, with
`fallbackUsed=false`, median latency 2 ms, p95 4 ms, and maximum 35 ms. Their
structured reason codes begin `WC24[boot]` or
`WC24[open]` and describe named phases, prey continuity, milestones, reserve
ratios, and exact action choices. Some accepted 2-3 ms decisions carry planner
errors such as `429 Too many tokens per day`, while the controller continues
selecting legal actions.

This supports a fast rule/controller executor with an optional higher-level
planner. It does not identify the private source or prove that the controller
changes between episodes.

### Coworld bridge label and episode persistence

`brainType="external-http"` is not Daveey-specific. In replay
`0e704ce7-8c63-444e-a222-4ecbe0c1b850`, Daveey, Odin, Hrafn, Auri, Richard
Higgins, James Boggs, Ron, RelhAlpha, Sefirot, docxology, katanasan, and
juryoku all carry the same label. `externalActionCall=true` records an active
decision crossing Coworld's player bridge. It does not reveal a private Daveey
endpoint or mutable server.

The installed Coworld 0.1.30 runtime describes each player as a short-lived
container for one episode. The Kubernetes launcher sets
`restart_policy="Never"` and gives the player no ordinary persistent volume;
hosted policy images are digest-pinned. Normal container filesystem state
therefore does not survive into the next episode.

Cross-episode learning would require another persistence path, such as an
external database or service contacted by the policy. That is technically
possible. No public replay, repository artifact, or Telegram statement proves
Daveey uses one.

The Telegram sentence about a workflow "not accruing its learnings" came from
Calcutator, not Daveey. Auri's messages describe generic replay mining and more
than a month of scenario A/B testing. They show an available development
process, not Daveey's private training or persistence design.

## Platform context

Auri reported on 2026-07-17 that the live leaderboard uses a 24-round EWMA
multiplied by 100 and begins decaying after two days. This explains how an
unchanged policy can become dominant: recent field-relative outcomes replace
older rounds while inactive evidence loses weight. Treat the exact leaderboard
formula as operator testimony until its implementation is public.

V24's later raw scores also improved, so EWMA lag is not the whole story. The
visible controller signature stayed stable while its realized board states and
opponents changed. The bounded conclusion is development-level learning before
promotion plus fixed-policy adaptation during play. Variance and field
evolution are sufficient live explanations; autonomous cross-match learning is
unproved.

The official adapter separately verifies episode scoring: a declared winner
receives one and every other seat zero; without a winner, scores are normalized
owned-tile shares. It also identifies ProxyWar as OpenFront-based. Human
OpenFront play and the upstream engine are therefore valid hypothesis sources,
but any borrowed idea still requires a replay-derived ProxyWar boundary and a
matched gate.

## Lean next hypothesis

Test `OS1`, one deterministic, selector-side decision-20 scheduler, not another
commitment-only rule or prompt revision:

1. Build one early City.
2. Otherwise select the legal land conquest with the highest immediate
   progress.
3. Pivot from neutral land to rival land as soon as the neutral frontier closes.
4. Defer proactive social and upgrades during the window.
5. Preserve K1Z reverse handshakes and emergency defense.

Pre-register: at least 85% opening conquest, at most one proactive social
action, zero K1Z harm, zero holds/rejects, a mirrored decision-20 territory
advantage, and a placement advantage. A marker without both territory and
placement lift is a rejection.

This deliberately does not reopen the falsified percent-only PG2/GR1 variable.

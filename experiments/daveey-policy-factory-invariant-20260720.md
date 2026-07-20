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

## Platform context

Auri reported on 2026-07-17 that the live leaderboard uses a 24-round EWMA
multiplied by 100 and begins decaying after two days. This explains how an
unchanged policy can become dominant: recent field-relative outcomes replace
older rounds while inactive evidence loses weight. Treat the exact leaderboard
formula as operator testimony until its implementation is public.

The official adapter separately verifies episode scoring: a declared winner
receives one and every other seat zero; without a winner, scores are normalized
owned-tile shares. It also identifies ProxyWar as OpenFront-based. Human
OpenFront play and the upstream engine are therefore valid hypothesis sources,
but any borrowed idea still requires a replay-derived ProxyWar boundary and a
matched gate.

## Lean next hypothesis

Test one deterministic, selector-side decision-20 scheduler, not another
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

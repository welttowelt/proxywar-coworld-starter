# ODC1 local evaluator

`scripts/audit-odc1-pair.py` is the fail-closed evaluator for ODC1 local
evidence. Competitive mode audits a seeded candidate/parent A/B screen.
Mechanism mode audits one candidate trace when the exact parent cannot run
locally under the same planner runtime. Both modes check integrity, candidate
runtime health, coalition safety, and route execution. Only competitive mode
checks positive candidate advantage in each orientation.

`PASS_MECHANISM_SCREEN` proves candidate identity, route reach, accepted legal
actions, and K1Z safety. It explicitly carries `competitive_evidence: false`.
The hosted `4/4` remains the first outcome gate. Neither local verdict can
authorize a submission, membership change, champion change, or promotion.

## Contract schema

Use `schema_version: 2` and set `screen_mode` to `competitive` or `mechanism`.
The contract pins:

- `candidate` and `parent`: `name`, image tag, resolved `image_id`, and
  40-character `source_commit`;
- `manifest.path` and `manifest.sha256`;
- `game_config`, `pair_id`, and A/B `orientations`;
- `candidate.markers` and `candidate.route_markers`;
- `differential_unit_proof.path` and its SHA-256;
- `advance_thresholds.minimum_candidate_mean_score_delta`;
- `coalition.actor_role`, `coalition.identities`, presence requirements, and
  the narrow endgame exception.

Each coalition identity has a unique `role`, one or more `names`, and optional
stable `player_id` or `player_ids`. Name matching normalizes punctuation and
the optional `K1Z` prefix. Match-scoped Coworld IDs are learned from
`auditBefore.playerID`. Set `coalition.require_presence: true` and list every
required partner in `required_present_roles` for a coalition gate. The gate
stops if a configured partner is absent.

The corrected ODC1 source has no K1Z endgame exception because the current
observation exposes only visible rivals, not an authoritative alive roster.
Configure that fail-closed state explicitly:

```json
{
  "endgame_exception": {
    "enabled": false
  }
}
```

If a future engine surface provides authoritative survivor evidence, an
exception may be configured as:

```json
{
  "endgame_exception": {
    "enabled": true,
    "marker": "odwin",
    "allowed_kinds": ["attack", "boat", "nuke", "warship", "move_warship"],
    "evidence_field": "k1zOnlyEndgame"
  }
}
```

A harmful action against K1Z is exempt only when the configured marker is
present and the persisted evidence object contains
`allSurvivingRivalsK1Z: true` plus a nonempty `survivingRivals` list. Every
listed survivor must resolve to a configured K1Z partner, and the selected
target must be in that list. Global embargoes are never exempt.

Supply optional `--resolved-images-a` and `--resolved-images-b` JSON files to
record and verify the image IDs actually resolved for each run. Each file has
`candidate` and `parent` entries with `tag` and `image_id`. Set
`require_resolved_image_ids: true` in the contract to make those files
mandatory.

The report uses `route_execution_count`. A route marker proves that the
candidate executed a designated route; it is not a counterfactual causal
effect. In competitive mode, each orientation must independently produce
positive score and tile deltas, and candidate or parent fallback/degradation
stops the screen. In mechanism mode, candidate fallback/degradation still
stops the screen; parent runtime health and outcome lift are deliberately
outside the verdict because hosted execution supplies the valid planner
environment.

## Prior receipt

`experiments/audit-qd1n-odc1-clean-dispatcher-seeded-20260720.json` is retained
as historical evidence but is downgraded to a no-plan local baseline. Its
two-player roster contained no K1Z partner, the v89 controls degraded, and its
old `causal_transition_count` field counted route executions. Do not treat that
receipt as local qualification or coalition-safety proof.

No old temporary job bundle is copied here. Create a fresh immutable schema-v2
contract and jobs only after the repaired dispatcher and its production-shaped
tests are pinned.

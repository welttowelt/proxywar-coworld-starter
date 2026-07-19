#!/usr/bin/env python3
"""Fail-closed semantic audit for one PG2 candidate/parent pair."""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import json
import math
import re
import sys
import unicodedata
from pathlib import Path

EXPECTED_ROSTER = [
    "K1Z odin free",
    "K1Z Hrafn",
    "K1Z juryoku-koku",
    "K1Z katanasan",
]
EXPECTED_BASE_IMAGE = (
    "public.ecr.aws/q5f4m8t9/cogames@"
    "sha256:88d166c6c33609ec5b0dc1f70799001a1f1f34e1cd852ddbfc17a2eb43969ea1"
)
EXPECTED_RUNTIME_FINGERPRINT = (
    "097499401ec700fe651f3dfd8e6cebda4ebf8d1ca621c427db8b1eceff2fa55d"
)
EXPECTED_ORCHESTRATOR_SHA = (
    "cac167b4be407ecf958391d605d28090f2b4d3bfc5cfd9795334cefbf4f4e6ee"
)
EXPECTED_POLICY_IMAGES = {
    "candidate": {
        "qd1n-pg2": "sha256:3f01ffafd10079a3f0a9ead1704481df623bceedad0ad0f7f47fea77344e6b5d",
        "hrafn-v5": "sha256:3f427fd382daa521f0f3af31096b1326fdab0277eff7fc7638e03c944abb058d",
        "juryoku-v3": "sha256:2ebf15372e8cf59b194ebb20f06b818a6a54f96994f4125e103b6a26070491c2",
        "katanasan-v39": "sha256:0afece2db25675b0b744844769c64e02960270f56502c33d62bf0702f7b58cf6",
    },
    "parent": {
        "qd1n-v89": "sha256:ebd9eed3f8a936cc2d0813f54944a0e3e826a0141932356041d71f0c3638a478",
        "hrafn-v5": "sha256:3f427fd382daa521f0f3af31096b1326fdab0277eff7fc7638e03c944abb058d",
        "juryoku-v3": "sha256:2ebf15372e8cf59b194ebb20f06b818a6a54f96994f4125e103b6a26070491c2",
        "katanasan-v39": "sha256:0afece2db25675b0b744844769c64e02960270f56502c33d62bf0702f7b58cf6",
    },
}
HARMFUL_KINDS = {
    "attack",
    "boat",
    "nuke",
    "embargo",
    "embargo_all",
    "target_player",
    "break_alliance",
    "alliance_reject",
    "move_warship",
    "warship",
}
TACTICAL_KINDS = {
    "attack",
    "boat",
    "build",
    "upgrade_structure",
    "nuke",
    "move_warship",
    "warship",
    "donate_troops",
    "donate_gold",
    "retreat",
    "boat_retreat",
}
TARGET_PREFIX = re.compile(
    r"^(?:attack|target|embargo|alliance|quick_chat|emoji|"
    r"donate_troops|donate_gold):([^:]+)"
)


def canonical(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).lower()
    text = re.sub(r"[_-]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> object:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def verify_hash_manifest(root: Path, manifest: Path) -> list[str]:
    violations = []
    with manifest.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            match = re.fullmatch(r"([a-f0-9]{64})\s+\*?(.+)\n?", line)
            if not match:
                violations.append(f"{manifest.name}:{line_number}: malformed hash line")
                continue
            expected, relative = match.groups()
            target = Path(relative)
            if target.is_absolute() or ".." in target.parts:
                violations.append(f"{manifest.name}:{line_number}: unsafe path")
                continue
            full = root / target
            if not full.is_file():
                violations.append(f"{manifest.name}:{line_number}: missing {relative}")
            elif sha256(full) != expected:
                violations.append(f"{manifest.name}:{line_number}: hash drift for {relative}")
    return violations


def load_decisions(run_dir: Path) -> list[dict]:
    paths = sorted(run_dir.glob("proxywar-runs/*/decisions.jsonl"))
    if len(paths) != 1:
        raise ValueError(
            f"{run_dir}: expected one decisions.jsonl, found {len(paths)}"
        )
    decisions = []
    with paths[0].open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                decisions.append(json.loads(line))
            except json.JSONDecodeError as error:
                raise ValueError(f"{paths[0]}:{line_number}: {error}") from error
    return decisions


def has_marker(decision: dict, marker: str = "pg2") -> bool:
    return str(decision.get("reason") or "").lower().split(":")[-1] == marker


def finite_number(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def target_id(decision: dict) -> str | None:
    metadata = decision.get("selectedActionMetadata") or {}
    submitted = (decision.get("result") or {}).get("submittedIntent") or {}
    direct = (
        metadata.get("targetID")
        or metadata.get("recipientID")
        or metadata.get("playerID")
        or submitted.get("targetID")
    )
    if direct:
        return str(direct).lower()
    match = TARGET_PREFIX.match(str(decision.get("selectedLegalActionId") or ""))
    return match.group(1).lower() if match else None


def player_ids(decisions: list[dict]) -> dict[str, str]:
    found: dict[str, str] = {}
    for decision in decisions:
        audit = decision.get("auditBefore") or decision.get("auditAfter") or {}
        player_id = audit.get("playerID")
        if player_id:
            found[canonical(decision.get("username"))] = str(player_id).lower()
    return found


def classify_holds(decisions: list[dict], ally_ids: set[str]) -> list[dict]:
    unexplained = []
    for decision in decisions:
        if decision.get("selectedActionKind") != "hold":
            continue
        if "legalActionIDsByKind" not in decision:
            unexplained.append(
                {
                    "turn": decision.get("turnNumber"),
                    "reason": decision.get("reason"),
                    "tactical_actions": None,
                }
            )
            continue
        legal = decision.get("legalActionIDsByKind") or {}
        tactical: list[tuple[str, str, str | None]] = []
        for kind, identifiers in legal.items():
            if kind not in TACTICAL_KINDS:
                continue
            for identifier in identifiers or []:
                match = TARGET_PREFIX.match(str(identifier))
                action_target = match.group(1).lower() if match else None
                tactical.append((kind, str(identifier), action_target))
        if not tactical:
            continue
        protected_only = all(
            kind in {"donate_troops", "donate_gold"}
            and action_target is not None
            and action_target in ally_ids
            for kind, _, action_target in tactical
        )
        if not protected_only:
            unexplained.append(
                {
                    "turn": decision.get("turnNumber"),
                    "reason": decision.get("reason"),
                    "tactical_actions": [
                        {
                            "kind": kind,
                            "id": identifier,
                            "target_id": action_target,
                        }
                        for kind, identifier, action_target in tactical
                    ],
                }
            )
    return unexplained


def current_tiles(decision: dict) -> float | None:
    opening = (
        (decision.get("tacticalAffordances") or {}).get("openingExpansionTempo")
        or {}
    )
    value = finite_number(opening.get("ownTiles"))
    if value is not None:
        return value
    match = re.search(
        r"\bown=(\d+)\s+tiles\b", str(decision.get("observationSummary") or "")
    )
    return float(match.group(1)) if match else None


def tile_checkpoint(decisions: list[dict], ordinal: int) -> float | None:
    active = [
        decision
        for decision in decisions
        if decision.get("selectedActionKind") != "spawn"
    ]
    if len(active) < ordinal:
        return None
    return current_tiles(active[ordinal - 1])


def neutral_land(decision: dict) -> bool:
    metadata = decision.get("selectedActionMetadata") or {}
    return (
        decision.get("selectedActionKind") == "attack"
        and str(decision.get("selectedLegalActionId") or "").startswith(
            "expand:terra-nullius:"
        )
        and metadata.get("targetID") is None
        and canonical(metadata.get("targetName")) == "terra nullius"
        and metadata.get("expansion") is True
    )


def neutral_boat(decision: dict) -> bool:
    metadata = decision.get("selectedActionMetadata") or {}
    return (
        decision.get("selectedActionKind") == "boat"
        and metadata.get("targetID") is None
        and (
            metadata.get("expansion") is True
            or canonical(metadata.get("targetName")) == "terra nullius"
        )
    )


def scan_k1z_harm(
    decisions: list[dict], identity: dict[str, str]
) -> list[dict]:
    k1z_names = set(identity)
    k1z_ids = set(identity.values())
    harmful = []
    for decision in decisions:
        kind = decision.get("selectedActionKind")
        if kind not in HARMFUL_KINDS:
            continue
        if neutral_land(decision) or neutral_boat(decision):
            continue
        actor_name = canonical(decision.get("username"))
        actor_id = identity.get(actor_name)
        action_target_id = target_id(decision)
        target_name = canonical(
            (decision.get("selectedActionMetadata") or {}).get("targetName")
        )
        resolved_other_k1z = (
            action_target_id in k1z_ids and action_target_id != actor_id
        ) or (target_name in k1z_names and target_name != actor_name)
        unresolved_hostile = (
            kind in {
                "attack",
                "boat",
                "nuke",
                "embargo",
                "target_player",
                "break_alliance",
                "alliance_reject",
            }
            and action_target_id is None
            and target_name not in k1z_names
        )
        if kind == "embargo_all" or resolved_other_k1z or unresolved_hostile:
            harmful.append(
                {
                    "actor": decision.get("username"),
                    "turn": decision.get("turnNumber"),
                    "kind": kind,
                    "action_id": decision.get("selectedLegalActionId"),
                    "target_id": action_target_id,
                    "target_name": target_name or None,
                }
            )
    return harmful


def marker_scope_violations(decisions: list[dict]) -> list[dict]:
    violations = []
    active_ordinal = 0
    prior_neutral: list[dict] = []
    for decision_index, decision in enumerate(decisions):
        if decision.get("selectedActionKind") == "spawn":
            continue
        marker = has_marker(decision)
        if marker:
            reasons = []
            metadata = decision.get("selectedActionMetadata") or {}
            opening = (
                (decision.get("tacticalAffordances") or {}).get(
                    "openingExpansionTempo"
                )
                or {}
            )
            banking = (
                (decision.get("tacticalAffordances") or {}).get(
                    "transportTroopBanking"
                )
                or {}
            )
            percentage = finite_number(metadata.get("troopPercent"))
            share = finite_number(opening.get("ownTileShare"))
            tiles = current_tiles(decision)
            incoming_ratio = finite_number(opening.get("incomingThreatRatio"))
            incoming_troops = finite_number(banking.get("incomingThreatTroops"))
            accepted = (decision.get("result") or {}).get("accepted") is True
            if not accepted:
                reasons.append("marker action was not accepted")
            if not neutral_land(decision):
                reasons.append("marker was not on neutral-land attack")
            if percentage is None or not (0 < percentage <= 35):
                reasons.append("marker troopPercent was outside (0,35]")
            suffix = str(decision.get("selectedLegalActionId") or "").rsplit(":", 1)[-1]
            suffix_number = finite_number(suffix)
            if percentage is not None and suffix_number != percentage:
                reasons.append("action suffix and troopPercent differ")
            troop_fraction = finite_number(metadata.get("troopPercentage"))
            if percentage is not None and (
                troop_fraction is None or abs(troop_fraction * 100 - percentage) > 1e-9
            ):
                reasons.append("troopPercentage and troopPercent differ")
            legal_ids = decision.get("legalActionIDs") or []
            selected_id = decision.get("selectedLegalActionId")
            if selected_id not in legal_ids:
                reasons.append("marked action was not in legalActionIDs")
            legal_percentages = []
            for action_id in legal_ids:
                match = re.fullmatch(
                    r"expand:terra-nullius:([0-9]+(?:\.[0-9]+)?)",
                    str(action_id),
                )
                if match:
                    legal_percentage = finite_number(match.group(1))
                    if legal_percentage is not None and legal_percentage <= 35:
                        legal_percentages.append(legal_percentage)
            if (
                percentage is not None
                and legal_percentages
                and percentage != max(legal_percentages)
            ):
                reasons.append("marked action was not the largest legal percentage <=35")
            try:
                raw = json.loads(str(decision.get("rawLlmOutput") or ""))
            except json.JSONDecodeError:
                raw = None
            if (
                not isinstance(raw, dict)
                or raw.get("selectedLegalActionId") != selected_id
                or str(raw.get("reason") or "").lower().split(":")[-1] != "pg2"
            ):
                reasons.append("raw output and persisted PG2 selection disagree")
            if active_ordinal >= 20:
                reasons.append("marker appeared at or after non-spawn decision 20")
            if share is None or not (0 <= share < 0.12):
                reasons.append("marker tile share was absent or outside [0,0.12)")
            if tiles is None or tiles < 0:
                reasons.append("marker tile count was absent or negative")
            if incoming_ratio is None or incoming_ratio != 0:
                reasons.append("marker had nonzero or absent incoming threat ratio")
            if incoming_troops is None or incoming_troops != 0:
                reasons.append("marker had nonzero or absent incoming threat troops")
            recent_shares = []
            for prior in decisions[max(0, decision_index - 8) : decision_index]:
                prior_opening = (
                    (prior.get("tacticalAffordances") or {}).get(
                        "openingExpansionTempo"
                    )
                    or {}
                )
                prior_share = finite_number(prior_opening.get("ownTileShare"))
                if prior_share is not None:
                    recent_shares.append(prior_share)
            if len(recent_shares) >= 3 and share is not None:
                peak = max(recent_shares)
                if peak - share >= max(0.005, peak * 0.15):
                    reasons.append("marker appeared during sustained territory collapse")
            if len(prior_neutral) >= 2 and tiles is not None:
                older_tiles = current_tiles(prior_neutral[-2])
                if older_tiles is None or tiles <= older_tiles:
                    reasons.append("marker crossed a two-attack flat frontier")
            if reasons:
                violations.append(
                    {
                        "turn": decision.get("turnNumber"),
                        "action_id": decision.get("selectedLegalActionId"),
                        "reasons": reasons,
                    }
                )
        if neutral_land(decision):
            prior_neutral.append(decision)
        active_ordinal += 1
    return violations


def audit_arm(run_dir: Path, expected_spec: Path, role: str) -> dict:
    required = ["config.json", "receipt.json", "results.json", "replay"]
    for name in required:
        if not (run_dir / name).is_file():
            raise ValueError(f"{run_dir}: missing {name}")
    spec = read_json(expected_spec)
    config = read_json(run_dir / "config.json")
    receipt = read_json(run_dir / "receipt.json")
    results = read_json(run_dir / "results.json")
    decisions = load_decisions(run_dir)
    odin = [
        decision
        for decision in decisions
        if canonical(decision.get("username")) == "k1z odin free"
    ]
    if not odin:
        raise ValueError(f"{run_dir}: no K1Z odin free decisions")

    violations = []
    control_anomalies = []
    spec_hash = sha256(expected_spec)
    if config != spec:
        violations.append("effective config differs from expected spec")
    if sha256(run_dir / "config.json") != spec_hash:
        violations.append("effective config hash differs from expected spec hash")
    if receipt.get("status") != "passed":
        violations.append("transport receipt did not pass")
    if receipt.get("execution_class") != "formal_evaluation":
        violations.append("receipt execution class drifted")
    if receipt.get("receipt_scope") != "transport_and_artifact_integrity_only":
        violations.append("receipt scope drifted")
    if (receipt.get("bundle_verification") or {}).get("status") != "verified":
        violations.append("bundle verification was not verified")
    if (receipt.get("runtime_fingerprint") or {}).get("status") != "verified":
        violations.append("runtime fingerprint was not verified")
    if (receipt.get("post_run_attestation") or {}).get("status") != "stable":
        violations.append("post-run attestation was not stable")
    if (receipt.get("run_spec") or {}).get("sha256") != spec_hash:
        violations.append("receipt run-spec hash differs from expected spec")
    if receipt.get("base_image") != EXPECTED_BASE_IMAGE:
        violations.append("approved game base image drifted")
    if (
        (receipt.get("runtime_fingerprint") or {}).get("fingerprint_sha256")
        != EXPECTED_RUNTIME_FINGERPRINT
    ):
        violations.append("approved runtime fingerprint drifted")
    if receipt.get("orchestrator_sha256") != EXPECTED_ORCHESTRATOR_SHA:
        violations.append("approved episode orchestrator drifted")
    if (receipt.get("plan") or {}).get("game_config") != spec.get("game_config"):
        violations.append("receipt game plan differs from expected spec")
    if receipt.get("results") != results:
        violations.append("receipt results differ from results.json")
    primary = receipt.get("primary_artifact_hashes") or {}
    for name in ("results.json", "replay"):
        target = run_dir / name
        recorded = primary.get(name) or {}
        if recorded.get("sha256") != sha256(target):
            violations.append(f"receipt {name} hash differs from local artifact")
        if recorded.get("bytes") != target.stat().st_size:
            violations.append(f"receipt {name} byte count differs from local artifact")
    receipt_players = [
        player.get("name") for player in (receipt.get("plan") or {}).get("players", [])
    ]
    if receipt_players != EXPECTED_ROSTER:
        violations.append("receipt roster drifted")
    result_players = [player.get("name") for player in results.get("players", [])]
    if result_players != EXPECTED_ROSTER:
        violations.append("results roster drifted")
    if [player.get("name") for player in spec.get("players", [])] != EXPECTED_ROSTER:
        violations.append("expected spec roster drifted")
    expected_policy = "qd1n-pg2" if role == "candidate" else "qd1n-v89"
    if (spec.get("players") or [{}])[0].get("policy") != expected_policy:
        violations.append(f"{role} Odin policy was not {expected_policy}")
    source = (receipt.get("bundle_verification") or {}).get("source") or {}
    if (
        source.get("formal_specs_commit")
        != "42e9a18193d2fb381f1f0fa6de0e64cb58e3a2f9"
    ):
        violations.append("approved PG2 formal-spec source identity drifted")
    policies = (receipt.get("bundle_verification") or {}).get("policies") or []
    policy_images = {
        item.get("key"): item.get("image_id")
        for item in policies
        if item.get("architecture") == "amd64"
    }
    if policy_images != EXPECTED_POLICY_IMAGES[role]:
        violations.append(f"{role} embedded policy image identities drifted")

    ids = player_ids(decisions)
    if len(ids) != 4 or len(set(ids.values())) != 4:
        violations.append("K1Z player identity map was incomplete or non-unique")
    ally_names = {canonical(name) for name in EXPECTED_ROSTER[1:]}
    ally_ids = {ids[name] for name in ally_names if name in ids}
    harmful = []
    for decision in odin:
        if decision.get("selectedActionKind") not in HARMFUL_KINDS:
            continue
        action_target_id = target_id(decision)
        target_name = canonical(
            (decision.get("selectedActionMetadata") or {}).get("targetName")
        )
        if (
            decision.get("selectedActionKind") == "embargo_all"
            or action_target_id in ally_ids
            or target_name in ally_names
        ):
            harmful.append(
                {
                    "turn": decision.get("turnNumber"),
                    "kind": decision.get("selectedActionKind"),
                    "action_id": decision.get("selectedLegalActionId"),
                    "target_id": action_target_id,
                    "target_name": target_name or None,
                }
            )
    rejected = [
        {
            "turn": decision.get("turnNumber"),
            "action_id": decision.get("selectedLegalActionId"),
            "reason": (decision.get("result") or {}).get("reason"),
        }
        for decision in odin
        if (decision.get("result") or {}).get("accepted") is not True
    ]
    holds = classify_holds(odin, ally_ids)
    marker_violations = marker_scope_violations(odin) if role == "candidate" else []
    marker_count = sum(has_marker(decision) for decision in odin)
    if role == "parent" and marker_count:
        violations.append("exact parent emitted a PG2 marker")
    def behavioral_violation(message: str) -> None:
        if role == "parent":
            control_anomalies.append(message)
        else:
            violations.append(message)

    if harmful:
        behavioral_violation("Odin selected a harmful K1Z action")
    if rejected:
        behavioral_violation("Odin had a rejected or unconfirmed decision")
    if holds:
        behavioral_violation("Odin had an unexplained hold")
    if marker_violations:
        violations.append("PG2 marker appeared outside its guard")
    all_rejected = [
        decision
        for decision in decisions
        if (decision.get("result") or {}).get("accepted") is not True
    ]
    if all_rejected:
        behavioral_violation("the all-K1Z run contained a rejected decision")
    global_harm = scan_k1z_harm(decisions, ids)
    if global_harm:
        behavioral_violation("the all-K1Z run contained a harmful coalition action")
    if results.get("decision_count") != len(decisions):
        violations.append("results decision_count differs from decisions.jsonl")
    accepted_count = sum(
        (decision.get("result") or {}).get("accepted") is True
        for decision in decisions
    )
    if results.get("accepted_decision_count") != accepted_count:
        violations.append("results accepted_decision_count differs from decisions.jsonl")

    odin_result = next(
        (
            player
            for player in results.get("players", [])
            if canonical(player.get("name")) == "k1z odin free"
        ),
        {},
    )
    return {
        "role": role,
        "directory": str(run_dir),
        "spec_sha256": spec_hash,
        "receipt_sha256": sha256(run_dir / "receipt.json"),
        "results_sha256": sha256(run_dir / "results.json"),
        "replay_sha256": sha256(run_dir / "replay"),
        "game_id": results.get("game_id"),
        "base_image": receipt.get("base_image"),
        "runtime_fingerprint_sha256": (
            receipt.get("runtime_fingerprint") or {}
        ).get("fingerprint_sha256"),
        "bundle_source_commit": source.get("commit"),
        "map": spec.get("game_config", {}).get("map"),
        "seed": spec.get("game_config", {}).get("seed"),
        "marker_count": marker_count,
        "decision_count": len(odin),
        "fallback_count": sum(
            decision.get("fallbackUsed") is True for decision in odin
        ),
        "result_fallback_count": results.get("fallback_count"),
        "rejected_decisions": rejected,
        "unexplained_holds": holds,
        "k1z_harmful_actions": harmful,
        "all_k1z_harmful_actions": global_harm,
        "marker_scope_violations": marker_violations,
        "control_anomalies": control_anomalies,
        "tile_at_decision_20": tile_checkpoint(odin, 20),
        "tile_at_decision_50": tile_checkpoint(odin, 50),
        "final_score": odin_result.get("score"),
        "final_tiles": odin_result.get("tiles_owned"),
        "declared_win": results.get("winner_slot") == odin_result.get("slot"),
        "violations": violations,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--parent", type=Path, required=True)
    parser.add_argument("--candidate-spec", type=Path, required=True)
    parser.add_argument("--parent-spec", type=Path, required=True)
    parser.add_argument("--matrix-manifest", type=Path, required=True)
    parser.add_argument("--matrix-commit", required=True)
    parser.add_argument("--lane", choices=list("abcd"), required=True)
    parser.add_argument("--wave", type=int, choices=range(1, 7), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    report: dict = {
        "schema_version": 1,
        "arm": "pg2",
        "lane": args.lane,
        "wave": args.wave,
        "verdict": "STOP",
        "violations": [],
        "control_anomalies": [],
    }
    try:
        matrix = read_json(args.matrix_manifest)
        candidate_spec = read_json(args.candidate_spec)
        parent_spec = read_json(args.parent_spec)
        game = candidate_spec.get("game_config", {})
        assignment = next(
            (
                item
                for item in matrix.get("assignments", [])
                if item.get("lane") == args.lane
                and item.get("wave") == args.wave
            ),
            None,
        )
        if assignment is None:
            raise ValueError("matrix assignment is missing")
        if not re.fullmatch(r"[a-f0-9]{40}", args.matrix_commit):
            raise ValueError("matrix commit is not a full Git object ID")
        expected = {
            "map": game.get("map"),
            "seed": game.get("seed"),
            "candidate_sha256": sha256(args.candidate_spec),
            "parent_sha256": sha256(args.parent_spec),
        }
        for key, value in expected.items():
            if assignment.get(key) != value:
                report["violations"].append(
                    f"matrix assignment {key} drifted: {assignment.get(key)!r} != {value!r}"
                )
        candidate = audit_arm(
            args.candidate, args.candidate_spec, role="candidate"
        )
        parent = audit_arm(args.parent, args.parent_spec, role="parent")
        report.update(
            {
                "pair": assignment.get("pair"),
                "map": assignment.get("map"),
                "seed": assignment.get("seed"),
                "matrix_manifest_sha256": sha256(args.matrix_manifest),
                "candidate": candidate,
                "parent": parent,
                "control_anomalies": parent["control_anomalies"],
                "paired_deltas": {
                    "fallback_count": (
                        candidate["fallback_count"] - parent["fallback_count"]
                    ),
                    "tile_at_decision_20": (
                        candidate["tile_at_decision_20"]
                        - parent["tile_at_decision_20"]
                        if candidate["tile_at_decision_20"] is not None
                        and parent["tile_at_decision_20"] is not None
                        else None
                    ),
                    "tile_at_decision_50": (
                        candidate["tile_at_decision_50"]
                        - parent["tile_at_decision_50"]
                        if candidate["tile_at_decision_50"] is not None
                        and parent["tile_at_decision_50"] is not None
                        else None
                    ),
                    "final_score": (
                        candidate["final_score"] - parent["final_score"]
                        if candidate["final_score"] is not None
                        and parent["final_score"] is not None
                        else None
                    ),
                    "final_tiles": (
                        candidate["final_tiles"] - parent["final_tiles"]
                        if candidate["final_tiles"] is not None
                        and parent["final_tiles"] is not None
                        else None
                    ),
                },
            }
        )
        report["violations"].extend(candidate["violations"])
        report["violations"].extend(parent["violations"])
        pair = assignment.get("pair")
        output_root = args.candidate.parent.parent
        if args.parent.parent.parent != output_root:
            report["violations"].append("candidate and parent output roots differ")
        evidence_dir = output_root / "evidence" / str(pair)
        run_hashes = evidence_dir / "run-artifacts.sha256"
        evidence_hashes = evidence_dir / "evidence.sha256"
        if not run_hashes.is_file() or not evidence_hashes.is_file():
            report["violations"].append("pair evidence hash manifests are missing")
        else:
            report["violations"].extend(
                verify_hash_manifest(output_root, run_hashes)
            )
            report["violations"].extend(
                verify_hash_manifest(evidence_dir, evidence_hashes)
            )
        derived_manifest_path = evidence_dir / "manifest.json"
        if not derived_manifest_path.is_file():
            report["violations"].append("derived bundle manifest is missing")
        else:
            derived_manifest = read_json(derived_manifest_path)
            derivation = derived_manifest.get("matrix_derivation") or {}
            expected_derivation = {
                "generator_commit": args.matrix_commit,
                "matrix_manifest_sha256": sha256(args.matrix_manifest),
                "lane": args.lane,
                "wave": args.wave,
                "pair": pair,
                "map": assignment.get("map"),
                "seed": assignment.get("seed"),
                "candidate_spec_sha256": sha256(args.candidate_spec),
                "parent_spec_sha256": sha256(args.parent_spec),
            }
            for key, value in expected_derivation.items():
                if derivation.get(key) != value:
                    report["violations"].append(
                        f"derived manifest {key} drifted"
                    )
            derived_sha = sha256(derived_manifest_path)
            for role, arm in (("candidate", candidate), ("parent", parent)):
                receipt = read_json(Path(arm["directory"]) / "receipt.json")
                receipt_manifest_sha = (
                    receipt.get("bundle_verification") or {}
                ).get("manifest_sha256")
                if receipt_manifest_sha != derived_sha:
                    report["violations"].append(
                        f"{role} receipt manifest hash differs from evidence"
                    )
        if candidate["game_id"] != parent["game_id"]:
            report["violations"].append("candidate and parent game IDs differ")
        if candidate["map"] != parent["map"] or candidate["seed"] != parent["seed"]:
            report["violations"].append("candidate and parent map/seed differ")
        normalized_candidate = copy.deepcopy(candidate_spec)
        normalized_parent = copy.deepcopy(parent_spec)
        for normalized in (normalized_candidate, normalized_parent):
            normalized["players"][0]["policy"] = "<ODIN_ARM>"
            normalized["players"][0]["cwd"] = "<ODIN_ARM_CWD>"
        if normalized_candidate != normalized_parent:
            report["violations"].append(
                "candidate and parent configs differ beyond Odin policy/cwd"
            )
        for identity in (
            "base_image",
            "runtime_fingerprint_sha256",
            "bundle_source_commit",
        ):
            if candidate.get(identity) != parent.get(identity):
                report["violations"].append(
                    f"candidate and parent {identity} differ"
                )
        candidate_odin = [
            decision
            for decision in load_decisions(args.candidate)
            if canonical(decision.get("username")) == "k1z odin free"
        ]
        parent_odin = [
            decision
            for decision in load_decisions(args.parent)
            if canonical(decision.get("username")) == "k1z odin free"
        ]
        first_marker = next(
            (
                index
                for index, decision in enumerate(candidate_odin)
                if has_marker(decision)
            ),
            None,
        )
        if first_marker is not None:
            if len(parent_odin) < first_marker:
                report["violations"].append(
                    "parent trace ended before first PG2 intervention"
                )
            else:
                fields = (
                    "turnNumber",
                    "selectedActionKind",
                    "selectedLegalActionId",
                    "reason",
                )
                for index in range(first_marker):
                    left = {field: candidate_odin[index].get(field) for field in fields}
                    right = {field: parent_odin[index].get(field) for field in fields}
                    if left != right:
                        report["violations"].append(
                            f"candidate/parent trace diverged before PG2 at ordinal {index}"
                        )
                        break
        if first_marker is not None:
            index = first_marker
            decision = candidate_odin[index]
            if index >= len(parent_odin):
                report["violations"].append(
                    f"parent trace lacks candidate marker ordinal {index}"
                )
            else:
                parent_decision = parent_odin[index]
                candidate_percent = finite_number(
                    (decision.get("selectedActionMetadata") or {}).get(
                        "troopPercent"
                    )
                )
                parent_percent = finite_number(
                    (parent_decision.get("selectedActionMetadata") or {}).get(
                        "troopPercent"
                    )
                )
                if not neutral_land(parent_decision):
                    report["violations"].append(
                        f"parent action at first PG2 ordinal {index} was not neutral land"
                    )
                elif (
                    candidate_percent is None
                    or parent_percent is None
                    or parent_percent >= candidate_percent
                ):
                    report["violations"].append(
                        f"PG2 did not strictly raise the first neutral commitment at ordinal {index}"
                    )
        candidate_receipt = read_json(args.candidate / "receipt.json")
        parent_receipt = read_json(args.parent / "receipt.json")
        try:
            candidate_started = dt.datetime.fromisoformat(
                candidate_receipt["started_at"].replace("Z", "+00:00")
            )
            candidate_finished = dt.datetime.fromisoformat(
                candidate_receipt["finished_at"].replace("Z", "+00:00")
            )
            parent_started = dt.datetime.fromisoformat(
                parent_receipt["started_at"].replace("Z", "+00:00")
            )
            parent_finished = dt.datetime.fromisoformat(
                parent_receipt["finished_at"].replace("Z", "+00:00")
            )
            if not (
                candidate_finished <= parent_started
                or parent_finished <= candidate_started
            ):
                report["violations"].append(
                    "candidate and parent execution intervals overlapped"
                )
        except (KeyError, TypeError, ValueError):
            report["violations"].append("receipt execution timestamps were invalid")
        if not report["violations"]:
            report["verdict"] = (
                "REPLAY_REQUIRED" if report["control_anomalies"] else "CONTINUE"
            )
    except Exception as error:  # fail closed and retain the reason in the artifact
        report["violations"].append(f"{type(error).__name__}: {error}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(
        f"PG2_PAIR_AUDIT={report['verdict']} "
        f"lane={args.lane} wave={args.wave} "
        f"violations={len(report['violations'])} "
        f"control_anomalies={len(report['control_anomalies'])}"
    )
    return 0 if report["verdict"] in {"CONTINUE", "REPLAY_REQUIRED"} else 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Fail-closed audit for one seeded ODC1 candidate/parent A/B screen."""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import math
import re
import sys
import unicodedata
from pathlib import Path


HARMFUL_KINDS = {
    "attack",
    "boat",
    "nuke",
    "warship",
    "move_warship",
    "embargo",
    "embargo_all",
    "target_player",
    "break_alliance",
}
TACTICAL_KINDS = {
    "attack",
    "boat",
    "boat_retreat",
    "build",
    "nuke",
    "retreat",
    "upgrade_structure",
    "warship",
    "move_warship",
}
NUCLEAR_UNITS = {"atom bomb", "hydrogen bomb", "mirv"}
TARGET_PREFIX = re.compile(
    r"^(?:attack|boat|nuke|warship|move_warship|target_player|target|embargo|"
    r"break_alliance|alliance):([^:]+)"
)
SHA256_ID = re.compile(r"sha256:[0-9a-f]{64}")
COMMIT_ID = re.compile(r"[0-9a-f]{40}")


def load(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path}: expected a JSON object")
    return value


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def canonical(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).lower()
    text = re.sub(r"[_-]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def coalition_name(value: object) -> str:
    text = canonical(value)
    return text[4:] if text.startswith("k1z ") else text


def finite(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def read_decisions(root: Path) -> tuple[Path, list[dict]]:
    found = sorted(root.glob("proxywar-runs/coworld-*/decisions.jsonl"))
    if len(found) != 1:
        raise ValueError(
            f"{root}: expected exactly one decisions.jsonl, found {len(found)}"
        )
    rows = []
    with found[0].open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"{found[0]}:{line_number}: {error}") from error
            if not isinstance(row, dict):
                raise ValueError(f"{found[0]}:{line_number}: expected an object")
            rows.append(row)
    return found[0], rows


def marker_values(row: dict) -> set[str]:
    values = set()
    if row.get("policyMarker"):
        values.add(canonical(row["policyMarker"]))
    stacked = row.get("policyMarkers")
    if isinstance(stacked, list):
        values.update(canonical(value) for value in stacked if value)
    elif stacked:
        values.add(canonical(stacked))
    reason = canonical(row.get("reason"))
    if reason:
        values.add(reason.rsplit(":", 1)[-1])
    return values


def marked_row_count(rows: list[dict], markers: set[str]) -> int:
    return sum(bool(marker_values(row) & markers) for row in rows)


def accepted(row: dict) -> bool:
    return (row.get("result") or {}).get("accepted") is True


def planner_degraded(row: dict) -> bool:
    for key in (
        "llmPlannerDegraded",
        "plannerDegraded",
        "degraded",
        "degradationReason",
    ):
        if row.get(key) not in (None, False, 0, "", []):
            return True
    planner = row.get("planner") or row.get("plannerTelemetry") or {}
    return any(
        planner.get(key) not in (None, False, 0, "", [])
        for key in ("llmPlannerDegraded", "degraded", "degradationReason")
    )


def action_metadata(row: dict) -> tuple[dict, dict]:
    metadata = row.get("selectedActionMetadata") or {}
    submitted = (row.get("result") or {}).get("submittedIntent") or {}
    return (
        metadata if isinstance(metadata, dict) else {},
        submitted if isinstance(submitted, dict) else {},
    )


def target_id(row: dict) -> str | None:
    metadata, submitted = action_metadata(row)
    nested = metadata.get("target") if isinstance(metadata.get("target"), dict) else {}
    direct = (
        metadata.get("targetID")
        or metadata.get("recipientID")
        or metadata.get("playerID")
        or nested.get("id")
        or submitted.get("targetID")
        or submitted.get("recipientID")
    )
    if direct:
        return str(direct).lower()
    match = TARGET_PREFIX.match(str(row.get("selectedLegalActionId") or ""))
    return match.group(1).lower() if match else None


def target_name(row: dict) -> str:
    metadata, submitted = action_metadata(row)
    nested = metadata.get("target") if isinstance(metadata.get("target"), dict) else {}
    return coalition_name(
        metadata.get("targetName")
        or metadata.get("recipientName")
        or nested.get("name")
        or submitted.get("targetName")
        or submitted.get("recipientName")
    )


def harmful_kind(row: dict) -> str | None:
    kind = canonical(row.get("selectedActionKind")).replace(" ", "_")
    metadata, submitted = action_metadata(row)
    nuclear_values = (
        metadata.get("unit"),
        metadata.get("unitType"),
        metadata.get("weapon"),
        submitted.get("unit"),
        submitted.get("unitType"),
        submitted.get("weapon"),
    )
    label = canonical(
        metadata.get("label")
        or submitted.get("label")
        or row.get("selectedLegalActionId")
    )
    if (
        kind == "nuke"
        or any(canonical(value) in NUCLEAR_UNITS for value in nuclear_values)
        or any(unit in label for unit in NUCLEAR_UNITS)
    ):
        return "nuke"
    return kind if kind in HARMFUL_KINDS else None


def neutral_expansion(row: dict) -> bool:
    metadata, _ = action_metadata(row)
    return harmful_kind(row) in {"attack", "boat"} and (
        metadata.get("expansion") is True
        or coalition_name(metadata.get("targetName")) == "terra nullius"
        or str(row.get("selectedLegalActionId") or "").startswith(
            "expand:terra-nullius:"
        )
    )


def build_identity_registry(
    contract: dict, rows: list[dict]
) -> tuple[dict[str, dict[str, set[str]]], list[str]]:
    identities = (contract.get("coalition") or {}).get("identities")
    if not isinstance(identities, list) or len(identities) < 2:
        return {}, ["coalition.identities must configure Odin and at least one partner"]
    registry = {}
    errors = []
    for identity in identities:
        if not isinstance(identity, dict):
            errors.append("coalition identity entry is not an object")
            continue
        role = canonical(identity.get("role")).replace(" ", "_")
        if not role or role in registry:
            errors.append("coalition identity role is missing or duplicated")
            continue
        raw_names = identity.get("names") or []
        raw_names = [raw_names] if isinstance(raw_names, str) else raw_names
        raw_ids = identity.get("player_ids") or []
        raw_ids = [raw_ids] if isinstance(raw_ids, str) else raw_ids
        if identity.get("player_id"):
            raw_ids = [*raw_ids, identity["player_id"]]
        names = {coalition_name(value) for value in raw_names if coalition_name(value)}
        if not names:
            errors.append(f"coalition identity {role} has no names")
        registry[role] = {
            "names": names,
            "ids": {str(value).lower() for value in raw_ids if value},
        }

    for field in ("names", "ids"):
        owners = collections.defaultdict(list)
        for role, identity in registry.items():
            for value in identity[field]:
                owners[value].append(role)
        for value, roles in sorted(owners.items()):
            if len(roles) > 1:
                errors.append(
                    f"coalition {field[:-1]} alias {value!r} is shared by "
                    f"{', '.join(sorted(roles))}"
                )

    for row in rows:
        name = coalition_name(row.get("username"))
        audit = row.get("auditBefore") or row.get("auditAfter") or {}
        runtime_id = audit.get("playerID") if isinstance(audit, dict) else None
        roles = [
            role for role, identity in registry.items() if name in identity["names"]
        ]
        if runtime_id and len(roles) == 1:
            registry[roles[0]]["ids"].add(str(runtime_id).lower())
    return registry, errors


def role_for_name(value: object, registry: dict) -> str | None:
    name = coalition_name(value)
    roles = [role for role, identity in registry.items() if name in identity["names"]]
    return roles[0] if len(roles) == 1 else None


def role_for_id(value: object, registry: dict) -> str | None:
    if not value:
        return None
    identifier = str(value).lower()
    roles = [role for role, identity in registry.items() if identifier in identity["ids"]]
    return roles[0] if len(roles) == 1 else None


def coalition_presence(
    contract: dict, rows: list[dict], results: dict, registry: dict
) -> tuple[set[str], list[str]]:
    names = {
        coalition_name(row.get("username")) for row in rows if row.get("username")
    }
    names.update(
        coalition_name(player.get("name"))
        for player in results.get("players", [])
        if isinstance(player, dict) and player.get("name")
    )
    present = {
        role for role, identity in registry.items() if names & identity["names"]
    }
    coalition = contract.get("coalition") or {}
    raw_required = coalition.get("required_present_roles") or []
    raw_required = [raw_required] if isinstance(raw_required, str) else raw_required
    required = {
        canonical(role).replace(" ", "_") for role in raw_required if canonical(role)
    }
    errors = []
    if coalition.get("require_presence") is True and not required:
        errors.append(
            "coalition presence is required but required_present_roles is empty"
        )
    unknown = sorted(required - set(registry))
    absent = sorted(required - present)
    if unknown:
        errors.append(f"unknown required coalition roles: {', '.join(unknown)}")
    if absent:
        errors.append(f"required coalition roles absent: {', '.join(absent)}")
    return present, errors


def endgame_exception(
    row: dict,
    kind: str,
    target_role: str | None,
    actor_role: str,
    registry: dict,
    contract: dict,
) -> tuple[bool, str]:
    config = (contract.get("coalition") or {}).get("endgame_exception") or {}
    if config.get("enabled") is not True:
        return False, "endgame exception disabled"
    marker = canonical(config.get("marker"))
    if not marker or marker not in marker_values(row):
        return False, "endgame marker absent"
    allowed = {
        canonical(value).replace(" ", "_")
        for value in config.get("allowed_kinds", [])
    }
    if kind not in allowed:
        return False, "action kind is not endgame-allowed"
    field = str(config.get("evidence_field") or "k1zOnlyEndgame")
    evidence = row.get(field)
    if evidence is None:
        evidence = (row.get("tacticalAffordances") or {}).get(field)
    if not isinstance(evidence, dict):
        return False, f"{field} evidence absent"
    if evidence.get("allSurvivingRivalsK1Z") is not True:
        return False, "all-survivors assertion absent"
    survivors = evidence.get("survivingRivals")
    if not isinstance(survivors, list) or not survivors:
        return False, "surviving-rival evidence absent"
    survivor_roles = set()
    for survivor in survivors:
        if isinstance(survivor, dict):
            by_id = role_for_id(survivor.get("id"), registry)
            by_name = role_for_name(survivor.get("name"), registry)
            if by_id and by_name and by_id != by_name:
                return False, "surviving-rival identity conflict"
            role = by_id or by_name
        else:
            role = role_for_id(survivor, registry) or role_for_name(
                survivor, registry
            )
        if role is None or role == actor_role:
            return False, "surviving rival is not a configured K1Z partner"
        survivor_roles.add(role)
    if target_role is None or target_role not in survivor_roles:
        return False, "selected target is not a proven surviving K1Z rival"
    return True, "contract endgame exception"


def scan_candidate_harm(
    rows: list[dict], contract: dict, registry: dict
) -> tuple[list[dict], list[dict], list[dict]]:
    actor_role = canonical(
        (contract.get("coalition") or {}).get("actor_role") or "odin"
    ).replace(" ", "_")
    harmful, exemptions, unresolved = [], [], []
    for row in rows:
        kind = harmful_kind(row)
        if kind is None:
            continue
        by_id = role_for_id(target_id(row), registry)
        by_name = role_for_name(target_name(row), registry)
        if neutral_expansion(row) and by_id is None and by_name is None:
            continue
        if kind == "embargo_all":
            harmful.append(
                {
                    "turn": row.get("turnNumber"),
                    "kind": kind,
                    "action_id": row.get("selectedLegalActionId"),
                    "reason": "global embargo reaches configured coalition partners",
                }
            )
            continue
        if by_id and by_name and by_id != by_name:
            unresolved.append(
                {
                    "turn": row.get("turnNumber"),
                    "kind": kind,
                    "action_id": row.get("selectedLegalActionId"),
                    "reason": "target ID and name resolve to different K1Z roles",
                }
            )
            continue
        target = by_id or by_name
        if target is None:
            if target_id(row) is None and not target_name(row):
                unresolved.append(
                    {
                        "turn": row.get("turnNumber"),
                        "kind": kind,
                        "action_id": row.get("selectedLegalActionId"),
                    }
                )
            continue
        if target == actor_role:
            continue
        allowed, reason = endgame_exception(
            row, kind, target, actor_role, registry, contract
        )
        record = {
            "turn": row.get("turnNumber"),
            "kind": kind,
            "action_id": row.get("selectedLegalActionId"),
            "target_id": target_id(row),
            "target_name": target_name(row) or None,
            "target_role": target,
            "reason": reason,
        }
        (exemptions if allowed else harmful).append(record)
    return harmful, exemptions, unresolved


def target_role_from_action_id(action_id: object, registry: dict) -> str | None:
    match = TARGET_PREFIX.match(str(action_id or ""))
    return role_for_id(match.group(1), registry) if match else None


def unexplained_hold(row: dict, registry: dict, actor_role: str) -> dict | None:
    if row.get("selectedActionKind") != "hold" or "odguard" in marker_values(row):
        return None
    legal = row.get("legalActionIDsByKind")
    if not isinstance(legal, dict):
        return {
            "turn": row.get("turnNumber"),
            "reason": row.get("reason"),
            "proof_gap": "legalActionIDsByKind missing",
        }
    actionable = []
    for kind in TACTICAL_KINDS:
        for action_id in legal.get(kind, []) or []:
            role = target_role_from_action_id(action_id, registry)
            if role and role != actor_role and kind in HARMFUL_KINDS:
                continue
            if kind == "build" and "defense post" in canonical(action_id):
                continue
            actionable.append({"kind": kind, "id": action_id})
    if not actionable:
        return None
    return {
        "turn": row.get("turnNumber"),
        "reason": row.get("reason"),
        "actionable": actionable,
    }


def validate_job(job: dict, contract: dict, orientation: str) -> list[str]:
    errors = []
    expected = contract.get("game_config") or {}
    config = job.get("game_config") or {}
    for key, value in expected.items():
        if config.get(key) != value:
            errors.append(f"job {orientation} game_config.{key} mismatch")
    if config.get("tokens") is not None:
        errors.append(f"job {orientation} must contain token placeholder null")
    slots = (contract.get("orientations") or {}).get(orientation) or {}
    names = [entry.get("name") for entry in config.get("players", [])]
    images = [entry.get("image") for entry in job.get("players", [])]
    for role in ("candidate", "parent"):
        slot = slots.get(f"{role}_slot")
        definition = contract.get(role) or {}
        if not isinstance(slot, int) or slot < 0:
            errors.append(f"job {orientation} {role}_slot is invalid")
        elif (
            slot >= len(names)
            or canonical(names[slot]) != canonical(definition.get("name"))
            or slot >= len(images)
            or images[slot] != definition.get("image")
        ):
            errors.append(f"job {orientation} {role} identity/slot mismatch")
    tags = job.get("episode_tags") or {}
    if tags.get("pair_id") != contract.get("pair_id"):
        errors.append(f"job {orientation} pair_id mismatch")
    if tags.get("orientation") != orientation:
        errors.append(f"job {orientation} orientation tag mismatch")
    return errors


def verify_resolved_images(
    path: Path | None, contract: dict
) -> tuple[dict | None, list[str]]:
    if path is None:
        errors = (
            ["resolved image identities are required but absent"]
            if contract.get("require_resolved_image_ids") is True
            else []
        )
        return None, errors
    document = load(path)
    errors, recorded = [], {}
    for role in ("candidate", "parent"):
        entry = document.get(role)
        entry = {"image_id": entry} if isinstance(entry, str) else entry
        if not isinstance(entry, dict):
            errors.append(f"resolved image entry {role} is absent")
            continue
        image_id = entry.get("image_id") or entry.get("id")
        tag = entry.get("image") or entry.get("tag")
        expected = contract.get(role) or {}
        if image_id != expected.get("image_id"):
            errors.append(f"resolved {role} image ID mismatched")
        if tag is not None and tag != expected.get("image"):
            errors.append(f"resolved {role} image tag mismatched")
        recorded[role] = {"image": tag, "image_id": image_id}
    return {
        "path": str(path),
        "sha256": digest(path),
        "images": recorded,
    }, errors


def orientation_advantage(
    candidate: dict, parent: dict, orientation: str
) -> tuple[dict, list[str]]:
    score_delta = (
        candidate.get("score") - parent.get("score")
        if finite(candidate.get("score")) and finite(parent.get("score"))
        else None
    )
    tile_delta = (
        candidate.get("tiles_owned") - parent.get("tiles_owned")
        if type(candidate.get("tiles_owned")) is int
        and type(parent.get("tiles_owned")) is int
        else None
    )
    errors = []
    if score_delta is None or score_delta <= 0:
        errors.append(
            f"candidate score advantage was not positive in orientation {orientation}"
        )
    if tile_delta is None or tile_delta <= 0:
        errors.append(
            f"candidate tile advantage was not positive in orientation {orientation}"
        )
    return {"score_delta": score_delta, "tile_delta": tile_delta}, errors


def contract_path(contract_path: Path, value: object) -> Path:
    path = Path(str(value or ""))
    return path if path.is_absolute() else contract_path.parent / path


def validate_differential_proof(
    contract: dict, path_to_contract: Path
) -> tuple[list[str], dict]:
    config = contract.get("differential_unit_proof") or {}
    if not config.get("path"):
        return ["differential unit proof path is not pinned"], {}
    path = contract_path(path_to_contract, config["path"])
    if not path.is_file():
        return ["differential unit proof file is missing"], {}
    errors = []
    if digest(path) != config.get("sha256"):
        errors.append("differential unit proof SHA-256 mismatched")
    proof = load(path)
    parent, candidate = proof.get("parent") or {}, proof.get("candidate") or {}
    if proof.get("arm") != contract.get("arm"):
        errors.append("differential unit proof arm mismatched")
    if parent.get("source_commit") != (contract.get("parent") or {}).get(
        "source_commit"
    ):
        errors.append("differential unit proof parent commit mismatched")
    if candidate.get("source_commit") != (contract.get("candidate") or {}).get(
        "source_commit"
    ):
        errors.append("differential unit proof candidate commit mismatched")
    if (
        not parent.get("selected_action_id")
        or not candidate.get("selected_action_id")
        or parent.get("selected_action_id") == candidate.get("selected_action_id")
    ):
        errors.append("differential unit proof lacks distinct selected actions")
    if proof.get("same_fixture") is not True or proof.get("test_exit_code") != 0:
        errors.append("differential unit proof did not pass the same fixture")
    return errors, proof


def audit_run(
    root: Path,
    job_path: Path,
    contract: dict,
    orientation: str,
    resolved_path: Path | None,
) -> dict:
    mechanism_only = contract.get("screen_mode") == "mechanism"
    violations = [
        f"missing {name}"
        for name in ("config.json", "results.json", "replay")
        if not (root / name).is_file()
    ]
    if violations:
        return {
            "orientation": orientation,
            "directory": str(root),
            "violations": violations,
        }
    job, config, results = load(job_path), load(root / "config.json"), load(
        root / "results.json"
    )
    violations.extend(validate_job(job, contract, orientation))
    decision_file, rows = read_decisions(root)
    for key, value in (contract.get("game_config") or {}).items():
        if config.get(key) != value:
            violations.append(f"runtime config.{key} mismatch")
    if results.get("seed") != (contract.get("game_config") or {}).get("seed"):
        violations.append("results seed mismatch")
    if results.get("decision_count") != len(rows):
        violations.append("results decision_count mismatch")
    if results.get("accepted_decision_count") != sum(accepted(row) for row in rows):
        violations.append("results accepted_decision_count mismatch")

    registry, errors = build_identity_registry(contract, rows)
    violations.extend(errors)
    present, errors = coalition_presence(contract, rows, results, registry)
    violations.extend(errors)
    actor_role = canonical(
        (contract.get("coalition") or {}).get("actor_role") or "odin"
    ).replace(" ", "_")
    if actor_role not in registry:
        violations.append("coalition actor_role is not configured")

    candidate_name = canonical((contract.get("candidate") or {}).get("name"))
    parent_name = canonical((contract.get("parent") or {}).get("name"))
    if role_for_name(candidate_name, registry) != actor_role:
        violations.append("candidate identity does not resolve to coalition actor_role")
    candidate_rows = [
        row for row in rows if canonical(row.get("username")) == candidate_name
    ]
    parent_rows = [row for row in rows if canonical(row.get("username")) == parent_name]
    if not candidate_rows:
        violations.append("candidate decisions missing")
    if not parent_rows:
        violations.append("parent decisions missing")

    illegal = [
        row.get("turnNumber")
        for row in candidate_rows
        if not isinstance(row.get("legalActionIDs"), list)
        or row.get("selectedLegalActionId") not in row["legalActionIDs"]
    ]
    rejected = [
        row.get("turnNumber") for row in candidate_rows if not accepted(row)
    ]
    fallback = [
        row.get("turnNumber")
        for row in candidate_rows
        if row.get("fallbackUsed") is True
    ]
    degraded = [
        row.get("turnNumber") for row in candidate_rows if planner_degraded(row)
    ]
    parent_fallback = [
        row.get("turnNumber")
        for row in parent_rows
        if row.get("fallbackUsed") is True
    ]
    parent_degraded = [
        row.get("turnNumber") for row in parent_rows if planner_degraded(row)
    ]
    holds = [
        hold
        for row in candidate_rows
        if (hold := unexplained_hold(row, registry, actor_role)) is not None
    ]
    harm, endgame, unresolved = scan_candidate_harm(
        candidate_rows, contract, registry
    )
    required_conditions = [
        (illegal, "candidate selected an action absent from legalActionIDs"),
        (rejected, "candidate had rejected or unconfirmed decisions"),
        (fallback, "candidate used fallback behavior"),
        (degraded, "candidate planner degraded"),
        (holds, "candidate had an unexplained hold"),
        (harm, "candidate selected a harmful K1Z action"),
        (unresolved, "candidate harmful action target could not be resolved"),
    ]
    if not mechanism_only:
        required_conditions.extend(
            [
                (parent_fallback, "parent control used fallback behavior"),
                (parent_degraded, "parent control planner degraded"),
            ]
        )
    for condition, message in required_conditions:
        if condition:
            violations.append(message)

    candidate_config = contract.get("candidate") or {}
    allowed_markers = {canonical(value) for value in candidate_config.get("markers", [])}
    route_markers = {
        canonical(value)
        for value in (
            candidate_config.get("route_markers")
            or candidate_config.get("transition_markers")
            or []
        )
    }
    marker_counts = collections.Counter()
    route_count = post_opening = active_ordinal = 0
    for row in candidate_rows:
        if row.get("selectedActionKind") != "spawn":
            active_ordinal += 1
        found = marker_values(row) & allowed_markers
        marker_counts.update(found)
        if found & route_markers:
            route_count += 1
            post_opening += active_ordinal >= 20
    if not marker_counts:
        violations.append("candidate route markers had zero reach")
    if not route_count:
        violations.append("candidate route execution markers had zero reach")
    parent_marker_count = marked_row_count(parent_rows, route_markers)
    if parent_marker_count:
        violations.append("exact parent emitted ODC1 route markers")

    slots = (contract.get("orientations") or {}).get(orientation) or {}
    candidate_slot, parent_slot = slots.get("candidate_slot"), slots.get("parent_slot")
    by_slot = {player.get("slot"): player for player in results.get("players", [])}
    candidate_result, parent_result = by_slot.get(candidate_slot, {}), by_slot.get(
        parent_slot, {}
    )
    if canonical(candidate_result.get("name")) != candidate_name:
        violations.append("candidate result identity mismatch")
    if canonical(parent_result.get("name")) != parent_name:
        violations.append("parent result identity mismatch")
    advantage, errors = orientation_advantage(candidate_result, parent_result, orientation)
    if not mechanism_only:
        violations.extend(errors)
    resolved, errors = verify_resolved_images(resolved_path, contract)
    violations.extend(errors)

    return {
        "orientation": orientation,
        "directory": str(root),
        "job_sha256": digest(job_path),
        "config_sha256": digest(root / "config.json"),
        "results_sha256": digest(root / "results.json"),
        "replay_sha256": digest(root / "replay"),
        "decisions_sha256": digest(decision_file),
        "resolved_images": resolved,
        "game_id": results.get("game_id"),
        "seed": results.get("seed"),
        "coalition_roles_present": sorted(present),
        "candidate": {
            "slot": candidate_slot,
            "decision_count": len(candidate_rows),
            "accepted": sum(accepted(row) for row in candidate_rows),
            "illegal_turns": illegal,
            "rejected_turns": rejected,
            "fallback_turns": fallback,
            "degradation_turns": degraded,
            "unexplained_holds": holds,
            "harmful_k1z_actions": harm,
            "k1z_endgame_exemptions": endgame,
            "unresolved_harmful_targets": unresolved,
            "marker_counts": dict(sorted(marker_counts.items())),
            "route_execution_count": route_count,
            "post_opening_route_execution_count": post_opening,
            "score": candidate_result.get("score"),
            "tiles": candidate_result.get("tiles_owned"),
            "alive": candidate_result.get("is_alive"),
            "declared_win": results.get("winner_slot") == candidate_slot,
        },
        "parent": {
            "slot": parent_slot,
            "decision_count": len(parent_rows),
            "fallback_turns": parent_fallback if not mechanism_only else None,
            "degradation_turns": parent_degraded if not mechanism_only else None,
            "fallback_count": len(parent_fallback),
            "degradation_count": len(parent_degraded),
            "runtime_excluded_from_verdict": mechanism_only,
            "odc1_marker_count": parent_marker_count,
            "score": parent_result.get("score"),
            "tiles": parent_result.get("tiles_owned"),
            "alive": parent_result.get("is_alive"),
            "declared_win": results.get("winner_slot") == parent_slot,
        },
        "orientation_advantage": None if mechanism_only else advantage,
        "violations": violations,
    }


def contract_failures(contract: dict) -> list[str]:
    failures = []
    if contract.get("schema_version") != 2:
        failures.append("gate contract schema_version must be 2")
    if contract.get("launch_ready") is not True:
        failures.append("gate contract launch_ready is not true")
    if contract.get("screen_mode") not in {"competitive", "mechanism"}:
        failures.append("gate contract screen_mode must be competitive or mechanism")
    coalition = contract.get("coalition") or {}
    if contract.get("screen_mode") == "mechanism":
        required_roles = coalition.get("required_present_roles")
        actor_role = canonical(coalition.get("actor_role") or "odin").replace(
            " ", "_"
        )
        normalized_required = {
            canonical(role).replace(" ", "_")
            for role in required_roles or []
            if canonical(role)
        }
        if coalition.get("require_presence") is not True:
            failures.append("mechanism screen must require coalition presence")
        if not isinstance(required_roles, list) or not required_roles:
            failures.append("mechanism screen requires at least one coalition partner")
        elif not (normalized_required - {actor_role}):
            failures.append(
                "mechanism screen requires a coalition partner other than the actor"
            )
    for role in ("candidate", "parent"):
        definition = contract.get(role) or {}
        if not COMMIT_ID.fullmatch(str(definition.get("source_commit") or "")):
            failures.append(f"{role} source commit is not pinned")
        if not SHA256_ID.fullmatch(str(definition.get("image_id") or "")):
            failures.append(f"{role} image ID is not pinned")
    endgame = coalition.get("endgame_exception") or {}
    if not isinstance(endgame.get("enabled"), bool):
        failures.append("coalition endgame exception must be explicitly enabled or disabled")
    elif endgame["enabled"] is True:
        if not canonical(endgame.get("marker")):
            failures.append("coalition endgame marker is not configured")
        if not endgame.get("allowed_kinds"):
            failures.append("coalition endgame allowed_kinds is empty")
    return failures


def build_report(args: argparse.Namespace) -> tuple[dict, int]:
    contract = load(args.contract)
    mechanism_only = contract.get("screen_mode") == "mechanism"
    failures = contract_failures(contract)
    proof_errors, proof = validate_differential_proof(contract, args.contract)
    failures.extend(proof_errors)
    manifest = contract.get("manifest") or {}
    manifest_path = contract_path(args.contract, manifest.get("path"))
    if not manifest_path.is_file() or digest(manifest_path) != manifest.get("sha256"):
        failures.append("manifest hash is absent or mismatched")
    if mechanism_only and not args.only_a:
        raise ValueError("mechanism screen requires --only-a")
    if not mechanism_only and not args.only_a and (
        args.job_b is None or args.run_b is None
    ):
        raise ValueError("--job-b and --run-b are required unless --only-a is set")

    runs = [
        audit_run(
            args.run_a,
            args.job_a,
            contract,
            "A",
            args.resolved_images_a,
        )
    ]
    if not args.only_a:
        runs.append(
            audit_run(
                args.run_b,
                args.job_b,
                contract,
                "B",
                args.resolved_images_b,
            )
        )
    for run in runs:
        failures.extend(
            f"{run['orientation']}: {error}" for error in run.get("violations", [])
        )

    deltas = {}
    if not mechanism_only and not args.only_a:
        candidate_scores = [run.get("candidate", {}).get("score") for run in runs]
        parent_scores = [run.get("parent", {}).get("score") for run in runs]
        candidate_tiles = [run.get("candidate", {}).get("tiles") for run in runs]
        parent_tiles = [run.get("parent", {}).get("tiles") for run in runs]
        if all(finite(value) for value in candidate_scores + parent_scores):
            candidate_mean = sum(candidate_scores) / 2
            parent_mean = sum(parent_scores) / 2
            mean_delta = candidate_mean - parent_mean
            deltas.update(
                candidate_mean_score=candidate_mean,
                parent_mean_score=parent_mean,
                mean_score_delta=mean_delta,
            )
            minimum = (contract.get("advance_thresholds") or {}).get(
                "minimum_candidate_mean_score_delta", 0
            )
            if not finite(minimum) or mean_delta < minimum:
                failures.append(f"mean score delta below {minimum}")
        else:
            failures.append("paired scores are missing or non-finite")
        if all(type(value) is int for value in candidate_tiles + parent_tiles):
            deltas.update(
                candidate_combined_tiles=sum(candidate_tiles),
                parent_combined_tiles=sum(parent_tiles),
                combined_tile_delta=sum(candidate_tiles) - sum(parent_tiles),
            )
        else:
            failures.append("paired tiles are missing or non-integer")

    if failures:
        verdict = "STOP"
    elif mechanism_only:
        verdict = "PASS_MECHANISM_SCREEN"
    else:
        verdict = "PASS_A_CONTINUE" if args.only_a else "PASS_LOCAL_SCREEN"
    required_roles = [
        canonical(role).replace(" ", "_")
        for role in (
            (contract.get("coalition") or {}).get("required_present_roles") or []
        )
        if canonical(role)
    ]
    report = {
        "schema_version": 2,
        "arm": contract.get("arm"),
        "pair_id": contract.get("pair_id"),
        "verdict": verdict,
        "scope": (
            "candidate mechanism, runtime, and K1Z safety only; no local "
            "competitive lift claim"
            if mechanism_only
            else (
                "local seeded A/B screen only; never upload, submission, "
                "membership, champion, or promotion evidence"
            )
        ),
        "screen_mode": contract.get("screen_mode"),
        "competitive_evidence": not mechanism_only,
        "required_coalition_roles": required_roles,
        "contract_sha256": digest(args.contract),
        "candidate_source_commit": (contract.get("candidate") or {}).get(
            "source_commit"
        ),
        "candidate_image_id": (contract.get("candidate") or {}).get("image_id"),
        "parent_source_commit": (contract.get("parent") or {}).get("source_commit"),
        "parent_image_id": (contract.get("parent") or {}).get("image_id"),
        "differential_unit_proof": proof,
        "runs": runs,
        "paired_deltas": deltas,
        "failures": failures,
    }
    return report, 0 if not failures else 1


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--contract", type=Path, required=True)
    parser.add_argument("--job-a", type=Path, required=True)
    parser.add_argument("--run-a", type=Path, required=True)
    parser.add_argument("--resolved-images-a", type=Path)
    parser.add_argument("--job-b", type=Path)
    parser.add_argument("--run-b", type=Path)
    parser.add_argument("--resolved-images-b", type=Path)
    parser.add_argument("--only-a", action="store_true")
    parser.add_argument("--output", type=Path)
    return parser


def main() -> int:
    args = make_parser().parse_args()
    try:
        report, exit_code = build_report(args)
    except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError) as error:
        report = {
            "schema_version": 2,
            "verdict": "STOP",
            "scope": "local evaluator failure",
            "failures": [f"fatal evaluator error: {error}"],
        }
        exit_code = 1
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    sys.stdout.write(rendered)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())

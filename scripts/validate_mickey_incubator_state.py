#!/usr/bin/env python3
"""Fail-closed validation for Mickey's local-first incubator snapshot.

The validator is read-only and uses only local JSON files. It grants no
execution authority and deliberately keeps every external-operation flag shut.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path, PurePosixPath
from typing import Any


COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
IMAGE_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
IMAGE_TAG_RE = re.compile(r"^[a-z0-9][a-z0-9._/:@-]{0,191}$")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
GATE_STATUSES = {"pending", "pass", "fail", "not_applicable"}
ARM_STATUSES = {
    "proposed",
    "source_ready",
    "screen_passed",
    "confirmed",
    "production_ready",
    "promoted",
    "rejected",
    "rolled_back",
}
GENERATION_STATUSES = {
    "planned",
    "ready_to_screen",
    "screening",
    "confirming",
    "closed",
    "pivot_required",
    "stopped_for_human",
}
STRUCTURAL_PIVOTS = {
    "hypothesis",
    "roster_or_data_cell",
    "objective",
    "verifier",
    "decomposition",
    "search_space",
}
LEAGUE_GATE_STATUSES = {"blocked", "pending", "pass", "fail"}
LEAGUE_GATES = (
    "dedicated_mickey_player",
    "terminal_hrafn_migration_receipt",
    "hosted_4_of_4",
    "regression_20_of_20",
    "final_rci",
)
SENSITIVE_KEY_PARTS = ("credential", "password", "private_key", "secret", "token", "cookie")


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def evidence_is_safe(value: Any) -> bool:
    if not isinstance(value, str) or not value:
        return False
    path = PurePosixPath(value)
    return not path.is_absolute() and ".." not in path.parts


def find_sensitive_keys(value: Any, prefix: str = "$") -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).lower()
            if any(part in normalized for part in SENSITIVE_KEY_PARTS):
                found.append(f"{prefix}.{key}")
            found.extend(find_sensitive_keys(child, f"{prefix}.{key}"))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(find_sensitive_keys(child, f"{prefix}[{index}]"))
    return found


def validate_gate(errors: list[str], label: str, gate: Any) -> str | None:
    if not isinstance(gate, dict):
        errors.append(f"{label} must be an object")
        return None
    status = gate.get("status")
    if status not in GATE_STATUSES:
        errors.append(f"{label}.status is invalid")
    evidence = gate.get("evidence")
    if not isinstance(evidence, list) or not all(evidence_is_safe(item) for item in evidence):
        errors.append(f"{label}.evidence must contain safe repo-relative paths")
    if status == "pass" and not evidence:
        errors.append(f"{label} passed without evidence")
    return status if isinstance(status, str) else None


def validate_production_candidate(
    errors: list[str], label: str, candidate: Any
) -> bool:
    if not isinstance(candidate, dict):
        errors.append(f"{label} requires a production_candidate object")
        return False
    if candidate.get("class") != "production_candidate":
        errors.append(f"{label}.class must be production_candidate")
    if candidate.get("derived_from_static_arm") is not True:
        errors.append(f"{label} must identify its static-arm derivation")
    if candidate.get("static_evaluation_runtime_absent") is not True:
        errors.append(f"{label} still contains the static evaluation runtime")
    if candidate.get("baked_static_arm_absent") is not True:
        errors.append(f"{label} still contains a baked static arm")
    if candidate.get("upload_eligible") is not False:
        errors.append(f"{label} cannot grant upload eligibility")
    if candidate.get("live_softmax_gate") != "separate_and_closed":
        errors.append(f"{label} must keep the live Softmax gate closed")
    if not COMMIT_RE.fullmatch(str(candidate.get("source_commit", ""))):
        errors.append(f"{label}.source_commit must be a full commit")
    if not IMAGE_RE.fullmatch(str(candidate.get("image_digest", ""))):
        errors.append(f"{label}.image_digest must be sha256:<64 hex>")
    if not IMAGE_TAG_RE.fullmatch(str(candidate.get("image_tag", ""))):
        errors.append(f"{label}.image_tag is invalid")
    if candidate.get("architecture") != "amd64":
        errors.append(f"{label}.architecture must be amd64")
    gates = candidate.get("gates")
    if not isinstance(gates, dict):
        errors.append(f"{label}.gates must be an object")
        return False
    required = ("full_source_suite", "independent_verifier", "exact_image", "mac_canary")
    passed = True
    for name in required:
        status = validate_gate(errors, f"{label}.gates.{name}", gates.get(name))
        passed = passed and status == "pass"
    return passed


def validate_arm(
    errors: list[str], generation_label: str, arm: Any, control_arm_id: str
) -> tuple[str | None, str | None]:
    if not isinstance(arm, dict):
        errors.append(f"{generation_label} contains a non-object arm")
        return None, None
    arm_id = arm.get("arm_id")
    label = f"{generation_label}.arms[{arm_id or '?'}]"
    if not isinstance(arm_id, str) or not ID_RE.fullmatch(arm_id):
        errors.append(f"{label}.arm_id is invalid")
        return None, None
    role = arm.get("role")
    if role not in {"control", "maverick"}:
        errors.append(f"{label}.role is invalid")
    delta_count = arm.get("mechanism_delta_count")
    if role == "control":
        if arm_id != control_arm_id or arm.get("parent_arm_id") is not None:
            errors.append(f"{label} is not the declared root control")
        if delta_count != 0:
            errors.append(f"{label} control must have zero mechanism deltas")
    elif role == "maverick":
        if arm.get("parent_arm_id") != control_arm_id:
            errors.append(f"{label} must use the generation control as parent")
        if delta_count != 1:
            errors.append(f"{label} must isolate exactly one mechanism delta")
    if not isinstance(arm.get("mechanism_key"), str) or not arm.get("mechanism_key"):
        errors.append(f"{label}.mechanism_key is required")
    if not isinstance(arm.get("mechanism"), str) or not arm.get("mechanism"):
        errors.append(f"{label}.mechanism is required")
    if arm_id.startswith("convert-") and arm.get("roster_requirement") != "mixed_with_visible_outsider":
        errors.append(f"{label} conversion requires a visible outsider roster")
    if arm_id.startswith("grow-") and arm.get("roster_requirement") != "any":
        errors.append(f"{label} grow roster requirement is invalid")

    status = arm.get("status")
    if status not in ARM_STATUSES:
        errors.append(f"{label}.status is invalid")
    artifact = arm.get("evaluation_artifact")
    if not isinstance(artifact, dict):
        errors.append(f"{label}.evaluation_artifact must be an object")
    else:
        if artifact.get("class") != "static_evaluation":
            errors.append(f"{label} evaluation artifact class drifted")
        if artifact.get("surrogate_source") != "static-eval-v1":
            errors.append(f"{label} surrogate source drifted")
        if artifact.get("upload_eligible") is not False:
            errors.append(f"{label} static artifact cannot be upload eligible")
        if artifact.get("production_eligible") is not False:
            errors.append(f"{label} static artifact cannot be production eligible")
        if not COMMIT_RE.fullmatch(str(artifact.get("source_commit", ""))):
            errors.append(f"{label} static source commit is invalid")

    gates = arm.get("gates")
    if not isinstance(gates, dict):
        errors.append(f"{label}.gates must be an object")
        source_status = screen_status = confirm_status = None
    else:
        source_status = validate_gate(errors, f"{label}.gates.source", gates.get("source"))
        screen_status = validate_gate(errors, f"{label}.gates.screen", gates.get("screen"))
        confirm_status = validate_gate(errors, f"{label}.gates.confirm", gates.get("confirm"))

    if role == "control":
        if screen_status != "not_applicable" or confirm_status != "not_applicable":
            errors.append(f"{label} control screen and confirm gates must be not_applicable")
    else:
        if screen_status == "not_applicable" or confirm_status == "not_applicable":
            errors.append(f"{label} maverick gates cannot be not_applicable")
        if confirm_status == "pass" and screen_status != "pass":
            errors.append(f"{label} confirmation passed before screen")

    if status in {"source_ready", "screen_passed", "confirmed", "production_ready", "promoted"} and source_status != "pass":
        errors.append(f"{label} status requires a passed source gate")
    if status in {"screen_passed", "confirmed", "production_ready", "promoted"} and screen_status != "pass":
        errors.append(f"{label} status requires a passed screen gate")
    if status in {"confirmed", "production_ready", "promoted"} and confirm_status != "pass":
        errors.append(f"{label} status requires a passed confirmation gate")

    production_candidate = arm.get("production_candidate")
    if status in {"production_ready", "promoted"}:
        if not validate_production_candidate(errors, f"{label}.production_candidate", production_candidate):
            errors.append(f"{label} is not production ready")
    elif production_candidate is not None:
        errors.append(f"{label} has a production candidate before production_ready")
    if status in {"rejected", "rolled_back"} and not arm.get("rejection_reason"):
        errors.append(f"{label} rejected or rolled-back arm needs a reason")
    return arm_id, arm.get("mechanism_key")


def validate_local_incumbent(errors: list[str], incumbent: Any, arms_by_id: dict[str, Any]) -> None:
    if not isinstance(incumbent, dict):
        errors.append("local_incumbent must be an object")
        return
    state = incumbent.get("state")
    if state not in {"registration_required", "active", "rollback_required"}:
        errors.append("local_incumbent.state is invalid")
        return
    if state == "registration_required":
        for key in ("origin", "arm_id", "source_commit", "image_tag", "image_digest", "activation_receipt", "previous"):
            if incumbent.get(key) is not None:
                errors.append(f"unregistered local_incumbent.{key} must be null")
        if incumbent.get("rollback_ready") is not False:
            errors.append("unregistered local_incumbent cannot be rollback ready")
        return

    origin = incumbent.get("origin")
    if origin not in {"baseline", "promoted_arm"}:
        errors.append("active local_incumbent.origin is invalid")
    if not isinstance(incumbent.get("arm_id"), str) or not incumbent.get("arm_id"):
        errors.append("active local_incumbent.arm_id is required")
    if not COMMIT_RE.fullmatch(str(incumbent.get("source_commit", ""))):
        errors.append("active local_incumbent.source_commit is invalid")
    if not IMAGE_TAG_RE.fullmatch(str(incumbent.get("image_tag", ""))):
        errors.append("active local_incumbent.image_tag is invalid")
    if not IMAGE_RE.fullmatch(str(incumbent.get("image_digest", ""))):
        errors.append("active local_incumbent.image_digest is invalid")
    if not evidence_is_safe(incumbent.get("activation_receipt")):
        errors.append("active local_incumbent.activation_receipt is invalid")
    if incumbent.get("rollback_ready") is not True:
        errors.append("active local_incumbent must be rollback ready")
    if origin == "promoted_arm":
        arm = arms_by_id.get(incumbent.get("arm_id"))
        if not arm or arm.get("status") != "promoted":
            errors.append("promoted local_incumbent does not match a promoted arm")
        previous = incumbent.get("previous")
        if not isinstance(previous, dict):
            errors.append("promoted local_incumbent requires an immutable previous target")
        else:
            if not COMMIT_RE.fullmatch(str(previous.get("source_commit", ""))):
                errors.append("local_incumbent.previous.source_commit is invalid")
            if not IMAGE_TAG_RE.fullmatch(str(previous.get("image_tag", ""))):
                errors.append("local_incumbent.previous.image_tag is invalid")
            if not IMAGE_RE.fullmatch(str(previous.get("image_digest", ""))):
                errors.append("local_incumbent.previous.image_digest is invalid")
            if not evidence_is_safe(previous.get("activation_receipt")):
                errors.append("local_incumbent.previous.activation_receipt is invalid")
    elif incumbent.get("previous") is not None:
        errors.append("baseline local_incumbent.previous must be null")
    if state == "rollback_required" and not isinstance(incumbent.get("previous"), dict):
        errors.append("rollback_required local_incumbent has no rollback target")


def validate_league_gate(errors: list[str], label: str, gate: Any) -> str | None:
    if not isinstance(gate, dict):
        errors.append(f"{label} must be an object")
        return None
    status = gate.get("status")
    if status not in LEAGUE_GATE_STATUSES:
        errors.append(f"{label}.status is invalid")
    evidence = gate.get("evidence")
    if not isinstance(evidence, list) or not all(evidence_is_safe(item) for item in evidence):
        errors.append(f"{label}.evidence must contain safe repo-relative paths")
    if status == "pass" and not evidence:
        errors.append(f"{label} passed without evidence")
    return status if isinstance(status, str) else None


def validate_league_incumbent(
    errors: list[str], league: Any, local_incumbent: Any
) -> None:
    if not isinstance(league, dict):
        errors.append("league_incumbent must be an object")
        return
    state = league.get("state")
    if state not in {"blocked", "eligible", "active"}:
        errors.append("league_incumbent.state is invalid")
        return
    gates = league.get("gates")
    gate_statuses: dict[str, str | None] = {}
    if not isinstance(gates, dict):
        errors.append("league_incumbent.gates must be an object")
    else:
        for name in LEAGUE_GATES:
            gate_statuses[name] = validate_league_gate(
                errors, f"league_incumbent.gates.{name}", gates.get(name)
            )
    all_pass = all(gate_statuses.get(name) == "pass" for name in LEAGUE_GATES)
    if state == "blocked":
        if all_pass:
            errors.append("league_incumbent cannot remain blocked after every league gate passes")
        local_arm_id = league.get("local_arm_id")
        if local_arm_id is not None:
            if not isinstance(local_incumbent, dict) or local_incumbent.get("state") != "active":
                errors.append("blocked league_incumbent cannot reference an inactive local incumbent")
            elif local_arm_id != local_incumbent.get("arm_id"):
                errors.append("blocked league_incumbent.local_arm_id differs from local_incumbent.arm_id")
        player_id = league.get("player_id")
        if gate_statuses.get("dedicated_mickey_player") == "pass":
            if not re.fullmatch(r"^ply_[0-9a-f-]{36}$", str(player_id or "")):
                errors.append("passed dedicated-player gate requires league_incumbent.player_id")
        elif player_id is not None:
            errors.append("blocked league_incumbent.player_id requires a passed dedicated-player gate")
        for key in ("policy_version_id", "membership_id", "activation_receipt"):
            if league.get(key) is not None:
                errors.append(f"blocked league_incumbent.{key} must be null")
        return

    if not all_pass:
        errors.append(f"league_incumbent {state} requires every league gate to pass")
    if not isinstance(local_incumbent, dict) or local_incumbent.get("state") != "active":
        errors.append(f"league_incumbent {state} requires an active local_incumbent")
    elif league.get("local_arm_id") != local_incumbent.get("arm_id"):
        errors.append("league_incumbent.local_arm_id differs from local_incumbent.arm_id")
    if not re.fullmatch(r"^ply_[0-9a-f-]{36}$", str(league.get("player_id", ""))):
        errors.append("league_incumbent.player_id is invalid")
    if state == "eligible":
        for key in ("policy_version_id", "membership_id", "activation_receipt"):
            if league.get(key) is not None:
                errors.append(f"eligible league_incumbent.{key} must be null")
        return
    if not re.fullmatch(r"^[0-9a-f-]{36}$", str(league.get("policy_version_id", ""))):
        errors.append("active league_incumbent.policy_version_id is invalid")
    if not re.fullmatch(r"^lpm_[0-9a-f-]{36}$", str(league.get("membership_id", ""))):
        errors.append("active league_incumbent.membership_id is invalid")
    if not evidence_is_safe(league.get("activation_receipt")):
        errors.append("active league_incumbent.activation_receipt is invalid")


def validate_task_root(task_root: Path) -> list[str]:
    errors: list[str] = []
    task_root = task_root.expanduser().resolve()
    manifest_path = task_root / "state" / "incubator_manifest.json"
    progress_path = task_root / "state" / "progress.json"
    try:
        manifest = read_json(manifest_path)
    except (OSError, json.JSONDecodeError) as error:
        return [f"cannot read {manifest_path}: {error}"]
    try:
        progress = read_json(progress_path)
    except (OSError, json.JSONDecodeError) as error:
        return [f"cannot read {progress_path}: {error}"]

    if not isinstance(manifest, dict):
        return ["manifest root must be an object"]
    if not isinstance(progress, dict):
        return ["progress root must be an object"]
    for key_path in find_sensitive_keys(manifest):
        errors.append(f"sensitive-looking state key is forbidden: {key_path}")
    if manifest.get("schema_version") != 1:
        errors.append("manifest.schema_version must be 1")
    if manifest.get("task_id") != "mickey-cpu-incubator":
        errors.append("manifest.task_id is invalid")
    if progress.get("task_id") != manifest.get("task_id"):
        errors.append("progress.task_id differs from manifest.task_id")
    if manifest.get("lane") != "mickey":
        errors.append("manifest.lane must be mickey")

    scope = manifest.get("scope")
    if not isinstance(scope, dict) or scope.get("mode") != "local_static_cpu_evaluation":
        errors.append("scope mode must remain local_static_cpu_evaluation")
    else:
        for key, value in scope.items():
            if key == "mode":
                continue
            if value is not False:
                errors.append(f"scope.{key} must remain false in this state layer")

    boundary = manifest.get("static_evaluation_boundary")
    required_boundary = {
        "artifact_class": "static_evaluation",
        "surrogate_source": "static-eval-v1",
        "upload_eligible": False,
        "production_eligible": False,
        "production_reimplementation_required": True,
        "live_promotion_gate": "separate_and_closed",
    }
    if not isinstance(boundary, dict):
        errors.append("static_evaluation_boundary must be an object")
    else:
        for key, expected in required_boundary.items():
            if boundary.get(key) != expected:
                errors.append(f"static_evaluation_boundary.{key} drifted")

    loop = manifest.get("loop_control")
    progress_stale = progress.get("stale_count")
    if not isinstance(loop, dict):
        errors.append("loop_control must be an object")
    else:
        stale_count = loop.get("stale_count")
        if not isinstance(progress_stale, int) or progress_stale < 0:
            errors.append("progress.stale_count is invalid")
        if stale_count != progress_stale:
            errors.append("loop_control.stale_count differs from progress.stale_count")
        if loop.get("pivot_at") != 2 or loop.get("stop_at") != 4:
            errors.append("loop stall thresholds must remain 2 and 4")
        declared_pivots = loop.get("allowed_structural_pivots")
        if (
            not isinstance(declared_pivots, list)
            or not all(isinstance(item, str) for item in declared_pivots)
            or set(declared_pivots) != STRUCTURAL_PIVOTS
        ):
            errors.append("loop structural pivot set drifted")

    contracts = manifest.get("gate_contracts")
    if not isinstance(contracts, dict):
        errors.append("gate_contracts must be an object")
    else:
        screen = contracts.get("screen", {})
        confirm = contracts.get("confirm", {})
        promote = contracts.get("promote_local_mac", {})
        promote_league = contracts.get("promote_league", {})
        for contract_name, contract in (
            ("screen", screen),
            ("confirm", confirm),
            ("promote_local_mac", promote),
            ("promote_league", promote_league),
        ):
            if not isinstance(contract, dict):
                errors.append(f"gate_contracts.{contract_name} must be an object")
        screen = screen if isinstance(screen, dict) else {}
        confirm = confirm if isinstance(confirm, dict) else {}
        promote = promote if isinstance(promote, dict) else {}
        promote_league = promote_league if isinstance(promote_league, dict) else {}
        screen_pairs = screen.get("minimum_matched_pairs")
        confirm_pairs = confirm.get("minimum_fresh_matched_pairs")
        if not isinstance(screen_pairs, int) or screen_pairs < 2:
            errors.append("screen requires at least two matched pairs")
        if not isinstance(confirm_pairs, int) or (
            isinstance(screen_pairs, int) and confirm_pairs < screen_pairs
        ):
            errors.append("confirmation must use at least as many fresh pairs as screen")
        for contract_name, contract in (("screen", screen), ("confirm", confirm)):
            for key in ("direct_marker_reach_required", "matched_outcome_advantage_required"):
                if contract.get(key) is not True:
                    errors.append(f"{contract_name}.{key} must be true")
            for key in ("maximum_k1z_harm", "maximum_rejects", "maximum_unexplained_holds"):
                if contract.get(key) != 0:
                    errors.append(f"{contract_name}.{key} must be zero")
        required_promote_true = (
            "confirmed_static_mechanism_required",
            "production_reimplementation_required",
            "static_evaluation_runtime_absent",
            "full_source_suite_required",
            "independent_verifier_required",
            "exact_amd64_image_required",
            "mac_canary_required",
            "registered_rollback_target_required",
        )
        for key in required_promote_true:
            if promote.get(key) is not True:
                errors.append(f"promote_local_mac.{key} must be true")
        if promote.get("live_softmax_gate_inferred") is not False:
            errors.append("local promotion cannot infer the live Softmax gate")
        if promote.get("softmax_identity_required") is not False:
            errors.append("local promotion cannot require a Softmax identity")
        required_league_true = (
            "active_local_incumbent_required",
            "dedicated_mickey_player_required",
            "terminal_hrafn_migration_receipt_required",
            "hosted_4_of_4_required",
            "regression_20_of_20_required",
            "final_rci_required",
        )
        for key in required_league_true:
            if promote_league.get(key) is not True:
                errors.append(f"promote_league.{key} must be true")
        if promote_league.get("authority_from_this_manifest") is not False:
            errors.append("league promotion authority cannot come from this manifest")

    generations = manifest.get("generations")
    arms_by_id: dict[str, Any] = {}
    generation_by_id: dict[str, Any] = {}
    if not isinstance(generations, list) or not generations:
        errors.append("generations must be a non-empty array")
    else:
        for generation in generations:
            if not isinstance(generation, dict):
                errors.append("generation must be an object")
                continue
            generation_id = generation.get("generation_id")
            label = f"generation[{generation_id or '?'}]"
            if not isinstance(generation_id, str) or not ID_RE.fullmatch(generation_id):
                errors.append(f"{label}.generation_id is invalid")
                continue
            if generation_id in generation_by_id:
                errors.append(f"duplicate generation_id: {generation_id}")
            generation_by_id[generation_id] = generation
            if generation.get("status") not in GENERATION_STATUSES:
                errors.append(f"{label}.status is invalid")
            if not isinstance(generation.get("structural_dimension"), str) or not generation.get("structural_dimension"):
                errors.append(f"{label}.structural_dimension is required")
            if not isinstance(generation.get("hypothesis"), str) or not generation.get("hypothesis"):
                errors.append(f"{label}.hypothesis is required")
            if not COMMIT_RE.fullmatch(str(generation.get("source_commit", ""))):
                errors.append(f"{label}.source_commit is invalid")
            if not COMMIT_RE.fullmatch(str(generation.get("base_commit", ""))):
                errors.append(f"{label}.base_commit is invalid")
            parent_generation = generation.get("parent_generation_id")
            if parent_generation is not None and parent_generation not in generation_by_id:
                errors.append(f"{label}.parent_generation_id must reference an earlier generation")
            control_arm_id = generation.get("control_arm_id")
            if not isinstance(control_arm_id, str) or not ID_RE.fullmatch(control_arm_id):
                errors.append(f"{label}.control_arm_id is invalid")
                control_arm_id = ""
            arms = generation.get("arms")
            if not isinstance(arms, list) or len(arms) < 2:
                errors.append(f"{label} must contain a control and at least one maverick")
                continue
            controls = 0
            mechanism_keys: set[str] = set()
            for arm in arms:
                arm_id, mechanism_key = validate_arm(errors, label, arm, control_arm_id)
                if isinstance(arm, dict) and arm.get("role") == "control":
                    controls += 1
                if arm_id:
                    if arm_id in arms_by_id:
                        errors.append(f"duplicate arm_id across generations: {arm_id}")
                    arms_by_id[arm_id] = arm
                if mechanism_key:
                    if mechanism_key in mechanism_keys:
                        errors.append(f"{label} repeats mechanism_key {mechanism_key}")
                    mechanism_keys.add(mechanism_key)
            if controls != 1:
                errors.append(f"{label} must contain exactly one control")

    current_generation_id = manifest.get("current_generation_id")
    current_generation = generation_by_id.get(current_generation_id)
    if current_generation is None:
        errors.append("current_generation_id does not resolve")
    if isinstance(loop, dict) and isinstance(progress_stale, int) and current_generation is not None:
        loop_state = loop.get("state")
        next_direction = loop.get("next_direction")
        if progress_stale >= 4:
            if loop_state != "human_attention":
                errors.append("stale_count >= 4 requires loop state human_attention")
            if current_generation.get("status") != "stopped_for_human":
                errors.append("stale_count >= 4 requires generation stop")
            if next_direction is not None:
                errors.append("human-attention state cannot preregister another autonomous direction")
        elif progress_stale >= 2:
            if loop_state != "pivot_required":
                errors.append("stale_count >= 2 requires loop state pivot_required")
            if current_generation.get("status") != "pivot_required":
                errors.append("stale_count >= 2 requires generation status pivot_required")
            if not isinstance(next_direction, dict):
                errors.append("pivot_required needs a preregistered next_direction")
            else:
                dimension = next_direction.get("structural_dimension")
                if dimension not in STRUCTURAL_PIVOTS:
                    errors.append("next_direction structural dimension is invalid")
                if dimension == current_generation.get("structural_dimension"):
                    errors.append("next_direction must change the structural dimension")
                if next_direction.get("parameter_only") is not False:
                    errors.append("stale pivot cannot be parameter-only")
                if not next_direction.get("rationale"):
                    errors.append("stale pivot needs a rationale")
        else:
            if loop_state != "active":
                errors.append("stale_count below 2 requires loop state active")
            if next_direction is not None:
                errors.append("active loop must not carry a stale-pivot direction")

    local_incumbent = manifest.get("local_incumbent")
    validate_local_incumbent(errors, local_incumbent, arms_by_id)
    validate_league_incumbent(errors, manifest.get("league_incumbent"), local_incumbent)
    promoted = [arm_id for arm_id, arm in arms_by_id.items() if arm.get("status") == "promoted"]
    incumbent = local_incumbent
    if promoted:
        if len(promoted) != 1:
            errors.append("only one arm may be promoted in a snapshot")
        if not isinstance(incumbent, dict) or incumbent.get("state") not in {"active", "rollback_required"}:
            errors.append("a promoted arm requires an active or rollback-required local incumbent")
        elif incumbent.get("arm_id") != promoted[0]:
            errors.append("promoted arm differs from local_incumbent.arm_id")

    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("task_root", type=Path)
    args = parser.parse_args(argv)
    errors = validate_task_root(args.task_root)
    result = {
        "ok": not errors,
        "task_root": str(args.task_root.expanduser().resolve()),
        "errors": errors,
    }
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())

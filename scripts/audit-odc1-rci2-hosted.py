#!/usr/bin/env python3
"""Fail-closed audit for the matched ODC1 RCI2 hosted gate."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import subprocess
import urllib.request
from pathlib import Path


CANDIDATE_REQUEST = "xreq_78ea6880-1bba-4db6-88e1-9008e7f4966a"
PARENT_REQUEST = "xreq_21e492fa-fe11-46c2-9e06-0ed289a12d5e"
CANDIDATE_POLICY_VERSION = "3d498947-09a1-490f-80d4-b893609c2f00"
PARENT_POLICY_VERSION = "ca4a4e76-fd83-4c92-bf9f-f2440d1f867f"
CANDIDATE_SOURCE_COMMIT = "23ada8a8cfc1f41b1c798cfcb3b71f6fc2f21587"
CANDIDATE_IMAGE_ID = (
    "sha256:3af909f391a179356876b54e810fd8c197d9cd88432ff4916a6c4e83c50a41a9"
)
VARIANT = "tournament-12p-pangaea"
ODIN_PLAYER_ID = "ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c"
ODIN_SLOT = 7
ROUTE_MARKERS = {"odec1", "odec2", "odc25", "odc40"}
NUCLEAR_UNITS = {"atom bomb", "hydrogen bomb", "mirv"}
EXPECTED_BODY_HASHES = {
    "candidate": "e6c18b9e822ddc652ecfbe9d45b92ed26305c2b0de00359293f3a340a8e8f195",
    "parent": "bd0899da5b12f105b99009d00b9323bf4216eb61005dc5674b09e29f281c9eb1",
}
COALITION = {
    "actor_role": "odin",
    "identities": [
        {
            "role": "odin",
            "names": ["K1Z odin free", "odin free"],
            "player_id": ODIN_PLAYER_ID,
        },
        {
            "role": "katanasan",
            "names": ["K1Z katanasan", "katanasan"],
            "player_id": "ply_8b6cec26-0484-434d-9400-2ca3bbceb7ba",
        },
        {
            "role": "gravity",
            "names": [
                "K1Z Gravity",
                "Gravity",
                "K1Z juryoku-koku",
                "juryoku-koku",
                "juryoku koku",
            ],
            "player_id": "ply_c0dfb76c-62ca-4ec5-82e0-9d5a5baf7335",
        },
        {
            "role": "hrafn",
            "names": ["K1Z Hrafn", "Hrafn"],
            "player_id": "ply_b3b948ca-f8ff-4e4f-93d7-9d9b8725e863",
        },
    ],
    "endgame_exception": {"enabled": False},
}


def load_semantics(root: Path):
    target = root / "scripts" / "audit-odc1-pair.py"
    spec = importlib.util.spec_from_file_location("odc1_pair_audit", target)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def digest_file(path: Path) -> str:
    return digest_bytes(path.read_bytes())


def coworld_json(*args: str):
    result = subprocess.run(
        ["uvx", "--from", "coworld==0.1.28", "coworld", *args, "--json"],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def replay_bytes(url: str) -> bytes:
    prefix = "https://softmax-public.s3.amazonaws.com/replays/"
    if not url.startswith(prefix):
        raise ValueError(f"replay URL is outside the allowlist: {url}")
    with urllib.request.urlopen(url, timeout=180) as response:
        value = response.read(96 * 1024 * 1024 + 1)
    if len(value) > 96 * 1024 * 1024:
        raise ValueError("replay exceeds 96 MiB")
    return value


def request_roster(body: dict) -> list[str]:
    rows = sorted(body.get("roster") or [], key=lambda row: row.get("slot", -1))
    return [str((row.get("player") or {}).get("policy_ref") or "") for row in rows]


def episode_roster(episode: dict) -> list[str]:
    participants = sorted(
        episode.get("participants") or [],
        key=lambda row: row.get("position", -1),
    )
    return [str(row.get("policy_version_id") or "") for row in participants]


def decision_rows(replay: dict) -> list[dict]:
    rows = []
    text = (replay.get("inlineRunArtifacts") or {}).get("decisions.jsonl", "")
    for line_number, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        value = json.loads(line)
        if not isinstance(value, dict):
            raise ValueError(f"decisions.jsonl:{line_number}: expected an object")
        rows.append(value)
    return rows


def direct_target(source: dict) -> tuple[str | None, str | None]:
    raw_target = source.get("target")
    nested = raw_target if isinstance(raw_target, dict) else {}
    scalar_target = (
        raw_target
        if isinstance(raw_target, (str, int)) and not isinstance(raw_target, bool)
        else None
    )
    target_id = (
        source.get("targetID")
        or source.get("targetId")
        or source.get("target_id")
        or source.get("recipientID")
        or source.get("recipient")
        or source.get("playerID")
        or source.get("targetPlayerID")
        or nested.get("id")
        or scalar_target
    )
    target_name = (
        source.get("targetName")
        or source.get("recipientName")
        or nested.get("name")
    )
    return (
        str(target_id).lower() if target_id else None,
        str(target_name) if target_name else None,
    )


def execution_location(source: dict, kind: str | None) -> str | None:
    if kind == "nuke":
        keys = ("tile", "targetTile", "target_tile")
    elif kind in {"boat", "move_warship"}:
        keys = ("dst", "destination", "targetTile", "target_tile", "tile")
    else:
        return None
    for key in keys:
        if key not in source or source[key] is None:
            continue
        value = source[key]
        if isinstance(value, (dict, list)):
            return json.dumps(value, sort_keys=True, separators=(",", ":"))
        return str(value)
    return None


def normalized_kind(value: object) -> str:
    text = str(value or "").strip()
    output = []
    for index, character in enumerate(text):
        if index and character.isupper() and text[index - 1].islower():
            output.append("_")
        output.append(character.lower())
    return "".join(output).replace("-", "_").replace(" ", "_")


def selected_execution_kind(row: dict, semantic) -> str | None:
    metadata = row.get("selectedActionMetadata") or {}
    kind = normalized_kind(row.get("selectedActionKind"))
    units = {
        semantic.canonical(metadata.get(key))
        for key in ("unit", "unitType", "weapon", "label")
        if metadata.get(key)
    }
    if kind == "nuke" or units & NUCLEAR_UNITS:
        return "nuke"
    return kind if kind in semantic.HARMFUL_KINDS else None


def submitted_execution_kind(row: dict, semantic) -> str | None:
    submitted = (row.get("result") or {}).get("submittedIntent") or {}
    kind = normalized_kind(submitted.get("type"))
    units = {
        semantic.canonical(submitted.get(key))
        for key in ("unit", "unitType", "weapon", "label")
        if submitted.get(key)
    }
    if kind == "nuke" or units & NUCLEAR_UNITS:
        return "nuke"
    aliases = {
        "boat_attack": "boat",
        "launch_boat": "boat",
        "move_warship": "move_warship",
    }
    kind = aliases.get(kind, kind)
    return kind if kind in semantic.HARMFUL_KINDS else None


def proven_neutral_expansion(row: dict, semantic) -> bool:
    metadata = row.get("selectedActionMetadata") or {}
    return (
        semantic.neutral_expansion(row)
        and metadata.get("expansion") is True
        and semantic.canonical(metadata.get("targetName")) == "terra nullius"
        and str(row.get("selectedLegalActionId") or "").startswith(
            "expand:terra-nullius:"
        )
    )


def audit_submitted_execution(
    rows: list[dict],
    registry: dict,
    semantic,
) -> tuple[list[dict], list[dict], list[dict]]:
    conflicts = []
    harmful = []
    unresolved = []
    for row in rows:
        selected_kind = selected_execution_kind(row, semantic)
        submitted_kind = submitted_execution_kind(row, semantic)
        if selected_kind is None and submitted_kind is None:
            continue
        metadata = row.get("selectedActionMetadata") or {}
        submitted = (row.get("result") or {}).get("submittedIntent") or {}
        selected_id, selected_name = direct_target(metadata)
        submitted_id, submitted_name = direct_target(submitted)
        selected_location = execution_location(metadata, selected_kind)
        submitted_location = execution_location(submitted, submitted_kind)
        conflict_reasons = []
        if selected_kind != submitted_kind:
            conflict_reasons.append(
                f"selected kind {selected_kind!r} != submitted kind {submitted_kind!r}"
            )
        if selected_id and submitted_id and selected_id != submitted_id:
            conflict_reasons.append("selected and submitted target IDs differ")
        if (
            selected_name
            and submitted_name
            and semantic.coalition_name(selected_name)
            != semantic.coalition_name(submitted_name)
        ):
            conflict_reasons.append("selected and submitted target names differ")
        if (
            selected_location is not None
            and submitted_location is not None
            and selected_location != submitted_location
        ):
            conflict_reasons.append("selected and submitted target locations differ")
        if conflict_reasons:
            conflicts.append(
                {
                    "turn": row.get("turnNumber"),
                    "action_id": row.get("selectedLegalActionId"),
                    "reasons": conflict_reasons,
                }
            )

        kind = submitted_kind
        if kind is None:
            continue
        identity_target_kinds = {
            "attack",
            "embargo",
            "target_player",
            "break_alliance",
        }
        location_target_kinds = {"boat", "nuke", "move_warship"}
        missing_submitted_target = (
            kind in identity_target_kinds
            and submitted_id is None
            and not submitted_name
            and not proven_neutral_expansion(row, semantic)
        ) or (
            kind in location_target_kinds
            and submitted_location is None
        )
        if missing_submitted_target:
            unresolved.append(
                {
                    "turn": row.get("turnNumber"),
                    "kind": kind,
                    "reason": "accepted submitted harmful intent is missing its required target",
                }
            )
            continue

        authoritative_id = submitted_id
        authoritative_name = submitted_name
        if (
            kind in location_target_kinds
            and selected_location is not None
            and selected_location == submitted_location
        ):
            authoritative_id = authoritative_id or selected_id
            authoritative_name = authoritative_name or selected_name
        by_id = semantic.role_for_id(authoritative_id, registry)
        by_name = semantic.role_for_name(authoritative_name, registry)
        if by_id and by_name and by_id != by_name:
            unresolved.append(
                {
                    "turn": row.get("turnNumber"),
                    "kind": kind,
                    "reason": "submitted target ID and name resolve differently",
                }
            )
            continue
        target_role = by_id or by_name
        if kind == "embargo_all" or (
            target_role is not None and target_role != "odin"
        ):
            harmful.append(
                {
                    "turn": row.get("turnNumber"),
                    "kind": kind,
                    "target_id": authoritative_id,
                    "target_name": authoritative_name,
                    "target_role": target_role,
                }
            )
            continue
        requires_target = kind in {
            "attack",
            "boat",
            "nuke",
            "warship",
            "embargo",
            "target_player",
            "break_alliance",
            "move_warship",
        }
        if (
            requires_target
            and authoritative_id is None
            and not authoritative_name
            and not proven_neutral_expansion(row, semantic)
        ):
            unresolved.append(
                {
                    "turn": row.get("turnNumber"),
                    "kind": kind,
                    "reason": "accepted submitted harmful intent has no resolvable target",
                }
            )
    return conflicts, harmful, unresolved


def result_player(replay: dict, position: int | None) -> dict:
    players = (replay.get("results") or {}).get("players") or []
    if not isinstance(position, int):
        return {}
    by_slot = {
        row.get("slot"): row for row in players if isinstance(row, dict)
    }
    if position in by_slot:
        return by_slot[position]
    return players[position] if 0 <= position < len(players) else {}


def winning_player_id(episode: dict) -> str | None:
    scores = episode.get("scores") or []
    winning = [row for row in scores if row.get("score") == 1]
    if len(winning) != 1:
        return None
    policy_version_id = winning[0].get("policy_version_id")
    participant = next(
        (
            row
            for row in episode.get("participants") or []
            if row.get("policy_version_id") == policy_version_id
        ),
        None,
    )
    return str(participant.get("player_id")) if participant else None


def audit_episode(
    episode: dict,
    policy_version_id: str,
    role: str,
    semantic,
    cache: Path,
) -> tuple[dict, list[str]]:
    violations = []
    episode_request_id = str(episode.get("id") or "")
    if episode.get("status") != "completed" or not episode.get("replay_url"):
        return (
            {
                "episode_id": episode_request_id,
                "transport_status": episode.get("status"),
            },
            [f"{role} {episode_request_id}: completed replay is unavailable"],
        )

    raw = replay_bytes(str(episode["replay_url"]))
    cache.mkdir(parents=True, exist_ok=True)
    replay_path = cache / f"{episode_request_id}.replay"
    replay_path.write_bytes(raw)
    replay = json.loads(raw)
    decisions = decision_rows(replay)
    odin = [
        row
        for row in decisions
        if semantic.coalition_name(row.get("username")) == "odin free"
    ]
    contract = {"coalition": COALITION}
    registry, identity_errors = semantic.build_identity_registry(
        contract,
        decisions,
    )
    violations.extend(f"{role} {episode_request_id}: {error}" for error in identity_errors)
    configured_ids = {
        str(entry["player_id"]).lower() for entry in COALITION["identities"]
    }
    participant_ids = {
        str(row.get("player_id") or "").lower()
        for row in episode.get("participants") or []
    }
    if not configured_ids.issubset(participant_ids):
        violations.append(f"{role} {episode_request_id}: K1Z coalition is incomplete")

    participant = next(
        (
            row
            for row in episode.get("participants") or []
            if row.get("policy_version_id") == policy_version_id
        ),
        None,
    )
    if participant is None:
        violations.append(f"{role} {episode_request_id}: policy identity is absent")
        position = None
    else:
        position = participant.get("position")
        if participant.get("player_id") != ODIN_PLAYER_ID:
            violations.append(f"{role} {episode_request_id}: Odin player identity drifted")
        if position != ODIN_SLOT:
            violations.append(f"{role} {episode_request_id}: Odin seat drifted")
    if not odin:
        violations.append(f"{role} {episode_request_id}: Odin decisions are absent")

    rejected = [
        {
            "turn": row.get("turnNumber"),
            "action_id": row.get("selectedLegalActionId"),
        }
        for row in odin
        if not semantic.accepted(row)
    ]
    all_holds = [
        {
            "turn": row.get("turnNumber"),
            "action_id": row.get("selectedLegalActionId"),
            "reason": row.get("reason"),
            "markers": sorted(semantic.marker_values(row)),
        }
        for row in odin
        if normalized_kind(row.get("selectedActionKind")) == "hold"
    ]
    unexplained_holds = [
        hold
        for row in odin
        if (
            hold := semantic.unexplained_hold(row, registry, "odin")
        ) is not None
    ]
    harmful, endgame_exemptions, unresolved = semantic.scan_candidate_harm(
        odin,
        contract,
        registry,
    )
    execution_conflicts, executed_harm, execution_unresolved = (
        audit_submitted_execution(odin, registry, semantic)
    )
    marker_counts = {}
    route_executions = 0
    for row in odin:
        for marker in semantic.marker_values(row):
            marker_counts[marker] = marker_counts.get(marker, 0) + 1
        route_executions += bool(
            semantic.marker_values(row) & ROUTE_MARKERS
        )
    degraded = [
        row.get("turnNumber") for row in odin if semantic.planner_degraded(row)
    ]
    if role == "candidate":
        if rejected:
            violations.append(f"{role} {episode_request_id}: rejected decisions")
        if all_holds:
            violations.append(f"{role} {episode_request_id}: selected hold actions")
        if harmful:
            violations.append(f"{role} {episode_request_id}: Odin harmed K1Z")
        if unresolved:
            violations.append(
                f"{role} {episode_request_id}: harmful target was unresolved"
            )
        if endgame_exemptions:
            violations.append(
                f"{role} {episode_request_id}: disabled K1Z endgame path executed"
            )
        if execution_conflicts:
            violations.append(
                f"{role} {episode_request_id}: selected/submitted intent conflict"
            )
        if executed_harm:
            violations.append(
                f"{role} {episode_request_id}: submitted intent harmed K1Z"
            )
        if execution_unresolved:
            violations.append(
                f"{role} {episode_request_id}: submitted harmful target was unresolved"
            )

    score = next(
        (
            row.get("score")
            for row in episode.get("scores") or []
            if row.get("policy_version_id") == policy_version_id
        ),
        None,
    )
    player = result_player(replay, position)
    return (
        {
            "episode_id": episode_request_id,
            "runtime_episode_id": episode.get("episode_id"),
            "replay_sha256": digest_bytes(raw),
            "winner_player_id": winning_player_id(episode),
            "candidate_policy_version_id": policy_version_id,
            "seat": position,
            "map": (episode.get("game_config") or {}).get("map"),
            "score": score,
            "won": score == 1,
            "final_tiles": player.get("tilesOwned", player.get("tiles_owned")),
            "decision_count": len(odin),
            "accepted_decisions": len(odin) - len(rejected),
            "marker_counts": dict(sorted(marker_counts.items())),
            "marker_executions": route_executions,
            "holds": len(all_holds),
            "hold_details": all_holds,
            "unexplained_hold_details": unexplained_holds,
            "rejections": len(rejected),
            "rejection_details": rejected,
            "k1z_harm": (
                len(harmful)
                + len(unresolved)
                + len(endgame_exemptions)
                + len(execution_conflicts)
                + len(executed_harm)
                + len(execution_unresolved)
            ),
            "k1z_harm_details": harmful,
            "unresolved_harmful_targets": unresolved,
            "execution_conflicts": execution_conflicts,
            "submitted_k1z_harm": executed_harm,
            "submitted_unresolved_harmful_targets": execution_unresolved,
            "planner_degradation": len(degraded),
        },
        violations,
    )


def validate_request(
    role: str,
    request: dict,
    episodes: list[dict],
    expected_roster: list[str],
) -> list[str]:
    violations = []
    if request.get("status") != "completed":
        violations.append(f"{role} request status is not completed")
    if request.get("completed_count") != 4 or request.get("failed_count") != 0:
        violations.append(f"{role} transport did not complete 4/4 cleanly")
    if request.get("variant_id") != VARIANT:
        violations.append(f"{role} variant identity drifted")
    if len(episodes) != 4:
        violations.append(f"{role} request did not return exactly four episodes")
    observed_ids = [str(row.get("id") or "") for row in episodes]
    if len(set(observed_ids)) != len(observed_ids) or not all(observed_ids):
        violations.append(f"{role} episode identities are missing or duplicated")
    for episode in episodes:
        if episode_roster(episode) != expected_roster:
            violations.append(
                f"{role} {episode.get('id')}: hosted roster identity drifted"
            )
    return violations


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    semantic = load_semantics(root)
    body_paths = {
        "candidate": root
        / "experiments"
        / "request-qd1n-odc1-rci2-hosted-candidate-4x.json",
        "parent": root
        / "experiments"
        / "request-qd1n-odc1-rci2-hosted-parent-4x.json",
    }
    bodies = {role: json.loads(path.read_text()) for role, path in body_paths.items()}
    violations = []
    for role, path in body_paths.items():
        if digest_file(path) != EXPECTED_BODY_HASHES[role]:
            violations.append(f"{role} request body hash drifted")

    candidate_roster = request_roster(bodies["candidate"])
    parent_roster = request_roster(bodies["parent"])
    changed_slots = [
        index
        for index, pair in enumerate(zip(candidate_roster, parent_roster))
        if pair[0] != pair[1]
    ]
    if (
        len(candidate_roster) != 12
        or len(parent_roster) != 12
        or changed_slots != [ODIN_SLOT]
        or candidate_roster[ODIN_SLOT] != CANDIDATE_POLICY_VERSION
        or parent_roster[ODIN_SLOT] != PARENT_POLICY_VERSION
    ):
        violations.append("matched request bodies differ outside the Odin policy slot")

    requests = {
        "candidate": coworld_json("xp-request", "get", CANDIDATE_REQUEST),
        "parent": coworld_json("xp-request", "get", PARENT_REQUEST),
    }
    episode_sets = {
        "candidate": coworld_json("xp-request", "episodes", CANDIDATE_REQUEST),
        "parent": coworld_json("xp-request", "episodes", PARENT_REQUEST),
    }
    violations.extend(
        validate_request("candidate", requests["candidate"], episode_sets["candidate"], candidate_roster)
    )
    violations.extend(
        validate_request("parent", requests["parent"], episode_sets["parent"], parent_roster)
    )

    cache = Path("/private/tmp/proxywar-odc1-rci2-hosted-replays")
    audits = {"candidate": [], "parent": []}
    for role, policy_version_id in (
        ("candidate", CANDIDATE_POLICY_VERSION),
        ("parent", PARENT_POLICY_VERSION),
    ):
        for episode in episode_sets[role]:
            audit, episode_violations = audit_episode(
                episode,
                policy_version_id,
                role,
                semantic,
                cache,
            )
            audits[role].append(audit)
            violations.extend(episode_violations)

    candidate_degradation = sum(
        row.get("planner_degradation", 0) for row in audits["candidate"]
    )
    parent_degradation = sum(
        row.get("planner_degradation", 0) for row in audits["parent"]
    )
    planner_pass = candidate_degradation == 0
    if not planner_pass:
        violations.append("candidate planner degraded in the hosted gate")
    for row in audits["candidate"]:
        row["planner_degradation_passed"] = planner_pass

    if len(audits["candidate"]) != 4 or not all(
        row.get("won") for row in audits["candidate"]
    ):
        violations.append("Odin did not win all four hosted candidate episodes")
    if sum(row.get("marker_executions", 0) for row in audits["candidate"]) < 1:
        violations.append("ODC1 mechanism had zero hosted reach")
    replay_hashes = [
        row.get("replay_sha256")
        for role in ("candidate", "parent")
        for row in audits[role]
        if row.get("replay_sha256")
    ]
    if len(replay_hashes) != len(set(replay_hashes)):
        violations.append("hosted replay hashes are not distinct")

    normalized_roster = list(parent_roster)
    normalized_roster[ODIN_SLOT] = "<ODIN_CANDIDATE_OR_PARENT>"
    roster_sha = digest_bytes(
        json.dumps(normalized_roster, separators=(",", ":")).encode()
    )
    report = {
        "schema_version": 1,
        "arm": "odc1",
        "gate": "hosted_4_of_4",
        "verdict": "PASS_HOSTED" if not violations else "STOP_HOSTED",
        "candidate_source_commit": CANDIDATE_SOURCE_COMMIT,
        "candidate_image_id": CANDIDATE_IMAGE_ID,
        "candidate_policy_version_id": CANDIDATE_POLICY_VERSION,
        "request_id": CANDIDATE_REQUEST,
        "baseline_request_id": PARENT_REQUEST,
        "roster_sha256": roster_sha,
        "variant": VARIANT,
        "episodes": audits["candidate"],
        "baseline_episodes": audits["parent"],
        "summary": {
            "candidate_wins": sum(bool(row.get("won")) for row in audits["candidate"]),
            "parent_wins": sum(bool(row.get("won")) for row in audits["parent"]),
            "candidate_marker_executions": sum(
                row.get("marker_executions", 0) for row in audits["candidate"]
            ),
            "candidate_holds": sum(row.get("holds", 0) for row in audits["candidate"]),
            "candidate_rejections": sum(
                row.get("rejections", 0) for row in audits["candidate"]
            ),
            "candidate_k1z_harm": sum(
                row.get("k1z_harm", 0) for row in audits["candidate"]
            ),
            "candidate_planner_degradation": candidate_degradation,
            "parent_planner_degradation": parent_degradation,
        },
        "violations": violations,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if not violations else 1


if __name__ == "__main__":
    raise SystemExit(main())

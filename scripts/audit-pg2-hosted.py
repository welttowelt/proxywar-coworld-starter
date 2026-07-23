#!/usr/bin/env python3
"""Fail-closed hosted replay audit for the PG2 diagnostic gate."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import subprocess
import urllib.request
from pathlib import Path


EXPECTED_REQUEST = "xreq_281aefb8-4d52-4d7c-ac81-9dd7ebf93a27"
EXPECTED_POLICY_VERSION = "32ce69ba-9959-4172-bb45-e2a84c55bced"
EXPECTED_EPISODES = {
    "ereq_728fbb6c-4944-4691-badb-91150c82a6f3",
    "ereq_78892e2b-32f4-4214-b2b2-2c7e82524c3d",
    "ereq_7f618562-8305-4ce0-8a7e-b7437d4fa2c8",
    "ereq_7b247383-ecd9-4526-8d5f-cba9d904ec56",
}
K1Z_NAMES = {
    "k1z odin free",
    "k1z hrafn",
    "k1z juryoku koku",
    "k1z katanasan",
}


def load_semantics(root: Path):
    path = root / "scripts" / "audit-pg2-matrix-pair.py"
    spec = importlib.util.spec_from_file_location("pg2_pair_audit", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def coworld_json(*args: str):
    completed = subprocess.run(
        ["uvx", "--from", "coworld==0.1.28", "coworld", *args, "--json"],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


def replay_bytes(url: str) -> bytes:
    if not url.startswith("https://softmax-public.s3.amazonaws.com/replays/"):
        raise ValueError(f"replay URL is outside the allowlist: {url}")
    with urllib.request.urlopen(url, timeout=120) as response:
        data = response.read(64 * 1024 * 1024 + 1)
    if len(data) > 64 * 1024 * 1024:
        raise ValueError("replay exceeds 64 MiB")
    return data


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("request_id")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    semantic = load_semantics(root)
    violations: list[str] = []

    if args.request_id != EXPECTED_REQUEST:
        violations.append("hosted request identity drifted")
    request = coworld_json("xp-request", "get", args.request_id)
    episodes = coworld_json("xp-request", "episodes", args.request_id)
    observed_ids = {episode.get("id") for episode in episodes}
    if request.get("status") != "completed":
        violations.append(f"request status is {request.get('status')!r}, not completed")
    if request.get("completed_count") != 4 or request.get("failed_count") != 0:
        violations.append("hosted transport did not complete 4/4 with zero failures")
    if request.get("variant_id") != "tournament-12p-pangaea":
        violations.append("hosted variant identity drifted")
    if observed_ids != EXPECTED_EPISODES:
        violations.append("hosted episode identities drifted")

    cache = root / "data" / "cache" / "replays"
    cache.mkdir(parents=True, exist_ok=True)
    episode_audits = []
    for episode in episodes:
        if episode.get("status") != "completed" or not episode.get("replay_url"):
            violations.append(f"{episode.get('id')}: completed replay is unavailable")
            continue
        raw = replay_bytes(episode["replay_url"])
        destination = cache / f"{episode['episode_id']}.replay"
        destination.write_bytes(raw)
        replay = json.loads(raw)
        decisions = [
            json.loads(line)
            for line in replay.get("inlineRunArtifacts", {}).get("decisions.jsonl", "").splitlines()
            if line.strip()
        ]
        odin = [
            row for row in decisions
            if semantic.canonical(row.get("username")) == "k1z odin free"
        ]
        identities = semantic.player_ids(decisions)
        k1z_identity = {
            name: player_id for name, player_id in identities.items() if name in K1Z_NAMES
        }
        ally_ids = {
            player_id for name, player_id in k1z_identity.items() if name != "k1z odin free"
        }
        rejected = [
            {"turn": row.get("turnNumber"), "action_id": row.get("selectedLegalActionId")}
            for row in odin if (row.get("result") or {}).get("accepted") is not True
        ]
        holds = semantic.classify_holds(odin, ally_ids)
        harmful = []
        for row in odin:
            if row.get("selectedActionKind") not in semantic.HARMFUL_KINDS:
                continue
            action_target_id = semantic.target_id(row)
            target_name = semantic.canonical((row.get("selectedActionMetadata") or {}).get("targetName"))
            if row.get("selectedActionKind") == "embargo_all" or action_target_id in ally_ids or target_name in K1Z_NAMES - {"k1z odin free"}:
                harmful.append({
                    "turn": row.get("turnNumber"),
                    "kind": row.get("selectedActionKind"),
                    "action_id": row.get("selectedLegalActionId"),
                    "target_name": target_name or None,
                })
        coalition_harm = semantic.scan_k1z_harm(
            [row for row in decisions if semantic.canonical(row.get("username")) in K1Z_NAMES],
            k1z_identity,
        )
        marker_count = sum(semantic.has_marker(row) for row in odin)
        marker_violations = semantic.marker_scope_violations(odin)
        participant = next(
            (item for item in episode.get("participants", []) if item.get("policy_version_id") == EXPECTED_POLICY_VERSION),
            None,
        )
        position = participant.get("position") if participant else None
        replay_result = (replay.get("results", {}).get("players") or [])[position] if isinstance(position, int) else {}
        score = next(
            (item.get("score") for item in episode.get("scores", []) if item.get("policy_version_id") == EXPECTED_POLICY_VERSION),
            None,
        )
        audit = {
            "episode_request_id": episode.get("id"),
            "episode_id": episode.get("episode_id"),
            "replay_sha256": hashlib.sha256(raw).hexdigest(),
            "decision_count": len(odin),
            "accepted_decisions": len(odin) - len(rejected),
            "rejected_decisions": rejected,
            "unexplained_holds": holds,
            "marker_count": marker_count,
            "marker_scope_violations": marker_violations,
            "k1z_harmful_actions": harmful,
            "coalition_harmful_actions": coalition_harm,
            "score": score,
            "won": score == 1,
            "final_tiles": replay_result.get("tilesOwned", replay_result.get("tiles_owned")),
        }
        episode_audits.append(audit)
        if participant is None:
            violations.append(f"{episode.get('id')}: PG2 policy identity is absent")
        if not odin:
            violations.append(f"{episode.get('id')}: Odin decisions are absent")
        if marker_count < 1:
            violations.append(f"{episode.get('id')}: PG2 mechanism did not reach")
        if rejected:
            violations.append(f"{episode.get('id')}: Odin had rejected decisions")
        if holds:
            violations.append(f"{episode.get('id')}: Odin had unexplained holds")
        if marker_violations:
            violations.append(f"{episode.get('id')}: PG2 marker guard failed")
        if harmful:
            violations.append(f"{episode.get('id')}: Odin harmed a K1Z partner")
        if coalition_harm:
            violations.append(f"{episode.get('id')}: K1Z coalition harm was observed")

    report = {
        "schema_version": 1,
        "arm": "pg2",
        "gate": "hosted_4_of_4",
        "request_id": args.request_id,
        "request_status": request.get("status"),
        "completed_episodes": len(episode_audits),
        "wins": sum(row["won"] for row in episode_audits),
        "marker_reach": sum(row["marker_count"] > 0 for row in episode_audits),
        "verdict": "PASS" if not violations else "STOP",
        "violations": violations,
        "episodes": episode_audits,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if not violations else 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Fail closed unless the four-run NB1 local screen clears its declared gate."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import re
import sys
import unicodedata
from pathlib import Path

TARGET = "k1z odin free"
ALLIES = {"k1z hrafn", "k1z juryoku koku", "k1z katanasan"}
PARENT_IMAGE = "proxywar-agent-llm:qd1n-v89-exact-amd64"
RUNS = (
    ("Pangaea", "candidate"), ("Pangaea", "parent"),
    ("World", "candidate"), ("World", "parent"),
)
HARMFUL = {
    "attack", "boat", "nuke", "embargo", "embargo_all", "target_player",
    "break_alliance", "alliance_reject", "move_warship", "warship",
}
TACTICAL = {
    "attack", "boat", "build", "upgrade_structure", "nuke", "move_warship",
    "warship", "retreat", "boat_retreat",
}
TARGET_RE = re.compile(
    r"^(?:attack|target(?:_player)?|embargo|alliance(?:_[a-z]+)?|quick_chat|"
    r"emoji|donate_(?:troops|gold)|boat|nuke|warship|move_warship):([^:]+)"
)
BOAT_RE = re.compile(r"^boat:([^:]+):([0-9]+(?:\.[0-9]+)?)$")


def canon(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).lower()
    return re.sub(r"\s+", " ", re.sub(r"[_-]+", " ", text)).strip()


def number(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def read_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def marked(row: dict) -> bool:
    fields = [row.get("policyMarker"), row.get("reason")]
    markers = row.get("policyMarkers")
    fields.extend(markers if isinstance(markers, list) else [markers])
    return any(
        "nb1" in re.split(r"[^a-z0-9]+", str(field).lower()) for field in fields
    )


def action_target(row: dict) -> str | None:
    metadata = row.get("selectedActionMetadata") or {}
    submitted = (row.get("result") or {}).get("submittedIntent") or {}
    direct = (
        metadata.get("targetID") or metadata.get("recipientID")
        or metadata.get("playerID") or submitted.get("targetID")
    )
    if direct:
        return str(direct).lower()
    match = TARGET_RE.match(str(row.get("selectedLegalActionId") or ""))
    return match.group(1).lower() if match else None


def neutral_boat(row: dict) -> bool:
    metadata = row.get("selectedActionMetadata") or {}
    return (
        row.get("selectedActionKind") == "boat"
        and not metadata.get("targetID")
        and (
            metadata.get("expansion") is True
            or canon(metadata.get("targetName")) == "terra nullius"
        )
    )


def own_tiles(row: dict) -> float | None:
    affordances = row.get("tacticalAffordances") or {}
    for section in ("openingExpansionTempo", "frontierConversionTiming"):
        value = number((affordances.get(section) or {}).get("ownTiles"))
        if value is not None:
            return value
    value = number((row.get("auditBefore") or {}).get("tilesOwned"))
    if value is not None:
        return value
    match = re.search(r"\bown=(\d+)\s+tiles\b", str(row.get("observationSummary") or ""))
    return float(match.group(1)) if match else None


def player_ids(rows: list[dict]) -> dict[str, str]:
    found = {}
    for row in rows:
        audit = row.get("auditBefore") or row.get("auditAfter") or {}
        if audit.get("playerID"):
            found[canon(row.get("username"))] = str(audit["playerID"]).lower()
    return found


def hold_failures(rows: list[dict], ally_ids: set[str]) -> list[dict]:
    failures = []
    for row in rows:
        if row.get("selectedActionKind") != "hold":
            continue
        legal = row.get("legalActionIDsByKind")
        if legal is None:
            failures.append({"turn": row.get("turnNumber"), "alternatives": None})
            continue
        alternatives = []
        for kind, identifiers in legal.items():
            if kind not in TACTICAL:
                continue
            for identifier in identifiers or []:
                action_id = str(identifier)
                match = TARGET_RE.match(action_id)
                target = match.group(1).lower() if match else None
                if kind in {"attack", "boat", "nuke", "warship", "move_warship"} \
                        and target in ally_ids:
                    continue
                if kind == "build" and "defense post" in action_id.lower():
                    continue
                alternatives.append({"kind": kind, "id": action_id})
        if alternatives:
            failures.append({"turn": row.get("turnNumber"), "alternatives": alternatives})
    return failures


def harmful_actions(rows: list[dict], identities: dict[str, str]) -> list[dict]:
    ally_ids = {identities[name] for name in ALLIES if name in identities}
    failures = []
    for row in rows:
        kind = row.get("selectedActionKind")
        if kind not in HARMFUL or neutral_boat(row):
            continue
        metadata = row.get("selectedActionMetadata") or {}
        target_id = action_target(row)
        target_name = canon(metadata.get("targetName"))
        if kind == "embargo_all" or target_id in ally_ids or target_name in ALLIES:
            failures.append({
                "turn": row.get("turnNumber"),
                "kind": kind,
                "action_id": row.get("selectedLegalActionId"),
                "target_id": target_id,
                "target_name": target_name or None,
            })
    return failures


def marker_failures(row: dict) -> list[str]:
    failures = []
    selected = str(row.get("selectedLegalActionId") or "")
    legal = [str(value) for value in row.get("legalActionIDs") or []]
    metadata = row.get("selectedActionMetadata") or {}
    match = BOAT_RE.fullmatch(selected)
    destination = match.group(1) if match else None
    percent = number(match.group(2)) if match else None
    if (row.get("result") or {}).get("accepted") is not True:
        failures.append("not accepted")
    if not neutral_boat(row):
        failures.append("not a neutral boat")
    if percent != 16 or number(metadata.get("troopPercent")) != 16:
        failures.append("not the 16-percent form")
    fraction = number(metadata.get("troopPercentage"))
    if fraction is not None and abs(fraction - 0.16) > 1e-9:
        failures.append("troopPercentage is not 0.16")
    if selected not in legal:
        failures.append("selected 16-percent form was not legal")
    eight_legal = any(
        (candidate := BOAT_RE.fullmatch(action_id))
        and candidate.group(1) == destination
        and number(candidate.group(2)) == 8
        for action_id in legal
    )
    if not eight_legal:
        failures.append("same-destination 8-percent form was not legal")

    affordances = row.get("tacticalAffordances") or {}
    banking = affordances.get("transportTroopBanking") or {}
    opening = affordances.get("openingExpansionTempo") or {}
    frontier = affordances.get("frontierConversionTiming") or {}
    ratio = number(banking.get("troopRatio"))
    if ratio is None or ratio < 0.87:
        failures.append("troop ratio was absent or below 0.87")
    threats = (
        banking.get("incomingThreatTroops"), banking.get("incomingThreatRatio"),
        opening.get("incomingThreatRatio"), frontier.get("incomingThreatRatio"),
    )
    if any(number(value) != 0 for value in threats):
        failures.append("current threat telemetry was absent or nonzero")
    threat = re.search(
        r"(?:^|,\s*)threat=([0-9]+(?:\.[0-9]+)?)",
        str(row.get("strategicSummary") or ""),
    )
    if not threat or number(threat.group(1)) != 0:
        failures.append("strategic threat was absent or nonzero")
    return failures


def audit_run(map_name: str, role: str, directory: Path) -> tuple[dict, list[dict], dict, list[str]]:
    for name in ("config.json", "results.json", "replay"):
        if not (directory / name).is_file():
            raise ValueError(f"{directory}: missing {name}")
    config, results = read_json(directory / "config.json"), read_json(directory / "results.json")
    replay_path, replay = directory / "replay", read_json(directory / "replay")
    rows = []
    raw_decisions = (replay.get("inlineRunArtifacts") or {}).get("decisions.jsonl", "")
    for line_number, line in enumerate(raw_decisions.splitlines(), 1):
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as error:
            raise ValueError(f"{replay_path}:decisions:{line_number}: {error}") from error
    odin = [row for row in rows if canon(row.get("username")) == TARGET]
    if not odin:
        raise ValueError(f"{directory}: no K1Z odin free decisions")
    identities = player_ids(rows)
    ally_ids = {identities[name] for name in ALLIES if name in identities}
    rejected = [
        {"turn": row.get("turnNumber"), "action_id": row.get("selectedLegalActionId")}
        for row in odin if (row.get("result") or {}).get("accepted") is not True
    ]
    holds = [row for row in odin if row.get("selectedActionKind") == "hold"]
    unexplained = hold_failures(odin, ally_ids)
    harmful = harmful_actions(odin, identities)
    markers = [row for row in odin if marked(row)]
    scope = [
        {"turn": row.get("turnNumber"), "action_id": row.get("selectedLegalActionId"),
         "failures": marker_failures(row)}
        for row in markers
    ]
    scope = [entry for entry in scope if entry["failures"]]
    player = next(
        (entry for entry in results.get("players", []) if canon(entry.get("name")) == TARGET),
        None,
    )
    if player is None:
        raise ValueError(f"{directory}: K1Z odin free missing from results")

    violations = []
    if canon(config.get("map")) != canon(map_name):
        violations.append(f"effective map is {config.get('map')!r}, expected {map_name}")
    replay_config = replay.get("config") or {}
    if any(replay_config.get(key) != config.get(key) for key in ("map", "seed")):
        violations.append("replay map or seed differs from effective config")
    if results.get("decision_count") != len(rows):
        violations.append("results decision count differs from replay")
    accepted = sum((row.get("result") or {}).get("accepted") is True for row in rows)
    if results.get("accepted_decision_count") != accepted:
        violations.append("results accepted count differs from replay")
    missing = sorted(({TARGET} | ALLIES) - set(identities))
    if missing:
        violations.append(f"K1Z identity map is incomplete: {missing}")
    if rejected:
        violations.append("rejected or unconfirmed decision")
    if unexplained:
        violations.append("unexplained hold")
    if harmful:
        violations.append("harmful K1Z action")
    if scope:
        violations.append("NB1 marker scope violation")
    if role == "candidate" and not markers:
        violations.append("candidate NB1 reach was zero")
    if role == "parent" and markers:
        violations.append("exact parent emitted NB1")
    final_score, final_tiles = number(player.get("score")), number(player.get("tiles_owned"))
    if final_score is None or final_tiles is None:
        violations.append("final score or tiles are unavailable")
    report = {
        "map": map_name, "role": role, "directory": str(directory),
        "seed": config.get("seed"),
        "roster": [entry.get("name") for entry in config.get("players", [])],
        "replay_sha256": digest(replay_path),
        "decisions": len(odin), "accepted": len(odin) - len(rejected),
        "rejected_or_unconfirmed": rejected,
        "holds": len(holds), "unexplained_holds": unexplained,
        "markers": len(markers), "marker_scope_violations": scope,
        "retreats": sum(
            row.get("selectedActionKind") in {"retreat", "boat_retreat"} for row in odin
        ),
        "k1z_harm": harmful, "final_score": final_score,
        "final_tiles": final_tiles, "survived": player.get("is_alive"),
    }
    return report, odin, config, violations


def tile_window(candidate: list[dict], parent: list[dict]) -> dict | None:
    left = [row for row in candidate if row.get("selectedActionKind") != "spawn"]
    right = [row for row in parent if row.get("selectedActionKind") != "spawn"]
    start = next((index for index, row in enumerate(left) if marked(row)), None)
    if start is None:
        return None
    turn = left[start].get("turnNumber")
    control = next((index for index, row in enumerate(right) if row.get("turnNumber") == turn), None)
    if control is None or start + 10 >= len(left) or control + 10 >= len(right):
        return {"first_marker_turn": turn, "error": "matched +10-decision window unavailable"}
    values = own_tiles(left[start]), own_tiles(left[start + 10]), \
        own_tiles(right[control]), own_tiles(right[control + 10])
    if any(value is None for value in values):
        return {"first_marker_turn": turn, "error": "tile telemetry unavailable"}
    candidate_gain, parent_gain = values[1] - values[0], values[3] - values[2]
    return {
        "first_marker_turn": turn,
        "candidate_start_tiles": values[0], "candidate_plus_10_tiles": values[1],
        "candidate_gain": candidate_gain,
        "parent_start_tiles": values[2], "parent_plus_10_tiles": values[3],
        "parent_gain": parent_gain, "gain_delta": candidate_gain - parent_gain,
    }


def run_spec(value: str) -> tuple[str, str, Path]:
    fields = value.split(":", 2)
    map_name = {"pangaea": "Pangaea", "world": "World"}.get(fields[0].lower()) \
        if len(fields) == 3 else None
    role = fields[1].lower() if len(fields) == 3 else None
    if map_name is None or role not in {"candidate", "parent"} or not fields[2]:
        raise argparse.ArgumentTypeError("--run must be Pangaea|World:candidate|parent:DIR")
    return map_name, role, Path(fields[2])


def receipt_failures(root: Path, receipt: dict, configs: dict) -> list[str]:
    failures = []
    if receipt.get("schema_version") != 1 or receipt.get("arm") != "nb1":
        return ["screen manifest identity is invalid"]
    images = receipt.get("images") or {}
    if receipt.get("target_player") != "K1Z odin free":
        failures.append("screen target identity drifted")
    if images.get("parent") != PARENT_IMAGE:
        failures.append("exact v89 parent image drifted")
    if not images.get("candidate") or images.get("candidate") == images.get("parent"):
        failures.append("candidate image identity is invalid")
    manifest = receipt.get("canonical_manifest") or {}
    manifest_path = Path(manifest.get("path") or "")
    canonical_manifest = None
    if not manifest_path.is_file() or digest(manifest_path) != manifest.get("sha256"):
        failures.append("canonical Coworld manifest hash drifted")
    else:
        canonical_manifest = read_json(manifest_path)
    entries = {(row.get("map"), row.get("role")): row for row in receipt.get("runs", [])}
    if set(entries) != set(RUNS):
        return failures + ["screen manifest does not declare exactly four expected runs"]
    jobs = {}
    for key in RUNS:
        entry = entries[key]
        job_path, template = Path(entry.get("job") or ""), Path(entry.get("template") or "")
        if not job_path.is_file() or digest(job_path) != entry.get("job_sha256"):
            failures.append(f"{key}: prepared job hash drifted")
            continue
        if not template.is_file() or digest(template) != entry.get("template_sha256"):
            failures.append(f"{key}: source template hash drifted")
        job, jobs[key] = read_json(job_path), read_json(job_path)
        if canonical_manifest is not None and job.get("manifest") != canonical_manifest:
            failures.append(f"{key}: embedded manifest differs from canonical")
        effective = copy.deepcopy(configs[key])
        effective.pop("tokens", None)
        if effective != job.get("game_config"):
            failures.append(f"{key}: effective config differs from prepared job")
        names = [canon(row.get("name")) for row in job.get("game_config", {}).get("players", [])]
        if names.count(TARGET) != 1:
            failures.append(f"{key}: target identity is absent or duplicated")
        elif job.get("players", [])[names.index(TARGET)].get("image") != images.get(key[1]):
            failures.append(f"{key}: target image drifted")
        if Path(entry.get("output") or "") != root / f"{key[0].lower()}-{key[1]}":
            failures.append(f"{key}: output path drifted")
    for map_name in ("Pangaea", "World"):
        left, right = copy.deepcopy(jobs.get((map_name, "candidate"))), \
            copy.deepcopy(jobs.get((map_name, "parent")))
        if left is None or right is None:
            continue
        for job in (left, right):
            names = [canon(row.get("name")) for row in job["game_config"]["players"]]
            job["players"][names.index(TARGET)]["image"] = "<TARGET>"
        if left != right:
            failures.append(f"{map_name}: jobs differ outside target image")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Audit the four-run NB1 screen; exit 0 only on gate PASS."
    )
    parser.add_argument("root", nargs="?", type=Path, help="screen output root")
    parser.add_argument("--run", action="append", type=run_spec, default=[],
                        help="fixture mode: MAP:ROLE:DIR (provide all four)")
    parser.add_argument("--output", type=Path, help="write JSON report")
    args = parser.parse_args()
    if (args.root is None) == (not args.run):
        parser.error("provide either ROOT or four --run values")
    if args.root is not None:
        receipt_path = args.root / "screen-manifest.json"
        if not receipt_path.is_file():
            raise ValueError(f"{receipt_path}: missing")
        receipt = read_json(receipt_path)
        specs = [(map_name, role, args.root / f"{map_name.lower()}-{role}")
                 for map_name, role in RUNS]
    else:
        receipt, specs = None, args.run
        if len(specs) != 4 or {(m, r) for m, r, _ in specs} != set(RUNS):
            parser.error("fixture mode requires candidate and parent for both maps")
        specs.sort(key=lambda item: RUNS.index((item[0], item[1])))

    reports, decisions, configs, violations = {}, {}, {}, []
    for map_name, role, directory in specs:
        key = map_name, role
        report, rows, config, failures = audit_run(map_name, role, directory)
        reports[key], decisions[key], configs[key] = report, rows, config
        violations.extend(f"{map_name} {role}: {failure}" for failure in failures)
    for map_name in ("Pangaea", "World"):
        left, right = copy.deepcopy(configs[(map_name, "candidate")]), \
            copy.deepcopy(configs[(map_name, "parent")])
        left.pop("tokens", None)
        right.pop("tokens", None)
        if left != right:
            violations.append(f"{map_name}: candidate-parent config drift")
        if reports[(map_name, "candidate")]["roster"] != reports[(map_name, "parent")]["roster"]:
            violations.append(f"{map_name}: candidate-parent roster drift")
    if receipt is None:
        violations.append("screen manifest unavailable in fixture mode")
    else:
        violations.extend(receipt_failures(args.root, receipt, configs))

    windows = {
        map_name: tile_window(
            decisions[(map_name, "candidate")], decisions[(map_name, "parent")]
        )
        for map_name in ("Pangaea", "World")
    }
    for map_name, window in windows.items():
        if window is None or window.get("error"):
            violations.append(f"{map_name}: first-marker +10-decision window unavailable")
    tile_delta = sum(window["gain_delta"] for window in windows.values()) \
        if all(window is not None and "gain_delta" in window for window in windows.values()) \
        else None
    if tile_delta is None or tile_delta <= 0:
        violations.append("combined first-launch +10-decision tile-gain delta was not positive")
    candidate_retreats = sum(reports[(name, "candidate")]["retreats"]
                             for name in ("Pangaea", "World"))
    parent_retreats = sum(reports[(name, "parent")]["retreats"]
                          for name in ("Pangaea", "World"))
    retreat_delta = candidate_retreats - parent_retreats
    if retreat_delta > 0:
        violations.append("candidate retreat count increased")
    scores = [reports[(name, role)]["final_score"]
              for name in ("Pangaea", "World") for role in ("candidate", "parent")]
    score_delta = sum(
        reports[(name, "candidate")]["final_score"]
        - reports[(name, "parent")]["final_score"]
        for name in ("Pangaea", "World")
    ) if all(score is not None for score in scores) else None
    if score_delta is None or score_delta <= 0:
        violations.append("combined paired score was not positive")

    totals = {
        "candidate_markers": sum(reports[(name, "candidate")]["markers"]
                                 for name in ("Pangaea", "World")),
        "parent_markers": sum(reports[(name, "parent")]["markers"]
                              for name in ("Pangaea", "World")),
        "combined_first_launch_plus_10_tile_gain_delta": tile_delta,
        "candidate_retreats": candidate_retreats,
        "parent_retreats": parent_retreats, "retreat_delta": retreat_delta,
        "combined_paired_score_delta": score_delta,
        "candidate_final_tiles": sum(reports[(name, "candidate")]["final_tiles"] or 0
                                     for name in ("Pangaea", "World")),
        "parent_final_tiles": sum(reports[(name, "parent")]["final_tiles"] or 0
                                  for name in ("Pangaea", "World")),
    }
    report = {
        "schema_version": 1, "arm": "nb1", "gate": "local_two_pair_screen",
        "thresholds": {
            "candidate_reach_each_map": ">=1", "parent_reach": 0,
            "marker_scope_violations": 0, "unexplained_holds": 0,
            "rejected_or_unconfirmed": 0, "k1z_harm": 0,
            "combined_first_launch_plus_10_tile_gain_delta": ">0",
            "combined_retreat_delta": "<=0", "combined_paired_score_delta": ">0",
        },
        "totals": totals, "tile_windows": windows,
        "verdict": "PASS" if not violations else "STOP",
        "violations": violations, "runs": [reports[key] for key in RUNS],
    }
    encoded = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    return 0 if not violations else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
        print(f"audit error: {error}", file=sys.stderr)
        raise SystemExit(2)

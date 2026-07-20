#!/bin/bash
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_PATH="$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")"
readonly DEFAULT_MANIFEST="/Users/olifreuler/proxywar-coworld-starter/coworld/cow_15c39dab-eac1-4284-bf3e-bd723d4c2755/coworld_manifest.json"
readonly DEFAULT_LEASE="/Users/olifreuler/proxywar-coworld-starter/scripts/proxywar-runner-lease.sh"
readonly PARENT_IMAGE="proxywar-agent-llm:qd1n-v89-exact-amd64"
readonly COWORLD_VERSION="0.1.30"
readonly LABELS=(pangaea-candidate pangaea-parent world-candidate world-parent)

usage() {
  cat <<'EOF'
usage:
  run-nb1-two-pair-screen.sh --candidate-image IMAGE --output-root ABS_DIR
    [--manifest FILE] [--lease-script FILE] [--run-id ID]
    [--pangaea-seat 0|4] [--world-seat 0|4] [--prepare-only]

Builds four deterministic jobs from the known topology fixtures, freezes every
non-Odin seat to the exact-v89 surrogate, changes only K1Z odin free between
NB1 and exact v89, and runs the Pangaea/World candidate-parent screen under the
Odin lease. This is a causal local screen, not a real-opponent policy claim.
--prepare-only writes jobs and screen-manifest.json without running Coworld.
EOF
}

run_prepared() {
  local root="$1"
  local manifest="$2"
  local pids=()
  local label pid status=0

  cancel_children() {
    for pid in "${pids[@]:-}"; do
      kill "$pid" 2>/dev/null || true
    done
  }
  trap 'cancel_children; exit 130' HUP INT TERM

  for label in "${LABELS[@]}"; do
    uvx --from "coworld==$COWORLD_VERSION" coworld run-episode \
      "$manifest" "$root/jobs/$label.json" -o "$root/$label" \
      >"$root/logs/$label.log" 2>&1 &
    pids+=("$!")
  done
  for pid in "${pids[@]}"; do
    wait "$pid" || status=1
  done
  trap - HUP INT TERM
  return "$status"
}

if [[ "${1:-}" == "--execute-prepared" ]]; then
  [[ $# -eq 3 ]] || { usage >&2; exit 2; }
  run_prepared "$2" "$3"
  exit $?
fi

candidate_image=""
parent_image="$PARENT_IMAGE"
output_root=""
manifest="$DEFAULT_MANIFEST"
lease_script="$DEFAULT_LEASE"
run_id=""
pangaea_seat=0
world_seat=4
prepare_only=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --candidate-image) candidate_image="${2:-}"; shift 2 ;;
    --output-root) output_root="${2:-}"; shift 2 ;;
    --manifest) manifest="${2:-}"; shift 2 ;;
    --lease-script) lease_script="${2:-}"; shift 2 ;;
    --run-id) run_id="${2:-}"; shift 2 ;;
    --pangaea-seat) pangaea_seat="${2:-}"; shift 2 ;;
    --world-seat) world_seat="${2:-}"; shift 2 ;;
    --prepare-only) prepare_only=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -n "$candidate_image" ]] || { echo "--candidate-image is required" >&2; exit 2; }
[[ -n "$output_root" && "$output_root" == /* ]] ||
  { echo "--output-root must be an absolute path" >&2; exit 2; }
[[ "$candidate_image" != "$parent_image" ]] ||
  { echo "candidate and parent images must differ" >&2; exit 2; }
[[ "$pangaea_seat" == 0 || "$pangaea_seat" == 4 ]] ||
  { echo "--pangaea-seat must be 0 or 4" >&2; exit 2; }
[[ "$world_seat" == 0 || "$world_seat" == 4 ]] ||
  { echo "--world-seat must be 0 or 4" >&2; exit 2; }
[[ -f "$manifest" ]] || { echo "manifest not found: $manifest" >&2; exit 2; }
[[ ! -e "$output_root" ]] ||
  { echo "output root already exists: $output_root" >&2; exit 2; }

run_id="${run_id:-nb1-$(basename "$output_root")}"
[[ "$run_id" =~ ^[A-Za-z0-9._-]{1,80}$ ]] ||
  { echo "run id must match [A-Za-z0-9._-]{1,80}" >&2; exit 2; }

python3 - "$output_root" "$manifest" "$candidate_image" "$parent_image" \
  "$COWORLD_VERSION" "$pangaea_seat" "$world_seat" <<'PY'
import copy
import hashlib
import json
import sys
import unicodedata
from pathlib import Path

root, manifest_path = map(Path, sys.argv[1:3])
candidate_image, parent_image, coworld_version = sys.argv[3:6]
seats = {"pangaea": int(sys.argv[6]), "world": int(sys.argv[7])}
root.mkdir(parents=True)
(root / "jobs").mkdir()
(root / "logs").mkdir()

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def canonical(value):
    return " ".join(
        unicodedata.normalize("NFKC", str(value)).lower()
        .replace("_", " ").replace("-", " ").split()
    )

canonical_manifest = json.loads(manifest_path.read_text())
runs = []
jobs = {}
for map_key, map_name in (("pangaea", "Pangaea"), ("world", "World")):
    for role, image in (("candidate", candidate_image), ("parent", parent_image)):
        label = f"{map_key}-{role}"
        template = Path(
            f"/private/tmp/hrafn-dv1-{map_key}-seat{seats[map_key]}-"
            f"{role}-20260720.json"
        )
        if not template.is_file():
            raise SystemExit(f"template not found: {template}")
        job = json.loads(template.read_text())
        job["manifest"] = canonical_manifest
        names = [player["name"] for player in job["game_config"]["players"]]
        for index, name in enumerate(names):
            key = canonical(name)
            if key == "k1z odin free":
                job["players"][index]["image"] = image
            else:
                job["players"][index]["image"] = parent_image
            job["players"][index]["run"] = ["node", "/app/llm-player.mjs"]
        if names.count("K1Z odin free") != 1:
            raise SystemExit(f"{template}: expected one K1Z odin free seat")
        target = root / "jobs" / f"{label}.json"
        target.write_text(json.dumps(job, indent=2, sort_keys=True) + "\n")
        jobs[(map_key, role)] = job
        runs.append({
            "label": label,
            "map": map_name,
            "role": role,
            "template": str(template),
            "template_sha256": digest(template),
            "job": str(target),
            "job_sha256": digest(target),
            "output": str(root / label),
        })

for map_key in seats:
    left = copy.deepcopy(jobs[(map_key, "candidate")])
    right = copy.deepcopy(jobs[(map_key, "parent")])
    for job in (left, right):
        names = [canonical(row["name"]) for row in job["game_config"]["players"]]
        job["players"][names.index("k1z odin free")]["image"] = "<TARGET>"
    if left != right:
        raise SystemExit(f"{map_key}: candidate and parent jobs differ outside target image")

screen = {
    "schema_version": 1,
    "arm": "nb1",
    "target_player": "K1Z odin free",
    "coworld_version": coworld_version,
    "canonical_manifest": {
        "path": str(manifest_path),
        "sha256": digest(manifest_path),
    },
    "images": {
        "candidate": candidate_image,
        "parent": parent_image,
        "non_target_surrogate": parent_image,
    },
    "template_seats": seats,
    "runs": runs,
}
(root / "screen-manifest.json").write_text(
    json.dumps(screen, indent=2, sort_keys=True) + "\n"
)
print(root / "screen-manifest.json")
PY

if [[ "$prepare_only" -eq 1 ]]; then
  echo "prepared: $output_root"
  exit 0
fi

[[ -x "$lease_script" ]] ||
  { echo "runner lease script is not executable: $lease_script" >&2; exit 2; }
lease_args=("$lease_script" run odin "$run_id")
for label in "${LABELS[@]}"; do
  lease_args+=(--output "$output_root/$label")
done
lease_args+=(-- "$SCRIPT_PATH" --execute-prepared "$output_root" "$manifest")
"${lease_args[@]}"

python3 "$SCRIPT_DIR/audit-nb1-screen.py" \
  "$output_root" --output "$output_root/audit-nb1-screen.json"

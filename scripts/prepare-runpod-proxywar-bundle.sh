#!/usr/bin/env bash
set -euo pipefail

BASE_IMAGE='public.ecr.aws/q5f4m8t9/cogames@sha256:88d166c6c33609ec5b0dc1f70799001a1f1f34e1cd852ddbfc17a2eb43969ea1'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EXTRACTOR_SOURCE="$REPO_ROOT/scripts/extract_runpod_proxywar_bundle.py"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT="/private/tmp/proxywar-runpod-bundle-${STAMP}.tar.gz"
KEEP_STAGING=0
CHECK_ONLY=0
CANDIDATE_KEY='qd1n-gc2'
CANDIDATE_IMAGE='proxywar-agent-llm:qd1n-v89-gc2-amd64'
CANDIDATE_ID='sha256:593eedf2fa9dd7ee70c24800da6fedcbc203baf5b8310ca0185022be14207677'
CANDIDATE_ENTRYPOINT='llm-player.mjs'
MATCHED_SPEC_A=''
MATCHED_SPEC_A_SHA=''
MATCHED_SPEC_B=''
MATCHED_SPEC_B_SHA=''
MATCHED_SPECS_COMMIT=''

usage() {
  command cat <<'EOF'
Usage:
  bash scripts/prepare-runpod-proxywar-bundle.sh [options]

Options:
  --output <path.tar.gz>     Archive destination.
  --candidate-key <key>      Bundle key for the candidate (default: qd1n-gc2).
  --candidate-image <image>  Exact local candidate image reference.
  --candidate-id <sha256>    Expected Docker image ID for the candidate.
  --matched-spec-a <json>    Formal candidate-arm experiment spec.
  --matched-spec-a-sha <hex> Expected SHA-256 of the candidate-arm spec.
  --matched-spec-b <json>    Formal exact-parent experiment spec.
  --matched-spec-b-sha <hex> Expected SHA-256 of the exact-parent spec.
  --matched-specs-commit <id>  Git commit containing both formal specs.
  --keep-staging             Preserve the temporary bundle tree and print its path.
  --check-images             Verify exact local image identities without extracting.
  --help                     Print this help.

The command reads local Docker images only. It does not call RunPod, create a
pod, upload data, or use credentials. Candidate image identity is mandatory:
overriding its reference without the matching --candidate-id fails closed.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      [[ $# -ge 2 ]] || { command echo '--output requires a value' >&2; exit 2; }
      OUTPUT="$2"
      shift 2
      ;;
    --candidate-key)
      [[ $# -ge 2 ]] || { command echo '--candidate-key requires a value' >&2; exit 2; }
      CANDIDATE_KEY="$2"
      shift 2
      ;;
    --candidate-image)
      [[ $# -ge 2 ]] || { command echo '--candidate-image requires a value' >&2; exit 2; }
      CANDIDATE_IMAGE="$2"
      shift 2
      ;;
    --candidate-id)
      [[ $# -ge 2 ]] || { command echo '--candidate-id requires a value' >&2; exit 2; }
      CANDIDATE_ID="$2"
      shift 2
      ;;
    --matched-spec-a)
      [[ $# -ge 2 ]] || { command echo '--matched-spec-a requires a value' >&2; exit 2; }
      MATCHED_SPEC_A="$2"
      shift 2
      ;;
    --matched-spec-a-sha)
      [[ $# -ge 2 ]] || { command echo '--matched-spec-a-sha requires a value' >&2; exit 2; }
      MATCHED_SPEC_A_SHA="$2"
      shift 2
      ;;
    --matched-spec-b)
      [[ $# -ge 2 ]] || { command echo '--matched-spec-b requires a value' >&2; exit 2; }
      MATCHED_SPEC_B="$2"
      shift 2
      ;;
    --matched-spec-b-sha)
      [[ $# -ge 2 ]] || { command echo '--matched-spec-b-sha requires a value' >&2; exit 2; }
      MATCHED_SPEC_B_SHA="$2"
      shift 2
      ;;
    --matched-specs-commit)
      [[ $# -ge 2 ]] || { command echo '--matched-specs-commit requires a value' >&2; exit 2; }
      MATCHED_SPECS_COMMIT="$2"
      shift 2
      ;;
    --keep-staging)
      KEEP_STAGING=1
      shift
      ;;
    --check-images)
      CHECK_ONLY=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      command echo "unknown option: $1" >&2
      exit 2
      ;;
  esac
done

[[ "$CANDIDATE_KEY" =~ ^[a-zA-Z0-9._-]{1,80}$ ]] || {
  command echo 'candidate key must use only letters, numbers, dot, dash, or underscore' >&2
  exit 2
}
case "$CANDIDATE_KEY" in
  qd1n-v89|hrafn-v5|juryoku-v3|katanasan-v39)
    command echo "candidate key conflicts with a fixed policy key: $CANDIDATE_KEY" >&2
    exit 2
    ;;
esac
[[ "$CANDIDATE_ID" =~ ^sha256:[a-f0-9]{64}$ ]] || {
  command echo 'candidate ID must be an exact sha256:<64 lowercase hex> Docker image ID' >&2
  exit 2
}
for spec_sha in "$MATCHED_SPEC_A_SHA" "$MATCHED_SPEC_B_SHA"; do
  if [[ -n "$spec_sha" && ! "$spec_sha" =~ ^[a-f0-9]{64}$ ]]; then
    command echo 'matched spec hashes must be 64 lowercase hex characters' >&2
    exit 2
  fi
done
if [[ -n "$MATCHED_SPECS_COMMIT" && ! "$MATCHED_SPECS_COMMIT" =~ ^[a-f0-9]{40}$ ]]; then
  command echo 'matched specs commit must be a full 40-character commit ID' >&2
  exit 2
fi

for command_name in docker git gzip node shasum tar; do
  command -v "$command_name" >/dev/null 2>&1 || {
    command echo "required command not found: $command_name" >&2
    exit 1
  }
done

[[ "$OUTPUT" == *.tar.gz ]] || {
  command echo '--output must end in .tar.gz' >&2
  exit 2
}
for generated_path in "$OUTPUT" "${OUTPUT}.sha256" "${OUTPUT}.extract.py" \
  "${OUTPUT}.extract.py.sha256"; do
  [[ ! -e "$generated_path" ]] || {
    command echo "refusing to overwrite existing output: $generated_path" >&2
    exit 1
  }
done
[[ -f "$EXTRACTOR_SOURCE" ]] || {
  command echo "safe extractor is missing: $EXTRACTOR_SOURCE" >&2
  exit 1
}

POLICY_ROWS=(
  "$CANDIDATE_KEY|$CANDIDATE_IMAGE|$CANDIDATE_ID|$CANDIDATE_ENTRYPOINT"
  'qd1n-v89|proxywar-agent-llm:qd1n-v89-exact-amd64|sha256:ebd9eed3f8a936cc2d0813f54944a0e3e826a0141932356041d71f0c3638a478|llm-player.mjs'
  'hrafn-v5|proxywar-agent-llm:hrafn-v5-exact-amd64|sha256:3f427fd382daa521f0f3af31096b1326fdab0277eff7fc7638e03c944abb058d|hrafn-player.mjs'
  'juryoku-v3|proxywar-agent-llm:santai-juryoku-v3-hrafn-amd64|sha256:2ebf15372e8cf59b194ebb20f06b818a6a54f96994f4125e103b6a26070491c2|llm-player.mjs'
  'katanasan-v39|proxywar-agent-llm:tsukuyomi-v39-hrafn-amd64|sha256:0afece2db25675b0b744844769c64e02960270f56502c33d62bf0702f7b58cf6|llm-player.mjs'
)

verify_image() {
  local key="$1"
  local reference="$2"
  local expected_id="$3"
  local actual
  actual="$(docker image inspect "$reference" --format '{{.Id}}|{{.Architecture}}')"
  local actual_id="${actual%%|*}"
  local architecture="${actual##*|}"
  [[ "$actual_id" == "$expected_id" ]] || {
    command echo "$key: image identity mismatch: expected $expected_id, got $actual_id" >&2
    return 1
  }
  [[ "$architecture" == 'amd64' ]] || {
    command echo "$key: expected amd64, got $architecture" >&2
    return 1
  }
  command echo "$key|$reference|$actual_id|$architecture"
}

for row in "${POLICY_ROWS[@]}"; do
  IFS='|' read -r key reference expected_id entrypoint <<<"$row"
  verify_image "$key" "$reference" "$expected_id" >/dev/null
done

base_actual="$(docker image inspect "$BASE_IMAGE" --format '{{.Id}}|{{.Architecture}}')"
[[ "$base_actual" == 'sha256:88d166c6c33609ec5b0dc1f70799001a1f1f34e1cd852ddbfc17a2eb43969ea1|amd64' ]] || {
  command echo "base image identity mismatch: $base_actual" >&2
  exit 1
}

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  command echo "OK: base image, candidate $CANDIDATE_KEY ($CANDIDATE_ID), and four fixed policies match their pinned amd64 IDs"
  exit 0
fi

for required_value in MATCHED_SPEC_A MATCHED_SPEC_A_SHA MATCHED_SPEC_B \
  MATCHED_SPEC_B_SHA MATCHED_SPECS_COMMIT; do
  [[ -n "${!required_value}" ]] || {
    command echo "--matched-spec-a/b and both expected hashes are required for a full bundle" >&2
    exit 2
  }
done
for spec_path in "$MATCHED_SPEC_A" "$MATCHED_SPEC_B"; do
  [[ -f "$spec_path" ]] || {
    command echo "matched spec does not exist: $spec_path" >&2
    exit 1
  }
done
actual_spec_a_sha="$(shasum -a 256 "$MATCHED_SPEC_A" | awk '{print $1}')"
actual_spec_b_sha="$(shasum -a 256 "$MATCHED_SPEC_B" | awk '{print $1}')"
[[ "$actual_spec_a_sha" == "$MATCHED_SPEC_A_SHA" ]] || {
  command echo "matched spec A hash mismatch: $actual_spec_a_sha" >&2
  exit 1
}
[[ "$actual_spec_b_sha" == "$MATCHED_SPEC_B_SHA" ]] || {
  command echo "matched spec B hash mismatch: $actual_spec_b_sha" >&2
  exit 1
}
formal_spec_steps() {
  node --input-type=module - "$1" <<'NODE'
import fs from "node:fs";

const specPath = process.argv[2];
let document;
try {
  document = JSON.parse(fs.readFileSync(specPath, "utf8"));
} catch (error) {
  console.error(`formal spec is not valid JSON: ${specPath}: ${error.message}`);
  process.exit(1);
}
const steps = document?.game_config?.max_decision_steps;
if (!Number.isInteger(steps) || steps < 1 || steps > 600) {
  console.error(
    `formal spec game_config.max_decision_steps must be an integer from 1 to 600: ${specPath}`,
  );
  process.exit(1);
}
process.stdout.write(String(steps));
NODE
}
formal_spec_a_steps="$(formal_spec_steps "$MATCHED_SPEC_A")"
formal_spec_b_steps="$(formal_spec_steps "$MATCHED_SPEC_B")"
[[ "$formal_spec_a_steps" == "$formal_spec_b_steps" ]] || {
  command echo "formal matched specs must use the same max_decision_steps: A=$formal_spec_a_steps B=$formal_spec_b_steps" >&2
  exit 1
}
FORMAL_MAX_DECISION_STEPS="$formal_spec_a_steps"

SOURCE_FILES=(
  'scripts/extract_runpod_proxywar_bundle.py'
  'scripts/prepare-runpod-proxywar-bundle.sh'
  'scripts/runpod-proxywar-episode.mjs'
  'test/runpod-proxywar-episode.test.mjs'
  'test/test_extract_runpod_proxywar_bundle.py'
)
git -C "$REPO_ROOT" ls-files --error-unmatch "${SOURCE_FILES[@]}" >/dev/null
git -C "$REPO_ROOT" diff --quiet HEAD -- "${SOURCE_FILES[@]}" || {
  command echo 'bundle source files differ from HEAD; commit before building' >&2
  exit 1
}
git -C "$REPO_ROOT" diff --cached --quiet HEAD -- "${SOURCE_FILES[@]}" || {
  command echo 'bundle source files have staged changes; commit before building' >&2
  exit 1
}
source_commit="$(git -C "$REPO_ROOT" rev-parse HEAD)"
preparer_source_sha="$(shasum -a 256 \
  "$REPO_ROOT/scripts/prepare-runpod-proxywar-bundle.sh" | awk '{print $1}')"
runner_source_sha="$(shasum -a 256 \
  "$REPO_ROOT/scripts/runpod-proxywar-episode.mjs" | awk '{print $1}')"
extractor_source_sha="$(shasum -a 256 \
  "$REPO_ROOT/scripts/extract_runpod_proxywar_bundle.py" | awk '{print $1}')"
runner_test_source_sha="$(shasum -a 256 \
  "$REPO_ROOT/test/runpod-proxywar-episode.test.mjs" | awk '{print $1}')"
extractor_test_source_sha="$(shasum -a 256 \
  "$REPO_ROOT/test/test_extract_runpod_proxywar_bundle.py" | awk '{print $1}')"

spec_a_repo="$(git -C "$(dirname "$MATCHED_SPEC_A")" rev-parse --show-toplevel)"
spec_b_repo="$(git -C "$(dirname "$MATCHED_SPEC_B")" rev-parse --show-toplevel)"
[[ "$spec_a_repo" == "$spec_b_repo" ]] || {
  command echo 'formal specs must come from the same Git repository' >&2
  exit 1
}
git -C "$spec_a_repo" cat-file -e "${MATCHED_SPECS_COMMIT}^{commit}"
spec_a_relative="${MATCHED_SPEC_A#"$spec_a_repo"/}"
spec_b_relative="${MATCHED_SPEC_B#"$spec_b_repo"/}"
[[ "$spec_a_relative" != "$MATCHED_SPEC_A" &&
  "$spec_b_relative" != "$MATCHED_SPEC_B" ]] || {
  command echo 'formal spec paths must be inside their Git repository' >&2
  exit 1
}
committed_spec_a_sha="$(git -C "$spec_a_repo" show \
  "$MATCHED_SPECS_COMMIT:$spec_a_relative" | shasum -a 256 | awk '{print $1}')"
committed_spec_b_sha="$(git -C "$spec_b_repo" show \
  "$MATCHED_SPECS_COMMIT:$spec_b_relative" | shasum -a 256 | awk '{print $1}')"
[[ "$committed_spec_a_sha" == "$MATCHED_SPEC_A_SHA" &&
  "$committed_spec_b_sha" == "$MATCHED_SPEC_B_SHA" ]] || {
  command echo 'formal specs do not match the declared committed versions' >&2
  exit 1
}

STAGING="$(mktemp -d "${TMPDIR:-/private/tmp}/proxywar-runpod-bundle.XXXXXX")"
BUNDLE_ROOT="$STAGING/proxywar-runpod-bundle"
CURRENT_CONTAINER=''
cleanup() {
  if [[ -n "$CURRENT_CONTAINER" ]]; then
    docker rm -f "$CURRENT_CONTAINER" >/dev/null 2>&1 || true
  fi
  if [[ "$KEEP_STAGING" -eq 0 ]]; then
    rm -rf "$STAGING"
  fi
}
trap cleanup EXIT INT TERM

mkdir -p "$BUNDLE_ROOT/bin" "$BUNDLE_ROOT/policies" "$BUNDLE_ROOT/specs" \
  "$BUNDLE_ROOT/runtime/integration" "$BUNDLE_ROOT/runtime/proxywar" \
  "$BUNDLE_ROOT/runtime/node/bin"
cp "$REPO_ROOT/scripts/runpod-proxywar-episode.mjs" \
  "$BUNDLE_ROOT/bin/runpod-proxywar-episode.mjs"
cp "$EXTRACTOR_SOURCE" "$BUNDLE_ROOT/bin/extract_runpod_proxywar_bundle.py"
chmod 0755 "$BUNDLE_ROOT/bin/runpod-proxywar-episode.mjs"
chmod 0755 "$BUNDLE_ROOT/bin/extract_runpod_proxywar_bundle.py"
cp "$MATCHED_SPEC_A" "$BUNDLE_ROOT/specs/formal-matched-a.json"
cp "$MATCHED_SPEC_B" "$BUNDLE_ROOT/specs/formal-matched-b.json"
chmod 0644 "$BUNDLE_ROOT/specs/formal-matched-a.json" \
  "$BUNDLE_ROOT/specs/formal-matched-b.json"

CURRENT_CONTAINER="$(docker create --platform linux/amd64 "$BASE_IMAGE")"
docker cp "$CURRENT_CONTAINER:/app/integration/." \
  "$BUNDLE_ROOT/runtime/integration"
docker cp "$CURRENT_CONTAINER:/app/proxywar/." \
  "$BUNDLE_ROOT/runtime/proxywar"
docker cp "$CURRENT_CONTAINER:/usr/local/bin/node" \
  "$BUNDLE_ROOT/runtime/node/bin/node"
docker rm "$CURRENT_CONTAINER" >/dev/null
CURRENT_CONTAINER=''
chmod 0755 "$BUNDLE_ROOT/runtime/node/bin/node"
[[ "$(shasum -a 256 "$BUNDLE_ROOT/runtime/node/bin/node" | awk '{print $1}')" == \
  '41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c' ]] || {
  command echo 'bundled Node binary does not match the pinned base runtime' >&2
  exit 1
}

command cat >"$BUNDLE_ROOT/bin/runpod-proxywar-episode" <<'EOF'
#!/bin/sh
set -eu
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
BUNDLE_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
case "$(uname -m)" in
  x86_64|amd64) ;;
  *)
    echo "unsupported architecture: $(uname -m); bundle requires amd64" >&2
    exit 1
    ;;
esac
cd "$BUNDLE_ROOT"
exec "$BUNDLE_ROOT/runtime/node/bin/node" \
  "$BUNDLE_ROOT/bin/runpod-proxywar-episode.mjs" \
  --bundle-root "$BUNDLE_ROOT" "$@"
EOF
chmod 0755 "$BUNDLE_ROOT/bin/runpod-proxywar-episode"

for row in "${POLICY_ROWS[@]}"; do
  IFS='|' read -r key reference expected_id entrypoint <<<"$row"
  destination="$BUNDLE_ROOT/policies/$key/app"
  mkdir -p "$destination"
  CURRENT_CONTAINER="$(docker create --platform linux/amd64 "$reference")"
  docker cp "$CURRENT_CONTAINER:/app/." "$destination"
  docker rm "$CURRENT_CONTAINER" >/dev/null
  CURRENT_CONTAINER=''
  [[ -f "$destination/$entrypoint" ]] || {
    command echo "$key: missing expected entrypoint $entrypoint after extraction" >&2
    exit 1
  }
done

for forbidden_name in '.env' '.env.local' '.npmrc' 'credentials' 'credentials.json' \
  'id_rsa' 'id_ed25519' 'service-account.json'; do
  if find "$BUNDLE_ROOT" -type f -name "$forbidden_name" -print -quit | grep -q .; then
    command echo "refusing to package secret-bearing filename: $forbidden_name" >&2
    exit 1
  fi
done

command cat >"$BUNDLE_ROOT/specs/canary-candidate-player-specs.json" <<EOF
{
  "schema_version": 1,
  "game_config": {
    "seed": 20260719,
    "map": "Pangaea",
    "map_size": "Compact",
    "difficulty": "Easy",
    "max_decision_steps": 3,
    "turns_per_decision_step": 100,
    "max_decision_ms": 15000,
    "episode_timeout_seconds": 300,
    "player_connect_timeout_seconds": 120
  },
  "players": [
    {
      "name": "K1Z odin free",
      "policy": "$CANDIDATE_KEY",
      "cwd": "policies/$CANDIDATE_KEY/app",
      "run": ["node", "llm-player.mjs"],
      "env": {
        "POLICY_CODENAME": "s4ntai",
        "POLICY_ENGINE": "",
        "AWS_EC2_METADATA_DISABLED": "true"
      }
    },
    {
      "name": "K1Z Hrafn",
      "policy": "hrafn-v5",
      "cwd": "policies/hrafn-v5/app",
      "run": ["node", "hrafn-player.mjs"],
      "env": {
        "POLICY_CODENAME": "hrafn-gjof",
        "POLICY_ENGINE": "",
        "HRAFN_RV1": "1"
      }
    },
    {
      "name": "K1Z juryoku-koku",
      "policy": "juryoku-v3",
      "cwd": "policies/juryoku-v3/app",
      "run": ["node", "llm-player.mjs"],
      "env": {
        "AWS_EC2_METADATA_DISABLED": "true"
      }
    },
    {
      "name": "K1Z katanasan",
      "policy": "katanasan-v39",
      "cwd": "policies/katanasan-v39/app",
      "run": ["node", "llm-player.mjs"],
      "env": {
        "AWS_EC2_METADATA_DISABLED": "true"
      }
    }
  ]
}
EOF

command cat >"$BUNDLE_ROOT/specs/canary-control-player-specs.json" <<'EOF'
{
  "schema_version": 1,
  "game_config": {
    "seed": 20260719,
    "map": "Pangaea",
    "map_size": "Compact",
    "difficulty": "Easy",
    "max_decision_steps": 3,
    "turns_per_decision_step": 100,
    "max_decision_ms": 15000,
    "episode_timeout_seconds": 300,
    "player_connect_timeout_seconds": 120
  },
  "players": [
    {
      "name": "K1Z odin free",
      "policy": "qd1n-v89",
      "cwd": "policies/qd1n-v89/app",
      "run": ["node", "llm-player.mjs"],
      "env": {
        "POLICY_CODENAME": "s4ntai",
        "POLICY_ENGINE": "",
        "AWS_EC2_METADATA_DISABLED": "true"
      }
    },
    {
      "name": "K1Z Hrafn",
      "policy": "hrafn-v5",
      "cwd": "policies/hrafn-v5/app",
      "run": ["node", "hrafn-player.mjs"],
      "env": {
        "POLICY_CODENAME": "hrafn-gjof",
        "POLICY_ENGINE": "",
        "HRAFN_RV1": "1"
      }
    },
    {
      "name": "K1Z juryoku-koku",
      "policy": "juryoku-v3",
      "cwd": "policies/juryoku-v3/app",
      "run": ["node", "llm-player.mjs"],
      "env": {
        "AWS_EC2_METADATA_DISABLED": "true"
      }
    },
    {
      "name": "K1Z katanasan",
      "policy": "katanasan-v39",
      "cwd": "policies/katanasan-v39/app",
      "run": ["node", "llm-player.mjs"],
      "env": {
        "AWS_EC2_METADATA_DISABLED": "true"
      }
    }
  ]
}
EOF

canary_candidate_sha="$(shasum -a 256 \
  "$BUNDLE_ROOT/specs/canary-candidate-player-specs.json" | awk '{print $1}')"
canary_control_sha="$(shasum -a 256 \
  "$BUNDLE_ROOT/specs/canary-control-player-specs.json" | awk '{print $1}')"

command cat >"$BUNDLE_ROOT/README.txt" <<EOF
ProxyWar RunPod CPU bundle

Runtime provenance (the pod itself may use a generic amd64 Ubuntu image):
  $BASE_IMAGE

Candidate bundled as $CANDIDATE_KEY:
  $CANDIDATE_IMAGE
  $CANDIDATE_ID

Bundle source commit:
  $source_commit
Formal-spec source commit:
  $MATCHED_SPECS_COMMIT

This archive contains no RunPod, AWS, Coworld, or other credentials. It does
not provision resources. Start the pod without API-key environment variables,
credential files, secret mounts, or a cloud CLI session. The orchestrator fails
closed on secret-bearing control variables and verifies a fixed runtime
fingerprint before running policies. It uses the bundled Node 24.18.0, game,
ProxyWar runtime, and policy files; it performs no network install. Extract it
on an already-started generic amd64 Linux CPU pod with the separately supplied
standard-library extractor. Verify both script and archive against the hashes
from Odin's out-of-band handoff; never trust only an adjacent sidecar:

  printf '%s  %s\n' \\
    <OUT_OF_BAND_EXTRACTOR_SHA256> proxywar-bundle.tar.gz.extract.py \\
    | sha256sum -c -
  python3 proxywar-bundle.tar.gz.extract.py \\
    --archive proxywar-bundle.tar.gz \\
    --expected-sha256 <OUT_OF_BAND_ARCHIVE_SHA256> \\
    --destination /workspace/proxywar-evidence-bundle

The extractor requires a new destination and rejects oversize input, traversal,
absolute paths, hardlinks, special files, and escaping symlinks. Then run:

  /workspace/proxywar-evidence-bundle/proxywar-runpod-bundle/bin/runpod-proxywar-episode \\
    --spec specs/canary-candidate-player-specs.json \\
    --transport-canary \\
    --validate-only

The canary-candidate and canary-control files are only the bounded 3-step
transport/reach fixtures. They are never evaluation evidence. Formal evaluation
must use this immutable $FORMAL_MAX_DECISION_STEPS-step matched pair:

  specs/formal-matched-a.json
    sha256 $MATCHED_SPEC_A_SHA
  specs/formal-matched-b.json
    sha256 $MATCHED_SPEC_B_SHA

Set a unique --output-dir for each episode. Keep each formal spec unchanged;
their seed, map, roster, horizon, and non-Odin policy files are already paired.
Each run writes sanitized logs, results.json, replay, and receipt.json with
SHA-256 hashes. Before execution it verifies the bundle receipt and all selected
policy files and symlinks. A passed receipt proves transport and artifact
integrity only; it is not an evaluation or promotion verdict. The orchestrator
never calls the RunPod API.
EOF

FILE_MANIFEST="$BUNDLE_ROOT/files.sha256"
LINK_MANIFEST="$BUNDLE_ROOT/links.tsv"
stats_json="$(node --input-type=module - "$BUNDLE_ROOT" "$FILE_MANIFEST" \
  "$LINK_MANIFEST" <<'NODE'
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const [root, fileManifestPath, linkManifestPath] = process.argv.slice(2);
const excluded = new Set([
  "files.sha256",
  "links.tsv",
  "manifest.json",
  "manifest.sha256",
]);
const entries = [];
async function walk(directory, relative = "") {
  const children = await fs.readdir(directory, { withFileTypes: true });
  children.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const child of children) {
    const childRelative = path.posix.join(relative, child.name);
    if (excluded.has(childRelative)) continue;
    const absolute = path.join(directory, child.name);
    if (child.isDirectory()) await walk(absolute, childRelative);
    else entries.push({ absolute, relative: childRelative, child });
  }
}
await walk(root);
let bytes = 0;
const fileLines = [];
const linkLines = [];
for (const entry of entries) {
  if (entry.child.isSymbolicLink()) {
    const target = await fs.readlink(entry.absolute);
    const digest = createHash("sha256")
      .update(`symlink\0${target}`)
      .digest("hex");
    linkLines.push(`${digest}\t${entry.relative}\t${target}`);
    continue;
  }
  if (!entry.child.isFile()) continue;
  const body = await fs.readFile(entry.absolute);
  bytes += body.length;
  fileLines.push(
    `${createHash("sha256").update(body).digest("hex")}  ${entry.relative}`,
  );
}
await fs.writeFile(fileManifestPath, `${fileLines.join("\n")}\n`);
await fs.writeFile(
  linkManifestPath,
  linkLines.length === 0 ? "" : `${linkLines.join("\n")}\n`,
);
process.stdout.write(
  JSON.stringify({
    file_count: fileLines.length,
    symlink_count: linkLines.length,
    uncompressed_file_bytes: bytes,
  }),
);
NODE
)"

file_count="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).file_count))' \
  "$stats_json")"
symlink_count="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).symlink_count))' \
  "$stats_json")"
file_bytes="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).uncompressed_file_bytes))' \
  "$stats_json")"
files_sha="$(shasum -a 256 "$FILE_MANIFEST" | awk '{print $1}')"
links_sha="$(shasum -a 256 "$LINK_MANIFEST" | awk '{print $1}')"
orchestrator_sha="$(shasum -a 256 \
  "$BUNDLE_ROOT/bin/runpod-proxywar-episode.mjs" | awk '{print $1}')"

node - "$BUNDLE_ROOT/manifest.json" "$BASE_IMAGE" "$files_sha" "$file_count" \
  "$file_bytes" "$links_sha" "$symlink_count" "$orchestrator_sha" \
  "$MATCHED_SPEC_A_SHA" "$MATCHED_SPEC_B_SHA" \
  "$FORMAL_MAX_DECISION_STEPS" \
  "$canary_candidate_sha" "$canary_control_sha" \
  "$source_commit" "$MATCHED_SPECS_COMMIT" "$preparer_source_sha" \
  "$runner_source_sha" "$extractor_source_sha" "$runner_test_source_sha" \
  "$extractor_test_source_sha" \
  "${POLICY_ROWS[@]}" <<'NODE'
import fs from "node:fs";

const [
  manifestPath,
  baseImage,
  filesSha256,
  fileCount,
  fileBytes,
  linksSha256,
  symlinkCount,
  orchestratorSha256,
  matchedSpecASha256,
  matchedSpecBSha256,
  formalMaxDecisionSteps,
  canaryCandidateSha256,
  canaryControlSha256,
  sourceCommit,
  matchedSpecsCommit,
  preparerSourceSha256,
  runnerSourceSha256,
  extractorSourceSha256,
  runnerTestSourceSha256,
  extractorTestSourceSha256,
  ...rows
] = process.argv.slice(2);
const policies = rows.map((row) => {
  const [key, localReference, imageID, entrypoint] = row.split("|");
  return {
    key,
    local_reference: localReference,
    image_id: imageID,
    architecture: "amd64",
    bundle_root: `policies/${key}/app`,
    run: ["node", entrypoint],
  };
});
const manifest = {
  schema_version: 1,
  base_image: baseImage,
  created_by: "scripts/prepare-runpod-proxywar-bundle.sh",
  contains_credentials: false,
  invokes_runpod_api: false,
  source: {
    commit: sourceCommit,
    formal_specs_commit: matchedSpecsCommit,
    files: {
      "scripts/prepare-runpod-proxywar-bundle.sh": preparerSourceSha256,
      "scripts/runpod-proxywar-episode.mjs": runnerSourceSha256,
      "scripts/extract_runpod_proxywar_bundle.py": extractorSourceSha256,
      "test/runpod-proxywar-episode.test.mjs": runnerTestSourceSha256,
      "test/test_extract_runpod_proxywar_bundle.py": extractorTestSourceSha256,
    },
  },
  runtime: {
    mode: "self_contained_bundle",
    source_base_image: baseImage,
    architecture: "amd64",
    node_version: "24.18.0",
    node_sha256:
      "41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c",
    bundle_roots: [
      "runtime/integration",
      "runtime/proxywar",
      "runtime/node",
    ],
  },
  experiment_specs: [
    {
      label: "formal-matched-a",
      path: "specs/formal-matched-a.json",
      sha256: matchedSpecASha256,
      role: "candidate",
      max_decision_steps: Number(formalMaxDecisionSteps),
    },
    {
      label: "formal-matched-b",
      path: "specs/formal-matched-b.json",
      sha256: matchedSpecBSha256,
      role: "exact-parent",
      max_decision_steps: Number(formalMaxDecisionSteps),
    },
  ],
  transport_canaries: [
    {
      label: "transport-canary-candidate",
      path: "specs/canary-candidate-player-specs.json",
      sha256: canaryCandidateSha256,
      role: "candidate",
    },
    {
      label: "transport-canary-control",
      path: "specs/canary-control-player-specs.json",
      sha256: canaryControlSha256,
      role: "exact-parent",
    },
  ],
  orchestrator_sha256: orchestratorSha256,
  file_manifest: {
    path: "files.sha256",
    sha256: filesSha256,
    file_count: Number(fileCount),
    uncompressed_file_bytes: Number(fileBytes),
  },
  symlink_manifest: {
    path: "links.tsv",
    sha256: linksSha256,
    symlink_count: Number(symlinkCount),
  },
  policies,
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
  mode: 0o644,
});
NODE

manifest_sha="$(shasum -a 256 "$BUNDLE_ROOT/manifest.json" | awk '{print $1}')"
command printf '%s  manifest.json\n' "$manifest_sha" \
  >"$BUNDLE_ROOT/manifest.sha256"

find "$BUNDLE_ROOT" -exec touch -h -t 197001010000 {} +
mkdir -p "$(dirname "$OUTPUT")"
archive_list="$STAGING/archive-files.txt"
(cd "$STAGING" && find proxywar-runpod-bundle \( -type f -o -type l \) -print |
  LC_ALL=C sort >"$archive_list")
TAR_REPRO_ARGS=(--no-xattrs)
if tar --version 2>&1 | grep -qi 'bsdtar'; then
  TAR_REPRO_ARGS+=(--no-mac-metadata --uid 0 --gid 0 --uname root --gname root)
else
  TAR_REPRO_ARGS+=(--owner=0 --group=0 --numeric-owner)
fi
COPYFILE_DISABLE=1 tar "${TAR_REPRO_ARGS[@]}" -cf - -C "$STAGING" \
  -T "$archive_list" |
  gzip -n -9 >"$OUTPUT"
archive_sha="$(shasum -a 256 "$OUTPUT" | awk '{print $1}')"
archive_bytes="$(wc -c <"$OUTPUT" | tr -d ' ')"
command printf '%s  %s\n' "$archive_sha" "$(basename "$OUTPUT")" \
  >"${OUTPUT}.sha256"
cp "$EXTRACTOR_SOURCE" "${OUTPUT}.extract.py"
chmod 0755 "${OUTPUT}.extract.py"
extractor_sha="$(shasum -a 256 "${OUTPUT}.extract.py" | awk '{print $1}')"
command printf '%s  %s\n' "$extractor_sha" \
  "$(basename "${OUTPUT}.extract.py")" >"${OUTPUT}.extract.py.sha256"

command echo "bundle=$OUTPUT"
command echo "bundle_sha256=$archive_sha"
command echo "bundle_bytes=$archive_bytes"
command echo "extractor=${OUTPUT}.extract.py"
command echo "extractor_sha256=$extractor_sha"
command echo "source_commit=$source_commit"
command echo "formal_specs_commit=$MATCHED_SPECS_COMMIT"
command echo "preparer_source_sha256=$preparer_source_sha"
command echo "runner_source_sha256=$runner_source_sha"
command echo "extractor_source_sha256=$extractor_source_sha"
command echo "matched_spec_a_sha256=$MATCHED_SPEC_A_SHA"
command echo "matched_spec_b_sha256=$MATCHED_SPEC_B_SHA"
command echo "formal_max_decision_steps=$FORMAL_MAX_DECISION_STEPS"
command echo "canary_candidate_sha256=$canary_candidate_sha"
command echo "canary_control_sha256=$canary_control_sha"
command echo "manifest_sha256=$manifest_sha"
command echo "files_sha256=$files_sha"
command echo "links_sha256=$links_sha"
command echo "file_count=$file_count"
command echo "uncompressed_file_bytes=$file_bytes"
command echo "symlink_count=$symlink_count"
if [[ "$KEEP_STAGING" -eq 1 ]]; then
  command echo "staging=$BUNDLE_ROOT"
fi

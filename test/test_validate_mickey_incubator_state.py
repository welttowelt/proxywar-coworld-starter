import copy
import json
import tempfile
import unittest
from pathlib import Path

from scripts.validate_mickey_incubator_state import validate_task_root


REPO = Path(__file__).resolve().parents[1]
SOURCE_ROOT = REPO / "state" / "autonomous-research" / "mickey-cpu-incubator"


class MickeyIncubatorStateTest(unittest.TestCase):
    def fixture(self) -> tuple[tempfile.TemporaryDirectory[str], Path, dict, dict]:
        holder = tempfile.TemporaryDirectory()
        root = Path(holder.name)
        state = root / "state"
        state.mkdir()
        manifest = json.loads((SOURCE_ROOT / "state" / "incubator_manifest.json").read_text())
        progress = json.loads((SOURCE_ROOT / "state" / "progress.json").read_text())
        return holder, root, manifest, progress

    def write(self, root: Path, manifest: dict, progress: dict) -> None:
        (root / "state" / "incubator_manifest.json").write_text(
            json.dumps(manifest), encoding="utf-8"
        )
        (root / "state" / "progress.json").write_text(
            json.dumps(progress), encoding="utf-8"
        )

    def test_committed_snapshot_is_valid(self) -> None:
        self.assertEqual(validate_task_root(SOURCE_ROOT), [])

    def test_static_artifact_can_never_be_uploadable(self) -> None:
        holder, root, manifest, progress = self.fixture()
        self.addCleanup(holder.cleanup)
        manifest["generations"][0]["arms"][1]["evaluation_artifact"]["upload_eligible"] = True
        self.write(root, manifest, progress)
        errors = validate_task_root(root)
        self.assertTrue(any("static artifact cannot be upload eligible" in item for item in errors))

    def test_confirmation_cannot_skip_screen(self) -> None:
        holder, root, manifest, progress = self.fixture()
        self.addCleanup(holder.cleanup)
        arm = manifest["generations"][0]["arms"][1]
        arm["gates"]["confirm"] = {
            "status": "pass",
            "evidence": ["evidence/confirm.json"],
        }
        self.write(root, manifest, progress)
        errors = validate_task_root(root)
        self.assertTrue(any("confirmation passed before screen" in item for item in errors))

    def test_stale_pair_requires_structural_pivot(self) -> None:
        holder, root, manifest, progress = self.fixture()
        self.addCleanup(holder.cleanup)
        progress["stale_count"] = 2
        manifest["loop_control"]["stale_count"] = 2
        self.write(root, manifest, progress)
        errors = validate_task_root(root)
        self.assertTrue(any("loop state pivot_required" in item for item in errors))
        self.assertTrue(any("preregistered next_direction" in item for item in errors))

        fixed = copy.deepcopy(manifest)
        fixed["loop_control"]["state"] = "pivot_required"
        fixed["loop_control"]["next_direction"] = {
            "structural_dimension": "verifier",
            "parameter_only": False,
            "rationale": "Audit a different causal observable before adding arms.",
        }
        fixed["generations"][0]["status"] = "pivot_required"
        self.write(root, fixed, progress)
        self.assertEqual(validate_task_root(root), [])

    def test_four_stale_iterations_stop_generation(self) -> None:
        holder, root, manifest, progress = self.fixture()
        self.addCleanup(holder.cleanup)
        progress["stale_count"] = 4
        manifest["loop_control"]["stale_count"] = 4
        manifest["loop_control"]["state"] = "pivot_required"
        manifest["loop_control"]["next_direction"] = {
            "structural_dimension": "objective",
            "parameter_only": False,
            "rationale": "Try another outcome objective.",
        }
        manifest["generations"][0]["status"] = "pivot_required"
        self.write(root, manifest, progress)
        errors = validate_task_root(root)
        self.assertTrue(any("human_attention" in item for item in errors))
        self.assertTrue(any("requires generation stop" in item for item in errors))

    def test_promoted_arm_needs_production_artifact_and_rollback(self) -> None:
        holder, root, manifest, progress = self.fixture()
        self.addCleanup(holder.cleanup)
        arm = manifest["generations"][0]["arms"][1]
        arm["status"] = "promoted"
        arm["gates"]["screen"] = {
            "status": "pass",
            "evidence": ["evidence/screen.json"],
        }
        arm["gates"]["confirm"] = {
            "status": "pass",
            "evidence": ["evidence/confirm.json"],
        }
        self.write(root, manifest, progress)
        errors = validate_task_root(root)
        self.assertTrue(any("requires a production_candidate object" in item for item in errors))
        self.assertTrue(any("promoted arm requires an active" in item for item in errors))

    def test_local_baseline_can_be_active_while_league_stays_blocked(self) -> None:
        holder, root, manifest, progress = self.fixture()
        self.addCleanup(holder.cleanup)
        manifest["local_incumbent"] = {
            "state": "active",
            "origin": "baseline",
            "arm_id": "mickey-production-baseline",
            "source_commit": "f" * 40,
            "image_tag": "proxywar-agent-llm:mickey-local-baseline",
            "image_digest": "sha256:" + "a" * 64,
            "activation_receipt": "evidence/local-baseline.json",
            "rollback_ready": True,
            "previous": None,
        }
        self.write(root, manifest, progress)
        self.assertEqual(validate_task_root(root), [])

    def test_league_eligibility_cannot_infer_from_local_activation(self) -> None:
        holder, root, manifest, progress = self.fixture()
        self.addCleanup(holder.cleanup)
        manifest["league_incumbent"]["state"] = "eligible"
        self.write(root, manifest, progress)
        errors = validate_task_root(root)
        self.assertTrue(any("requires every league gate" in item for item in errors))
        self.assertTrue(any("requires an active local_incumbent" in item for item in errors))

    def test_malformed_contract_fails_closed_without_crashing(self) -> None:
        holder, root, manifest, progress = self.fixture()
        self.addCleanup(holder.cleanup)
        manifest["gate_contracts"]["screen"] = ["not", "an", "object"]
        self.write(root, manifest, progress)
        errors = validate_task_root(root)
        self.assertTrue(any("gate_contracts.screen must be an object" in item for item in errors))

    def test_sensitive_state_key_is_rejected(self) -> None:
        holder, root, manifest, progress = self.fixture()
        self.addCleanup(holder.cleanup)
        manifest["api_token"] = "never-store-this"
        self.write(root, manifest, progress)
        errors = validate_task_root(root)
        self.assertTrue(any("sensitive-looking state key" in item for item in errors))

    def test_production_clean_arm_can_become_local_only_incumbent(self) -> None:
        holder, root, manifest, progress = self.fixture()
        self.addCleanup(holder.cleanup)
        arm = manifest["generations"][0]["arms"][1]
        arm["status"] = "promoted"
        arm["gates"]["screen"] = {
            "status": "pass",
            "evidence": ["evidence/screen.json"],
        }
        arm["gates"]["confirm"] = {
            "status": "pass",
            "evidence": ["evidence/confirm.json"],
        }
        def pass_gate(path: str) -> dict:
            return {"status": "pass", "evidence": [path]}
        arm["production_candidate"] = {
            "class": "production_candidate",
            "derived_from_static_arm": True,
            "static_evaluation_runtime_absent": True,
            "baked_static_arm_absent": True,
            "upload_eligible": False,
            "live_softmax_gate": "separate_and_closed",
            "source_commit": "e" * 40,
            "image_tag": "proxywar-agent-llm:mickey-local-grow-opening",
            "image_digest": "sha256:" + "b" * 64,
            "architecture": "amd64",
            "gates": {
                "full_source_suite": pass_gate("evidence/source-suite.json"),
                "independent_verifier": pass_gate("evidence/rci.json"),
                "exact_image": pass_gate("evidence/image.json"),
                "mac_canary": pass_gate("evidence/mac-canary.json"),
            },
        }
        manifest["local_incumbent"] = {
            "state": "active",
            "origin": "promoted_arm",
            "arm_id": "grow-opening",
            "source_commit": "e" * 40,
            "image_tag": "proxywar-agent-llm:mickey-local-grow-opening",
            "image_digest": "sha256:" + "b" * 64,
            "activation_receipt": "evidence/local-promotion.json",
            "rollback_ready": True,
            "previous": {
                "source_commit": "d" * 40,
                "image_tag": "proxywar-agent-llm:mickey-local-baseline",
                "image_digest": "sha256:" + "c" * 64,
                "activation_receipt": "evidence/local-baseline.json",
            },
        }
        self.write(root, manifest, progress)
        self.assertEqual(validate_task_root(root), [])


if __name__ == "__main__":
    unittest.main()

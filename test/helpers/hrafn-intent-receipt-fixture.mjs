import {
  HRAFN_INTENT_IMAGE_ENTRYPOINT,
  HRAFN_EXACT_V5_PLAYER_RUN,
  HRAFN_NEUTRAL_OPPONENT_IMAGE_ID,
  HRAFN_NEUTRAL_OPPONENT_POLICY_FILES,
  HRAFN_NEUTRAL_OPPONENT_RUN,
  HRAFN_NEUTRAL_OPPONENT_SOURCE_FILES,
  HRAFN_V5_PARENT_IMAGE_ID,
} from "../../scripts/create-hrafn-intent-image-receipt.mjs";
import {
  HRAFN_COWORLD_GAME_IMAGE_ID,
  HRAFN_COWORLD_GAME_IMAGE_REFERENCE,
} from "../../scripts/materialize-hrafn-coworld-manifest.mjs";

export function coworldGameReceiptFixture() {
  return {
    reference: HRAFN_COWORLD_GAME_IMAGE_REFERENCE,
    id: HRAFN_COWORLD_GAME_IMAGE_ID,
    os: "linux",
    architecture: "amd64",
  };
}

export function neutralOpponentReceiptFixture(files) {
  const committed = new Map(
    files.map((entry) => [entry.path, entry.sha256]),
  );
  const parentPolicyHashes = new Map(
    [...HRAFN_NEUTRAL_OPPONENT_POLICY_FILES].sort().map((file, index) => [
      file,
      String(index + 201).padStart(64, "0"),
    ]),
  );
  const parentRootfsLayers = [`sha256:${"1".repeat(64)}`];
  return {
    image_id: HRAFN_NEUTRAL_OPPONENT_IMAGE_ID,
    parent_image_id: HRAFN_V5_PARENT_IMAGE_ID,
    os: "linux",
    architecture: "amd64",
    working_dir: "/app",
    entrypoint: [...HRAFN_INTENT_IMAGE_ENTRYPOINT],
    cmd: [...HRAFN_NEUTRAL_OPPONENT_RUN],
    coworld_player_run: [...HRAFN_NEUTRAL_OPPONENT_RUN],
    parent_coworld_player_run: [...HRAFN_EXACT_V5_PLAYER_RUN],
    rootfs_layers: [...parentRootfsLayers, `sha256:${"2".repeat(64)}`],
    parent_rootfs_layers: parentRootfsLayers,
    container_files: [
      ...HRAFN_NEUTRAL_OPPONENT_POLICY_FILES,
      ...HRAFN_NEUTRAL_OPPONENT_SOURCE_FILES,
    ].sort().map((file) => ({
      path: `/app/${file}`,
      sha256: parentPolicyHashes.get(file) ?? committed.get(file),
    })),
    parent_policy_files: [...HRAFN_NEUTRAL_OPPONENT_POLICY_FILES]
      .sort()
      .map((file) => ({
        path: `/app/${file}`,
        sha256: parentPolicyHashes.get(file),
      })),
    runtime_smoke: {
      node_version: "v24.4.1",
      syntax_files: [...HRAFN_NEUTRAL_OPPONENT_SOURCE_FILES]
        .sort()
        .map((file) => `/app/${file}`),
      module_imports: ["ws", "file:///app/hrafn-neutral-opponent.mjs"],
      sample_reason: "[0UT] v5:h0d",
    },
  };
}

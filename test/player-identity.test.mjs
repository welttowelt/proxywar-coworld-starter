import assert from "node:assert/strict";
import test from "node:test";

import {
  ODIN_CANONICAL_NAME,
  ODIN_PLAYER_ID,
  canonicalDashboardPlayerName,
} from "../scripts/player-identity.mjs";

test("dashboard keeps Odin history continuous across the K1Z rename", () => {
  for (const name of [
    "odin free",
    "K1Z odin free",
    "[K1Z] odin free",
    "k1z-odin_free",
    "Ｋ１Ｚ odin.free",
  ]) {
    assert.equal(canonicalDashboardPlayerName(name), ODIN_CANONICAL_NAME);
  }
});

test("exact player ID survives future Odin display renames", () => {
  assert.equal(
    canonicalDashboardPlayerName("future raven king", ODIN_PLAYER_ID),
    ODIN_CANONICAL_NAME,
  );
});

test("other coalition identities retain their public names", () => {
  assert.equal(
    canonicalDashboardPlayerName("K1Z Hrafn", "ply_hrafn"),
    "K1Z Hrafn",
  );
});

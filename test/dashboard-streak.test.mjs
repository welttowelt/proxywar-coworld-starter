import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildOfficialStreakState } from "../scripts/official-streak.mjs";

const round = (roundNumber) => ({ round_number: roundNumber, status: "completed" });
const standing = (roundNumber, rank = 1) => ({
  round_number: roundNumber,
  rank,
  player_name: "odin free",
});
const stateArgs = (overrides = {}) => ({
  competitionRounds: [],
  currentStandings: [],
  priorState: { rounds: [] },
  trackedPlayerName: "odin free",
  leagueID: "league-test",
  collectedAt: "2026-07-12T00:00:00.000Z",
  loadStanding: async () => null,
  ...overrides,
});

test("official streak backfills through the latest non-first boundary", async () => {
  const currentStandings = Array.from({ length: 20 }, (_, index) => standing(188 + index));
  const loaded = [];
  const state = await buildOfficialStreakState(stateArgs({
    competitionRounds: Array.from({ length: 22 }, (_, index) => round(186 + index)),
    currentStandings,
    loadStanding: async ({ round_number: roundNumber }) => {
      loaded.push(roundNumber);
      if (roundNumber === 187) return standing(187);
      if (roundNumber === 186) return standing(186, 2);
      return null;
    },
  }));

  assert.deepEqual(loaded, [187, 186]);
  assert.equal(state.boundary_round_number, 186);
  assert.equal(state.last_round_number, 207);
  assert.equal(state.current_first_place_streak, 21);
  assert.equal(state.rounds.length, 22);
});

test("official streak keeps a cached boundary outside the API window", async () => {
  const priorRounds = [standing(100, 2)];
  for (let roundNumber = 101; roundNumber <= 219; roundNumber++) {
    priorRounds.push(standing(roundNumber));
  }
  const state = await buildOfficialStreakState(stateArgs({
    competitionRounds: Array.from({ length: 101 }, (_, index) => round(120 + index)),
    currentStandings: Array.from({ length: 20 }, (_, index) => standing(201 + index)),
    priorState: { rounds: priorRounds },
  }));

  assert.equal(state.boundary_round_number, 100);
  assert.equal(state.last_round_number, 220);
  assert.equal(state.current_first_place_streak, 120);
});

test("official streak resets on the latest non-first finish", async () => {
  const state = await buildOfficialStreakState(stateArgs({
    competitionRounds: [round(208), round(207)],
    currentStandings: [standing(207), standing(208, 2)],
  }));

  assert.equal(state.boundary_round_number, 208);
  assert.equal(state.last_round_number, 208);
  assert.equal(state.current_first_place_streak, 0);
  assert.deepEqual(state.rounds.map(({ round_number }) => round_number), [208]);
});

test("generated dashboard uses the persisted official streak", async () => {
  const [official, snapshotRows] = await Promise.all([
    readFile(new URL("../data/processed/official_streak.json", import.meta.url), "utf8"),
    readFile(new URL("../site/data/snapshot.json", import.meta.url), "utf8"),
  ]).then((files) => files.map((file) => JSON.parse(file)));
  const [snapshot] = snapshotRows;

  assert.equal(official.last_round_number, snapshot.last_completed_round);
  assert.equal(official.current_first_place_streak, snapshot.current_first_place_streak);
});

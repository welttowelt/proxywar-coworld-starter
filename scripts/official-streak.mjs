export async function buildOfficialStreakState({
  competitionRounds,
  currentStandings,
  priorState,
  trackedPlayerName,
  leagueID,
  collectedAt,
  loadStanding,
}) {
  const officialByRound = new Map(
    (Array.isArray(priorState?.rounds) ? priorState.rounds : [])
      .map((standing) => [standing.round_number, standing]),
  );
  for (const standing of currentStandings) {
    if (standing.player_name === trackedPlayerName) {
      officialByRound.set(standing.round_number, standing);
    }
  }

  const descending = [];
  const visited = new Set();
  const completedRounds = competitionRounds
    .filter((round) => round.status === "completed")
    .sort((left, right) => right.round_number - left.round_number);
  let trackingStarted = false;
  let boundaryReached = false;
  for (const round of completedRounds) {
    let standing = officialByRound.get(round.round_number);
    if (!standing) {
      standing = await loadStanding(round);
      if (standing) officialByRound.set(round.round_number, standing);
    }
    if (!standing) {
      if (trackingStarted) {
        boundaryReached = true;
        break;
      }
      continue;
    }
    trackingStarted = true;
    descending.push(standing);
    visited.add(standing.round_number);
    if (standing.rank !== 1) {
      boundaryReached = true;
      break;
    }
  }

  if (!boundaryReached) {
    const priorDescending = [...officialByRound.values()]
      .filter((standing) => !visited.has(standing.round_number))
      .sort((left, right) => right.round_number - left.round_number);
    for (const standing of priorDescending) {
      descending.push(standing);
      if (standing.rank !== 1) break;
    }
  }
  if (descending.length === 0) {
    throw new Error(`no official standings found for ${trackedPlayerName}`);
  }

  const firstNonWin = descending.findIndex((standing) => standing.rank !== 1);
  return {
    schema_version: 1,
    league_id: leagueID,
    player_name: trackedPlayerName,
    collected_at: collectedAt,
    last_round_number: descending[0].round_number,
    boundary_round_number: descending
      .find((standing) => standing.rank !== 1)?.round_number ?? null,
    current_first_place_streak: firstNonWin === -1 ? descending.length : firstNonWin,
    first_place_finishes: descending.filter((standing) => standing.rank === 1).length,
    rounds: [...descending].reverse(),
  };
}

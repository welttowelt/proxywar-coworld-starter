const DATA_FILES = {
  snapshot: "snapshot.json",
  rounds: "rounds.json",
  standings: "round-standings.json",
  ourResults: "our-results.json",
  ffaPlayers: "ffa-players.json",
  outcomeProfile: "outcome-profile.json",
  seatPerformance: "seat-performance.json",
  leaderboard: "leaderboard.json",
  liveRounds: "live-rounds.json",
  memberships: "memberships.json",
};

const OUR_PLAYER = "odin free";
const numberFormat = new Intl.NumberFormat("en-CH");
const dateFormat = new Intl.DateTimeFormat("en-CH", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const byId = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatInteger(value) {
  return numberFormat.format(asNumber(value));
}

function formatDecimal(value, digits = 1) {
  return asNumber(value).toFixed(digits);
}

function formatDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : dateFormat.format(date);
}

function ordinal(value) {
  const number = asNumber(value);
  const remainder = number % 100;
  if (remainder >= 11 && remainder <= 13) return `${number}th`;
  if (number % 10 === 1) return `${number}st`;
  if (number % 10 === 2) return `${number}nd`;
  if (number % 10 === 3) return `${number}rd`;
  return `${number}th`;
}

function widthPercent(value, maximum) {
  if (maximum <= 0) return 0;
  return Math.max(0, Math.min(100, (asNumber(value) / maximum) * 100));
}

function widthClass(value) {
  const bounded = Math.max(0, Math.min(100, asNumber(value)));
  return `w-${Math.round(bounded / 5) * 5}`;
}

function isWinnerRow(row) {
  return row.won === true || String(row.won).toLowerCase() === "true";
}

async function loadData() {
  const cacheKey = Date.now();
  const entries = await Promise.all(
    Object.entries(DATA_FILES).map(async ([key, filename]) => {
      const response = await fetch(`./data/${filename}?v=${cacheKey}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${filename}: HTTP ${response.status}`);
      return [key, await response.json()];
    }),
  );
  return Object.fromEntries(entries);
}

function renderOverview(data) {
  const snapshot = data.snapshot[0] ?? {};
  const ourResults = [...data.ourResults].sort(
    (left, right) => asNumber(right.round_number) - asNumber(left.round_number),
  );
  const latestResult = ourResults[0] ?? {};
  const ourFfa = data.ffaPlayers.find((row) => row.player_name === OUR_PLAYER) ?? {};
  const champion = data.memberships.find((membership) => membership.is_champion === true);
  const liveRound = data.liveRounds.find((round) => round.status === "running");
  const latestRound = liveRound ?? data.liveRounds[0] ?? {};
  const livePolicy = liveRound
    ? data.memberships.find((membership) =>
      liveRound.entrant_policy_version_ids?.includes(membership.policy_version_id))
    : null;
  const championIsLive = Boolean(
    liveRound && champion && liveRound.entrant_policy_version_ids?.includes(champion.policy_version_id),
  );
  const progression = [...ourResults]
    .reverse()
    .map((result) => asNumber(result.rank))
    .join(" -> ");

  const headerState = byId("header-state");
  headerState.dataset.status = latestRound.status ?? "completed";
  headerState.lastElementChild.textContent = liveRound
    ? `Round ${liveRound.round_number} / running`
    : `Round ${latestRound.round_number ?? "--"} / ${latestRound.status ?? "snapshot"}`;

  byId("overview-line").textContent = ourResults.length
    ? `Official trail ${progression}. ${formatInteger(snapshot.collected_rounds)} completed rounds and ${formatInteger(snapshot.decisions)} decisions indexed.`
    : "No official entries found in the collected window.";

  if (liveRound) {
    byId("state-title").textContent = `Round ${liveRound.round_number} is running`;
    if (championIsLive) {
      byId("state-copy").textContent = `${champion.policy_label} is in the active roster.`;
    } else if (livePolicy && champion) {
      byId("state-copy").textContent = `v${livePolicy.policy_version} entered before v${champion.policy_version} was promoted. The champion is queued for the next roster snapshot.`;
    } else {
      byId("state-copy").textContent = "The active round predates the latest champion promotion.";
    }
  } else {
    byId("state-title").textContent = `Round ${latestRound.round_number ?? "--"} ${latestRound.status ?? "snapshot"}`;
    byId("state-copy").textContent = champion
      ? `${champion.policy_label} is the active league champion.`
      : "No active champion was found in this snapshot.";
  }

  byId("active-policy").textContent = champion
    ? `v${champion.policy_version} / ${champion.substatus}`
    : "Unknown";
  byId("snapshot-time").textContent = formatDate(snapshot.collected_at);
  byId("latest-finish").textContent = latestResult.rank ? ordinal(latestResult.rank) : "--";
  byId("latest-finish-note").textContent = latestResult.round_number
    ? `Round ${latestResult.round_number} / v${latestResult.policy_version} / score ${formatDecimal(latestResult.score, 2)}`
    : "Official rank";
  byId("our-win-rate").textContent = ourFfa.win_rate_pct !== undefined
    ? `${formatDecimal(ourFfa.win_rate_pct)}%`
    : "--";
  byId("our-win-note").textContent = ourFfa.matches
    ? `${formatInteger(ourFfa.wins)} wins / ${formatInteger(ourFfa.matches)} matches`
    : "Collected matches";
  byId("progression").textContent = snapshot.target_first_place_streak
    ? `${formatInteger(snapshot.current_first_place_streak)} / ${formatInteger(snapshot.target_first_place_streak)}`
    : "--";
  byId("decision-count").textContent = formatInteger(snapshot.decisions);
  byId("quality-note").textContent = asNumber(snapshot.data_quality_failures) === 0
    ? "0 validation failures"
    : `${formatInteger(snapshot.data_quality_failures)} validation failures`;
}

function renderPlacementTrail(results) {
  const ordered = [...results].sort(
    (left, right) => asNumber(left.round_number) - asNumber(right.round_number),
  );
  byId("entry-count").textContent = `${ordered.length} ${ordered.length === 1 ? "entry" : "entries"}`;
  byId("placement-trail").innerHTML = ordered.map((result) => {
    const rank = asNumber(result.rank);
    const width = Math.max(18, widthPercent(5 - rank, 4));
    return `
      <div class="placement-row">
        <span class="placement-round">R${escapeHtml(result.round_number)}</span>
        <div
          class="placement-track"
          role="img"
          aria-label="Round ${escapeHtml(result.round_number)}, ${escapeHtml(ordinal(rank))} place"
        ><span class="${widthClass(width)}"></span></div>
        <strong class="placement-rank">#${escapeHtml(rank)}</strong>
        <span class="placement-version">v${escapeHtml(result.policy_version)}</span>
      </div>
    `;
  }).join("");
}

function renderLiveRound(data) {
  const champion = data.memberships.find((membership) => membership.is_champion === true);
  const liveRound = data.liveRounds.find((round) => round.status === "running");
  const round = liveRound ?? data.liveRounds[0] ?? {};
  const roundPolicy = data.memberships.find((membership) =>
    round.entrant_policy_version_ids?.includes(membership.policy_version_id));

  byId("live-round-title").textContent = round.round_number
    ? `Round ${round.round_number}`
    : "Latest round";
  const badge = byId("live-badge");
  badge.textContent = round.status ?? "Unknown";
  badge.dataset.status = round.status ?? "unknown";
  byId("live-value").textContent = round.status === "running" ? "In play" : "Complete";

  if (round.status === "running" && roundPolicy && champion) {
    byId("live-copy").textContent = roundPolicy.policy_version_id === champion.policy_version_id
      ? `Champion v${champion.policy_version} is competing in this round.`
      : `v${roundPolicy.policy_version} is competing. Champion v${champion.policy_version} was promoted after roster lock.`;
  } else if (round.status === "running") {
    byId("live-copy").textContent = "Competition is running with the roster captured in this snapshot.";
  } else {
    const ourStanding = data.standings.find((standing) =>
      standing.round_id === round.round_id && standing.player_name === OUR_PLAYER);
    byId("live-copy").textContent = ourStanding
      ? `v${ourStanding.policy_version} finished ${ordinal(ourStanding.rank)} with score ${formatDecimal(ourStanding.score, 2)} across ${ourStanding.completed_episode_count} episodes.`
      : champion
        ? `Champion v${champion.policy_version} is ready for the next competition roster.`
        : "Waiting for the next competition roster.";
  }

  byId("live-entrants").textContent = `${formatInteger(round.entrant_count)} entrants`;
  byId("live-started").textContent = round.status === "running"
    ? `Started ${formatDate(round.started_at)}`
    : `Completed ${formatDate(round.completed_at)}`;
}

function tableRows(rows) {
  return rows.map((row) => {
    const ours = row.player_name === OUR_PLAYER;
    const policy = row.policy_name
      ? `${row.policy_name}:v${row.policy_version}`
      : `v${row.policy_version ?? "--"}`;
    return `
      <tr data-player="${ours ? "ours" : "field"}">
        <td>R${escapeHtml(row.round_number)}</td>
        <td class="rank-cell">#${escapeHtml(row.rank)}</td>
        <td title="${escapeHtml(row.player_name)}">${escapeHtml(row.player_name)}</td>
        <td>${escapeHtml(formatDecimal(row.score, 2))}</td>
        <td title="${escapeHtml(policy)}">${escapeHtml(policy)}</td>
        <td>${escapeHtml(row.completed_episode_count ?? "--")}</td>
      </tr>
    `;
  }).join("");
}

function renderStandings(data) {
  const body = byId("standings-body");
  const title = byId("table-title");
  const tabs = [...document.querySelectorAll("[data-view]")];

  const setView = (view) => {
    tabs.forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.view === view)));
    const rows = view === "ours" ? data.ourResults : data.standings;
    title.textContent = view === "ours" ? "Our round history" : "All collected standings";
    body.innerHTML = tableRows(rows);
  };

  tabs.forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));
  setView("ours");
}

function renderPlayerBars(players) {
  const maximum = Math.max(1, ...players.map((player) => asNumber(player.win_rate_pct)));
  byId("player-bars").innerHTML = players.map((player) => {
    const ours = player.player_name === OUR_PLAYER;
    const rate = asNumber(player.win_rate_pct);
    return `
      <div class="bar-row" data-player="${ours ? "ours" : "field"}">
        <span class="bar-name" title="${escapeHtml(player.player_name)}">${escapeHtml(player.player_name)}</span>
        <div
          class="bar-track"
          role="img"
          aria-label="${escapeHtml(player.player_name)} win rate ${escapeHtml(formatDecimal(rate))} percent"
        ><span class="${widthClass(widthPercent(rate, maximum))}"></span></div>
        <span class="bar-value">${escapeHtml(player.wins)}/${escapeHtml(player.matches)} / ${escapeHtml(formatDecimal(rate))}%</span>
      </div>
    `;
  }).join("");
}

function renderOutcomeProfile(rows) {
  const winner = rows.find(isWinnerRow) ?? {};
  const field = rows.find((row) => !isWinnerRow(row)) ?? {};
  const metrics = [
    ["Rival attacks", "rival_attacks_per_100_decisions"],
    ["Neutral attacks", "neutral_attacks_per_100_decisions"],
    ["Builds", "builds_per_100_decisions"],
    ["Social", "social_per_100_decisions"],
  ];

  byId("profile-list").innerHTML = metrics.map(([label, key]) => {
    const winnerValue = asNumber(winner[key]);
    const fieldValue = asNumber(field[key]);
    const maximum = Math.max(1, winnerValue, fieldValue);
    return `
      <div class="profile-metric">
        <span>${escapeHtml(label)}</span>
        <div class="profile-pair">
          <div class="profile-line" data-kind="winner">
            <div class="profile-track"><span class="${widthClass(widthPercent(winnerValue, maximum))}"></span></div>
            <strong>${escapeHtml(formatDecimal(winnerValue))}</strong>
          </div>
          <div class="profile-line" data-kind="field">
            <div class="profile-track"><span class="${widthClass(widthPercent(fieldValue, maximum))}"></span></div>
            <strong>${escapeHtml(formatDecimal(fieldValue))}</strong>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function renderSeatBars(seats) {
  byId("seat-bars").innerHTML = seats.map((seat) => {
    const rate = asNumber(seat.win_rate_pct);
    return `
      <div class="seat-row" data-active="${rate > 0}">
        <span class="seat-label">Seat ${asNumber(seat.participant_position) + 1}</span>
        <div
          class="seat-track"
          role="img"
          aria-label="Seat ${asNumber(seat.participant_position) + 1} win rate ${escapeHtml(formatDecimal(rate))} percent"
        ><span class="${widthClass(rate)}"></span></div>
        <span class="seat-value">${escapeHtml(seat.wins)}/${escapeHtml(seat.player_matches)} / ${escapeHtml(formatDecimal(rate))}%</span>
      </div>
    `;
  }).join("");
}

function renderSignals(data) {
  const winner = data.outcomeProfile.find(isWinnerRow) ?? {};
  const field = data.outcomeProfile.find((row) => !isWinnerRow(row)) ?? {};
  const attackRatio = asNumber(field.rival_attacks_per_100_decisions) > 0
    ? asNumber(winner.rival_attacks_per_100_decisions) / asNumber(field.rival_attacks_per_100_decisions)
    : 0;
  const totalSeatWins = data.seatPerformance.reduce((sum, seat) => sum + asNumber(seat.wins), 0);
  const edgeSeatWins = data.seatPerformance
    .filter((seat) => [0, 3].includes(asNumber(seat.participant_position)))
    .reduce((sum, seat) => sum + asNumber(seat.wins), 0);
  const ourFfa = data.ffaPlayers.find((row) => row.player_name === OUR_PLAYER) ?? {};
  const nearest = data.ffaPlayers
    .filter((row) => row.player_name !== OUR_PLAYER)
    .sort((left, right) => asNumber(right.win_rate_pct) - asNumber(left.win_rate_pct))[0] ?? {};
  const champion = data.memberships.find((membership) => membership.is_champion === true);
  const liveRound = data.liveRounds.find((round) => round.status === "running");
  const championIsLive = Boolean(
    liveRound && champion && liveRound.entrant_policy_version_ids?.includes(champion.policy_version_id),
  );
  const edge = asNumber(ourFfa.win_rate_pct) - asNumber(nearest.win_rate_pct);

  const signals = [
    `<strong>Attack tempo:</strong> winners attack rivals ${formatDecimal(attackRatio)}x as often per decision as the field.`,
    `<strong>Seat exposure:</strong> seats 1 and 4 account for ${formatInteger(edgeSeatWins)} of ${formatInteger(totalSeatWins)} observed FFA wins.`,
    `<strong>Our edge:</strong> ${formatDecimal(ourFfa.win_rate_pct)}% win rate, ${formatDecimal(edge)} points above the nearest field rate.`,
    champion
      ? `<strong>Policy state:</strong> v${escapeHtml(champion.policy_version)} is champion${liveRound && !championIsLive ? `; Round ${escapeHtml(liveRound.round_number)} locked its roster before promotion.` : "."}`
      : "<strong>Policy state:</strong> no champion was present in the snapshot.",
  ];

  byId("signal-list").innerHTML = signals.map((signal) => `<li><span>${signal}</span></li>`).join("");
}

function renderDataLedger(data) {
  const snapshot = data.snapshot[0] ?? {};
  byId("round-count").textContent = formatInteger(snapshot.collected_rounds);
  byId("episode-count").textContent = formatInteger(snapshot.episodes);
  byId("participant-count").textContent = formatInteger(snapshot.participant_rows);
  byId("quality-count").textContent = formatInteger(snapshot.data_quality_failures);
  byId("footer-snapshot").textContent = `Updated ${formatDate(snapshot.collected_at)}`;
}

async function main() {
  try {
    const data = await loadData();
    renderOverview(data);
    renderPlacementTrail(data.ourResults);
    renderLiveRound(data);
    renderStandings(data);
    renderPlayerBars(data.ffaPlayers);
    renderOutcomeProfile(data.outcomeProfile);
    renderSeatBars(data.seatPerformance);
    renderSignals(data);
    renderDataLedger(data);
  } catch (error) {
    console.error(error);
    byId("fatal-state").hidden = false;
    const headerState = byId("header-state");
    headerState.dataset.status = "failed";
    headerState.lastElementChild.textContent = "Snapshot unavailable";
  }
}

main();

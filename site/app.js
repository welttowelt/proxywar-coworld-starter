const DATA_FILES = {
  snapshot: "snapshot.json",
  rounds: "rounds.json",
  standings: "round-standings.json",
  ourResults: "our-results.json",
  ffaPlayers: "ffa-players.json",
  dominanceTrend: "dominance-trend.json",
  policyCodenames: "policy-codenames.json",
  mapPerformance: "map-performance.json",
  outcomeProfile: "outcome-profile.json",
  seatPerformance: "seat-performance.json",
  tacticalAdherence: "tactical-adherence.json",
  leaderboard: "leaderboard.json",
  liveRounds: "live-rounds.json",
  memberships: "memberships.json",
};

const OUR_PLAYER = "odin free";
const AUTO_REFRESH_MS = 60_000;
const numberFormat = new Intl.NumberFormat("en-CH");
const dateFormat = new Intl.DateTimeFormat("en-CH", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const byId = (id) => document.getElementById(id);
let policyCodenames = new Map();

function setPolicyCodenames(rows) {
  policyCodenames = new Map(rows.map((row) => [
    String(row.version).replace(/^v/, ""),
    row,
  ]));
}

function publicPolicyLabel(version) {
  const key = String(version ?? "--").replace(/^v/, "");
  const release = policyCodenames.get(key);
  return release ? `v${key} / ${release.codename}` : `v${key}`;
}

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
      byId("state-copy").textContent = `${publicPolicyLabel(champion.policy_version)} is in the active roster.`;
    } else if (livePolicy && champion) {
      byId("state-copy").textContent = `${publicPolicyLabel(livePolicy.policy_version)} entered before ${publicPolicyLabel(champion.policy_version)} was promoted. The champion is queued for the next roster snapshot.`;
    } else {
      byId("state-copy").textContent = "The active round predates the latest champion promotion.";
    }
  } else {
    byId("state-title").textContent = `Round ${latestRound.round_number ?? "--"} ${latestRound.status ?? "snapshot"}`;
    byId("state-copy").textContent = champion
      ? `${publicPolicyLabel(champion.policy_version)} is the active league champion.`
      : "No active champion was found in this snapshot.";
  }

  byId("active-policy").textContent = champion
    ? `${publicPolicyLabel(champion.policy_version)} / ${champion.substatus}`
    : "Unknown";
  byId("snapshot-time").textContent = formatDate(snapshot.collected_at);
  byId("latest-finish").textContent = latestResult.rank ? ordinal(latestResult.rank) : "--";
  byId("latest-finish-note").textContent = latestResult.round_number
    ? `Round ${latestResult.round_number} / ${publicPolicyLabel(latestResult.policy_version)} / score ${formatDecimal(latestResult.score, 2)}`
    : "Official rank";
  byId("our-win-rate").textContent = ourFfa.win_rate_pct !== undefined
    ? `${formatDecimal(ourFfa.win_rate_pct)}%`
    : "--";
  byId("our-win-note").textContent = ourFfa.matches
    ? `${formatInteger(ourFfa.wins)} / ${formatInteger(ourFfa.matches)} outright; target ${formatInteger(snapshot.target_ffa_wins)} / ${formatInteger(snapshot.current_ffa_matches)}`
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
      ? `${publicPolicyLabel(champion.policy_version)} is competing in this round.`
      : `${publicPolicyLabel(roundPolicy.policy_version)} is competing. ${publicPolicyLabel(champion.policy_version)} was promoted after roster lock.`;
  } else if (round.status === "running") {
    byId("live-copy").textContent = "Competition is running with the roster captured in this snapshot.";
  } else {
    const ourStanding = data.standings.find((standing) =>
      standing.round_id === round.round_id && standing.player_name === OUR_PLAYER);
    byId("live-copy").textContent = ourStanding
      ? `${publicPolicyLabel(ourStanding.policy_version)} finished ${ordinal(ourStanding.rank)} with score ${formatDecimal(ourStanding.score, 2)} across ${ourStanding.completed_episode_count} episodes.`
      : champion
        ? `${publicPolicyLabel(champion.policy_version)} is ready for the next competition roster.`
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
    const policy = row.player_name === OUR_PLAYER
      ? publicPolicyLabel(row.policy_version)
      : `${row.player_name} / v${row.policy_version ?? "--"}`;
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

  tabs.forEach((tab) => {
    tab.onclick = () => setView(tab.dataset.view);
  });
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

function renderMapPerformance(data) {
  const champion = data.memberships.find((membership) => membership.is_champion === true);
  const maps = ["Pangaea", "Asia", "Europe"];

  byId("map-grid").innerHTML = maps.map((mapName) => {
    const ourRows = data.mapPerformance
      .filter((row) => row.map === mapName && row.player_name === OUR_PLAYER)
      .sort((left, right) => asNumber(right.policy_version) - asNumber(left.policy_version));
    const championRow = ourRows.find((row) =>
      asNumber(row.policy_version) === asNumber(champion?.policy_version));
    const ourRow = championRow ?? ourRows[0] ?? {};
    const auriRow = data.mapPerformance
      .filter((row) => row.map === mapName && row.player_name === "Auri")
      .sort((left, right) => asNumber(right.policy_version) - asNumber(left.policy_version))[0] ?? {};
    const policyState = championRow ? "champion" : "baseline";

    return `
      <section class="map-column" aria-label="${escapeHtml(mapName)} policy performance">
        <div class="map-title-row">
          <h4>${escapeHtml(mapName)}</h4>
          <span class="codename">${ourRow.policy_version ? `${escapeHtml(publicPolicyLabel(ourRow.policy_version))} / ${policyState}` : "No sample"}</span>
        </div>
        <dl class="map-stats">
          <div>
            <dt>Scored seats</dt>
            <dd>${escapeHtml(ourRow.episode_points ?? "--")}/${escapeHtml(ourRow.matches ?? "--")} / ${ourRow.point_rate_pct !== undefined ? `${escapeHtml(formatDecimal(ourRow.point_rate_pct))}%` : "--"}</dd>
          </div>
          <div>
            <dt>Mean territory</dt>
            <dd>${ourRow.mean_final_tiles !== undefined ? escapeHtml(formatInteger(ourRow.mean_final_tiles)) : "--"}</dd>
          </div>
          <div>
            <dt>Neutral boats / 100</dt>
            <dd>${ourRow.neutral_boats_per_100_decisions !== undefined ? escapeHtml(formatDecimal(ourRow.neutral_boats_per_100_decisions)) : "--"}</dd>
          </div>
          <div>
            <dt>Holds</dt>
            <dd>${escapeHtml(ourRow.holds ?? "--")}</dd>
          </div>
          <div>
            <dt>Auri scored seats</dt>
            <dd>${auriRow.episode_points !== undefined ? `${escapeHtml(auriRow.episode_points)}/${escapeHtml(auriRow.matches)} / ${escapeHtml(formatDecimal(auriRow.point_rate_pct))}%` : "--"}</dd>
          </div>
        </dl>
      </section>
    `;
  }).join("");
}

function renderDominanceTrend(data) {
  const rows = [...data.dominanceTrend]
    .sort((left, right) => asNumber(left.round_number) - asNumber(right.round_number));
  const chart = byId("dominance-chart");
  const readout = byId("dominance-readout");
  const snapshot = data.snapshot[0] ?? {};

  if (rows.length === 0) {
    chart.innerHTML = "";
    readout.textContent = "No four-player trend data is available.";
    return;
  }

  const latest = rows.at(-1);
  const previous = rows[Math.max(0, rows.length - 6)];
  const latestAuri = data.standings
    .filter((standing) => standing.player_name === "Auri")
    .sort((left, right) => asNumber(right.round_number) - asNumber(left.round_number))[0];
  const change = asNumber(latest.odin_rolling_win_rate_pct) - asNumber(previous.odin_rolling_win_rate_pct);
  const currentMatches = asNumber(snapshot.current_ffa_matches);
  const currentWins = asNumber(snapshot.current_ffa_wins);
  const targetWins = asNumber(snapshot.target_ffa_wins, Math.ceil(currentMatches * 0.99));

  byId("dominance-window").textContent = `${currentWins}/${currentMatches}`;
  byId("dominance-window-note").textContent = `${formatDecimal(snapshot.current_ffa_win_rate_pct)}% outright`;
  byId("dominance-form").textContent = `${formatDecimal(latest.odin_rolling_win_rate_pct)}%`;
  byId("dominance-form-note").textContent = `${latest.rolling_wins}/${latest.rolling_matches} over five rounds`;
  byId("dominance-gap").textContent = `${change >= 0 ? "+" : ""}${formatDecimal(change)} pts`;
  byId("dominance-gap-note").textContent = "vs five rounds ago";
  byId("dominance-target").textContent = `${formatDecimal(snapshot.target_ffa_win_rate_pct, 0)}%`;
  byId("dominance-target-note").textContent = `${targetWins}/${currentMatches} needed in this window`;
  byId("challenger-state").textContent = latestAuri
    ? `auri v${latestAuri.policy_version} / 99% target`
    : "challenger unknown / 99% target";

  const compact = window.matchMedia("(max-width: 520px)").matches;
  const width = compact ? 340 : 980;
  const height = compact ? 300 : 350;
  const margin = compact
    ? { top: 24, right: 10, bottom: 38, left: 38 }
    : { top: 26, right: 24, bottom: 42, left: 52 };
  chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
  chart.style.aspectRatio = `${width} / ${height}`;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const x = (index) => margin.left + (rows.length === 1 ? plotWidth / 2 : plotWidth * index / (rows.length - 1));
  const y = (value) => margin.top + plotHeight * (1 - Math.max(0, Math.min(100, asNumber(value))) / 100);
  const linePath = (key) => rows.map((row, index) =>
    `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(row[key]).toFixed(1)}`,
  ).join(" ");
  const areaPath = [
    `M${x(0).toFixed(1)},${(margin.top + plotHeight).toFixed(1)}`,
    ...rows.map((row, index) => `L${x(index).toFixed(1)},${y(row.odin_rolling_win_rate_pct).toFixed(1)}`),
    `L${x(rows.length - 1).toFixed(1)},${(margin.top + plotHeight).toFixed(1)} Z`,
  ].join(" ");
  const yTicks = [0, 25, 50, 75, 99];
  const xStep = Math.max(1, Math.ceil(rows.length / 6));
  const hitWidth = plotWidth / Math.max(1, rows.length - 1);

  chart.innerHTML = `
    <g class="chart-grid">
      ${yTicks.map((tick) => `
        <line x1="${margin.left}" y1="${y(tick)}" x2="${width - margin.right}" y2="${y(tick)}"></line>
        <text x="${margin.left - 12}" y="${y(tick) + 4}" text-anchor="end">${tick}%</text>
      `).join("")}
      ${rows.map((row, index) => (index % xStep === 0 || index === rows.length - 1) ? `
        <text x="${x(index)}" y="${height - 13}" text-anchor="middle">R${escapeHtml(row.round_number)}</text>
      ` : "").join("")}
    </g>
    <path class="chart-area" d="${areaPath}"></path>
    <line class="chart-target" x1="${margin.left}" y1="${y(99)}" x2="${width - margin.right}" y2="${y(99)}"></line>
    <path class="chart-rival-line" d="${linePath("best_rival_rolling_win_rate_pct")}"></path>
    <path class="chart-odin-line" d="${linePath("odin_rolling_win_rate_pct")}"></path>
    <g class="chart-points">
      ${rows.map((row, index) => `
        <circle class="chart-rival-point" cx="${x(index)}" cy="${y(row.best_rival_rolling_win_rate_pct)}" r="3"></circle>
        <circle class="chart-odin-point" cx="${x(index)}" cy="${y(row.odin_rolling_win_rate_pct)}" r="4"></circle>
      `).join("")}
    </g>
    <g class="chart-cursor" id="dominance-cursor">
      <line x1="${x(rows.length - 1)}" y1="${margin.top}" x2="${x(rows.length - 1)}" y2="${margin.top + plotHeight}"></line>
      <circle id="dominance-cursor-odin" cx="${x(rows.length - 1)}" cy="${y(latest.odin_rolling_win_rate_pct)}" r="7"></circle>
      <circle id="dominance-cursor-rival" cx="${x(rows.length - 1)}" cy="${y(latest.best_rival_rolling_win_rate_pct)}" r="6"></circle>
    </g>
    <g class="chart-hit-zones">
      ${rows.map((row, index) => `
        <rect
          data-dominance-index="${index}"
          x="${Math.max(margin.left, x(index) - hitWidth / 2)}"
          y="${margin.top}"
          width="${index === 0 || index === rows.length - 1 ? hitWidth / 2 : hitWidth}"
          height="${plotHeight}"
          tabindex="0"
          role="button"
          aria-label="Round ${escapeHtml(row.round_number)}: Odin ${escapeHtml(formatDecimal(row.odin_rolling_win_rate_pct))} percent, best rival ${escapeHtml(formatDecimal(row.best_rival_rolling_win_rate_pct))} percent"
        ></rect>
      `).join("")}
    </g>
  `;

  const setActiveRound = (index) => {
    const row = rows[index];
    const cursor = byId("dominance-cursor");
    const cursorX = x(index);
    const cursorLine = cursor.querySelector("line");
    cursorLine.setAttribute("x1", cursorX);
    cursorLine.setAttribute("x2", cursorX);
    byId("dominance-cursor-odin").setAttribute("cx", cursorX);
    byId("dominance-cursor-odin").setAttribute("cy", y(row.odin_rolling_win_rate_pct));
    byId("dominance-cursor-rival").setAttribute("cx", cursorX);
    byId("dominance-cursor-rival").setAttribute("cy", y(row.best_rival_rolling_win_rate_pct));
    const gap = asNumber(row.dominance_gap_pct);
    readout.textContent = `R${row.round_number} / odin ${row.rolling_wins}/${row.rolling_matches} (${formatDecimal(row.odin_rolling_win_rate_pct)}%) / ${row.best_rival_name} ${row.best_rival_rolling_wins}/${row.best_rival_rolling_matches} (${formatDecimal(row.best_rival_rolling_win_rate_pct)}%) / gap ${gap >= 0 ? "+" : ""}${formatDecimal(gap)} pts`;
  };

  chart.querySelectorAll("[data-dominance-index]").forEach((zone) => {
    const activate = () => setActiveRound(asNumber(zone.dataset.dominanceIndex));
    zone.onpointerenter = activate;
    zone.onfocus = activate;
  });
  chart.onpointerleave = () => setActiveRound(rows.length - 1);
  setActiveRound(rows.length - 1);
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
  const latestAuri = data.standings
    .filter((standing) => standing.player_name === "Auri")
    .sort((left, right) => asNumber(right.round_number) - asNumber(left.round_number))[0];
  const auriVersions = new Set(
    data.standings
      .filter((standing) => standing.player_name === "Auri")
      .map((standing) => String(standing.policy_version)),
  );
  const liveRound = data.liveRounds.find((round) => round.status === "running");
  const championIsLive = Boolean(
    liveRound && champion && liveRound.entrant_policy_version_ids?.includes(champion.policy_version_id),
  );
  const edge = asNumber(ourFfa.win_rate_pct) - asNumber(nearest.win_rate_pct);
  const adherenceRate = (tactic, won) => {
    const rows = data.tacticalAdherence.filter((row) =>
      row.tactic === tactic && isWinnerRow({ won: row.won }) === won);
    const recommendations = rows.reduce(
      (sum, row) => sum + asNumber(row.recommendations),
      0,
    );
    const aligned = rows.reduce((sum, row) => sum + asNumber(row.aligned), 0);
    return recommendations > 0 ? 100 * aligned / recommendations : 0;
  };
  const v5Adherence = (tactic) => asNumber(
    data.tacticalAdherence.find((row) =>
      row.player_name === OUR_PLAYER && asNumber(row.policy_version) === 5 &&
      isWinnerRow({ won: row.won }) && row.tactic === tactic)?.adherence_rate_pct,
  );
  const winnerOpening = adherenceRate("opening_tempo", true);
  const fieldOpening = adherenceRate("opening_tempo", false);
  const winnerEconomy = adherenceRate("economy_cadence", true);
  const fieldEconomy = adherenceRate("economy_cadence", false);

  const signals = [
    `<strong>Attack tempo:</strong> winners attack rivals ${formatDecimal(attackRatio)}x as often per decision as the field.`,
    `<strong>Opening discipline:</strong> winners follow the tempo signal ${formatDecimal(winnerOpening)}% vs ${formatDecimal(fieldOpening)}%; v5 is ${formatDecimal(v5Adherence("opening_tempo"))}%.`,
    `<strong>Economy trap:</strong> non-winners follow build recommendations ${formatDecimal(fieldEconomy)}% vs winners at ${formatDecimal(winnerEconomy)}%; v5 stays at ${formatDecimal(v5Adherence("economy_cadence"))}%.`,
    `<strong>Seat exposure:</strong> seats 1 and 4 account for ${formatInteger(edgeSeatWins)} of ${formatInteger(totalSeatWins)} observed FFA wins.`,
    `<strong>Our edge:</strong> ${formatDecimal(ourFfa.win_rate_pct)}% win rate, ${formatDecimal(edge)} points above the nearest field rate.`,
    champion
      ? `<strong>Policy state:</strong> ${escapeHtml(publicPolicyLabel(champion.policy_version))} is champion${liveRound && !championIsLive ? `; Round ${escapeHtml(liveRound.round_number)} locked its roster before promotion.` : "."}`
      : "<strong>Policy state:</strong> no champion was present in the snapshot.",
    latestAuri
      ? `<strong>Challenger drift:</strong> Auri is on v${escapeHtml(latestAuri.policy_version)} in Round ${escapeHtml(latestAuri.round_number)}; ${formatInteger(auriVersions.size)} version${auriVersions.size === 1 ? "" : "s"} observed in this window.`
      : "<strong>Challenger drift:</strong> no Auri policy was present in the collected window.",
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

let refreshInFlight = false;
let hasRendered = false;
let hasAlignedHash = false;

function alignHashTarget() {
  if (hasAlignedHash || !window.location.hash) return;

  let targetId;
  try {
    targetId = decodeURIComponent(window.location.hash.slice(1));
  } catch {
    hasAlignedHash = true;
    return;
  }
  const target = document.getElementById(targetId);
  if (!target) return;

  hasAlignedHash = true;
  requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
}

async function refreshDashboard() {
  if (refreshInFlight) return;
  refreshInFlight = true;

  try {
    const data = await loadData();
    setPolicyCodenames(data.policyCodenames);
    renderOverview(data);
    renderPlacementTrail(data.ourResults);
    renderLiveRound(data);
    renderStandings(data);
    renderPlayerBars(data.ffaPlayers);
    renderOutcomeProfile(data.outcomeProfile);
    renderSeatBars(data.seatPerformance);
    renderDominanceTrend(data);
    renderMapPerformance(data);
    renderSignals(data);
    renderDataLedger(data);
    byId("fatal-state").hidden = true;
    hasRendered = true;
    alignHashTarget();
  } catch (error) {
    console.error(error);
    if (!hasRendered) {
      byId("fatal-state").hidden = false;
      const headerState = byId("header-state");
      headerState.dataset.status = "failed";
      headerState.lastElementChild.textContent = "Snapshot unavailable";
    }
  } finally {
    refreshInFlight = false;
  }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refreshDashboard();
});

void refreshDashboard();
setInterval(() => void refreshDashboard(), AUTO_REFRESH_MS);

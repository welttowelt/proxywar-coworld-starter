export const ODIN_PLAYER_ID = "ply_ad3816d3-f9d7-4430-9dd7-1c6afd49757c";
export const ODIN_CANONICAL_NAME = "odin free";

export function canonicalDashboardPlayerName(playerName, playerID = null) {
  if (playerID === ODIN_PLAYER_ID) return ODIN_CANONICAL_NAME;
  const normalized = String(playerName ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/^\[?k1z\]?(?:[\s._-]+)+/, "")
    .replace(/[\s._-]+/g, " ");
  return normalized === ODIN_CANONICAL_NAME
    ? ODIN_CANONICAL_NAME
    : playerName ?? null;
}

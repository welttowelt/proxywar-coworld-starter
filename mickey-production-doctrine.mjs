export const MICKEY_SCREEN_DOCTRINE_IDS = Object.freeze([
  "grow-opening",
  "grow-low-share",
  "convert-weakest",
  "convert-largest",
]);

// Promotion seam: change only this literal after a hash-bound screen winner
// clears the remaining hosted and regression gates. Null enables no arm.
export const MICKEY_SCREEN_WINNER = null;

const WINNER_PREFERENCE = Object.freeze({
  "grow-opening":
    "SCREEN PREFERENCE: while calm, prefer grow during the first twenty active decisions; then reassess from the current board.",
  "grow-low-share":
    "SCREEN PREFERENCE: while calm and below twelve percent land, prefer grow; then reassess from the current board.",
  "convert-weakest":
    "SCREEN PREFERENCE: after securing twelve percent land, prefer convert against the exact visible, attackable, non-protected rival with the highest relative troop advantage at or above 1.3.",
  "convert-largest":
    "SCREEN PREFERENCE: after securing twelve percent land, prefer convert against the largest exact visible, attackable, non-protected rival that has a relative troop advantage at or above 1.3.",
});

if (MICKEY_SCREEN_WINNER !== null &&
    !MICKEY_SCREEN_DOCTRINE_IDS.includes(MICKEY_SCREEN_WINNER)) {
  throw new Error(`unknown Mickey screen doctrine: ${MICKEY_SCREEN_WINNER}`);
}

const selectedPreference = MICKEY_SCREEN_WINNER === null
  ? "SCREEN PREFERENCE: unselected. Infer grow or convert from the current board; do not assume any screened arm won."
  : WINNER_PREFERENCE[MICKEY_SCREEN_WINNER];

export const MICKEY_PRODUCTION_DOCTRINE = Object.freeze([
  "You command an autonomous nation in ProxyWar. Win by owning the most land.",
  "INTENT: choose one outcome for the next few decisions: grow or convert.",
  "CONSTRAINTS: never harm protected K1Z partners; preserve survival under active attack; use only offered action kinds.",
  "SUCCESS: increase our chance of finishing with the most territory; name a rival only when it advances the intent.",
  selectedPreference,
  "FREEDOM: do not prescribe action IDs, action kinds, percentages, or turn timing. The deterministic selector chooses the exact legal move.",
]).join(" ");

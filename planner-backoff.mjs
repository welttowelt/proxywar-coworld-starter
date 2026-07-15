export function classifyPlannerError(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  if (/\b429\b|too many tokens|daily token|quota|rate.?limit|throttl/.test(message)) {
    return "qta";
  }
  if (/time.?out|timed out|abort/.test(message) || error?.name === "AbortError") {
    return "tmo";
  }
  return "err";
}

export function plannerCooldownMs(
  errorClass,
  consecutiveFailures,
  { baseMs = 30000, quotaMs = 900000, maxMs = 300000 } = {},
) {
  if (errorClass === "qta") return Math.max(baseMs, quotaMs);
  const exponent = Math.max(0, Math.min(6, Number(consecutiveFailures || 1) - 1));
  return Math.min(Math.max(1000, baseMs) * (2 ** exponent), Math.max(baseMs, maxMs));
}

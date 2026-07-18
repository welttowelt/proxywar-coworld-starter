# Jūryoku-koku — Gravity Nation Design

**Date:** 2026-07-18  
**Player:** `juryoku-koku` (重力国, Gravity Nation)  
**Policy:** `santai-juryoku` (三体重力, Three-Body Gravity)

## Mission

Add a second independent Coworld player from this Mac and make it the third body in a durable coalition with `odin free` and `katanasan`. Gravity Nation is the coalition's defensive mass and nuclear second-strike arm. Odin remains the intended winner; Gravity survives, protects both allies, and removes every outsider that threatens the three-body balance.

The science-fiction inspiration is a three-body balance-of-power and dark-forest deterrence problem. The implementation remains an ordinary legal Proxywar policy: it selects only offered legal actions and uses no hidden platform access.

## Identity and role

- Player identity: `juryoku-koku`.
- Policy label: `santai-juryoku`.
- Japanese doctrine name: `Ankoku Shin'en` (暗黒深淵, Dark Abyss).
- Coalition role: shield, alliance relay, nuclear deterrent, and strongest-outsider suppressor.
- Succession rule: help `odin free` win; protect `katanasan` as the older allied spear; do not steal a lead from either ally when support or outsider pressure is legal.

## Deterministic coalition contract

The local action scorer, not the LLM, owns these invariants:

1. Normalize player names with Unicode NFKC, trim whitespace, collapse internal whitespace, and compare case-insensitively.
2. Resolve both ally names and observed player IDs on every decision. Names are `odin free` and `katanasan`; IDs learned from `visiblePlayers` are equally authoritative.
3. While an ally is not allied, immediately prefer a legal `alliance_request` to that ally over expansion or ordinary combat. Retry whenever the platform offers the action again until `isAllied=true` is observed.
4. When an ally is allied, preserve or extend the alliance. Never select an alliance break or rejection involving that ally.
5. Never attack, boat-attack, warship-target, embargo, publicly target, betray, or nuke either ally. Target matching uses structured metadata and IDs first, with action text only as a fallback.
6. Support Odin first and katanasan second when the action keeps Gravity viable as a deterrent. Donations are rate-limited so the agent does not loop on aid.
7. Allies are excluded from every rival-selection and nuclear-target routine even if the planner names them.

If the observation cannot identify a target for a harmful action, the action is allowed only when it is clearly neutral expansion. Ambiguous targeted nuclear or diplomatic hostility is rejected.

## Combat and deterrence doctrine

Gravity Nation builds one Missile Silo early, preserves a nuclear reserve, and fires every safe legal nuclear action against an identified outsider. Among equally useful nuclear options it prefers MIRV, then Hydrogen Bomb, then Atom Bomb. It pressures the strongest reachable outsider, with two exceptions:

- an outsider actively attacking an ally gets retaliation priority;
- a clean bordered execution may be completed before returning to a remote runaway leader.

The nation expands to a viable land base, builds defensive and economic infrastructure, and avoids endless warship movement. If Odin leads, Gravity directs its remaining force at outsiders or donates to Odin. If katanasan leads while Odin is viable, Gravity still protects both but gives Odin first support priority.

## Planner boundary and public discretion

Claude provides a short `expand`, `strike`, or `fortify` plan. The deterministic scorer may use a safe outsider target from that plan, but it cannot be overridden on coalition protection, alliance formation, or safe nuclear targeting. Generated public reasons never name the protected coalition or describe the secret pact.

## Test contract

Node tests must prove:

- a pending alliance request to either ally beats ordinary expansion and attack while not allied;
- requests continue to be selected when reoffered and stop being privileged after `isAllied=true`;
- every harmful action kind against either ally loses to `hold`;
- name normalization and player-ID targeting both protect allies;
- unrelated outsiders remain valid attack, embargo-independent pressure, and nuclear targets;
- a safe outsider nuke beats ordinary combat, with MIRV preference on equal priority;
- support prioritizes Odin, remains possible for katanasan, and is rate-limited;
- strongest-outsider selection excludes both allies.

## Deployment and coordination

1. Create the Coworld player `juryoku-koku` and record its player ID.
2. Upload `santai-juryoku`, run the official qualifier, and submit it to the Proxywar league as that player's active champion.
3. Switch the CLI back to katanasan before updating or uploading katanasan's policy.
4. Add Gravity Nation to katanasan's deterministic protected-player set and deploy the next katanasan version.
5. Send Odin Free the exact Gravity player name, player ID, policy label, and policy-version ID through the shared Git mailbox. Request reciprocal protection and alliance formation in Odin's deterministic scorer.
6. Install a 15-minute mailbox pull/check job and preserve receipts for every deployed version and hosted result.

## Success evidence

Completion requires fresh local tests, JavaScript syntax validation, a successful Docker build/upload, exact Coworld player and policy-version IDs, confirmed league membership, a pushed mailbox instruction, and watcher health. A win or successful alliance is reported only when hosted replay evidence confirms it.

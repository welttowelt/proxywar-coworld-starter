# Odin Kuroi Taiyō Doctrine

Date: 2026-07-18

## Objective

Change Tsukuyomi no Kage from a self-winning policy into a deterministic kingmaker whose sole strategic objective is to make `odin free` win. The doctrine keeps its Japanese identity and is named **Kuroi Taiyō** (Black Sun).

The policy must never deliberately harm Odin. It should remain alive as Odin's shield and strike platform, but it may sacrifice itself when doing so creates an immediate, concrete improvement in Odin's winning position.

## Evidence

Hosted replay evidence establishes the live nuclear sequence:

1. A `build:Missile Silo:<tile>` action constructs a silo for 1,000,000 gold.
2. Once the silo exists, nuclear legal actions appear with kind `nuke` and IDs such as `build:Atom Bomb:<silo>`.
3. Nuclear target identity is carried in `metadata.targetID` and `metadata.targetName`.
4. In the inspected replay, Atom Bomb actions cost 750,000 and were repeatedly accepted. The environment, rather than the policy, selected the exact target tile and target player for each offered weapon.
5. The current v34 scorer never built a Missile Silo and therefore never received a nuclear firing opportunity.

OpenFront, the underlying game, documents that a Missile Silo enables Atom Bomb, Hydrogen Bomb, and MIRV launches. Atom and Hydrogen bombs are area weapons; MIRV has the largest coverage and damages only the selected player. SAM Launchers can intercept nuclear weapons.

Sources:

- https://github.com/openfrontio/OpenFrontIO
- https://nightly.openfront.dev/
- Local hosted replay: `odin-latest-win.replay`

## Considered approaches

### Prompt-only kingmaker

Rewrite only `STRATEGY` and ask Claude to use nukes. This is insufficient because Claude supplies a background plan while the local scorer selects the legal action. The current scorer can ignore both silo construction and nuclear actions.

### Immediate sacrificial kingmaker

Spend all resources immediately and disregard survival. This can create early pressure, but it removes the army that could protect Odin, donate resources, and launch repeated nuclear strikes.

### Deterministic Kuroi Taiyō kingmaker

Keep Claude's plan as advisory context, but encode Odin protection, silo construction, nuclear firing, donations, and rival targeting as deterministic scoring invariants. This is the selected approach.

## Decision hierarchy

Every legal-action decision follows this priority order:

1. Spawn when required.
2. Reject any harmful action whose target is Odin by exact normalized name or player ID.
3. Fire a legal nuclear weapon whenever its metadata targets a living non-Odin rival.
4. Build the first Missile Silo as soon as a legal silo action exists.
5. Maintain or extend an alliance with Odin and donate gold or troops when legal, while preserving enough gold for the next available nuclear strike.
6. Attack the strongest non-Odin rival, prioritizing the current leader and any rival positioned to overtake Odin.
7. Expand and build only enough economy, ports, reach, and defense to keep the strike platform operational.
8. When Odin leads, stop competing for victory: pressure every other survivor, donate to Odin, and accept self-sacrifice if it removes a direct threat or transfers decisive strength to Odin.

If a nuclear action is offered only against Odin, the action is forbidden. The policy must choose another legal action and wait for a safe nuclear target. “Must use nukes” means every available non-Odin nuclear opportunity, never friendly fire.

## Nuclear doctrine

The scorer will recognize nuclear actions by action kind and by Atom Bomb, Hydrogen Bomb, or MIRV identifiers.

- Any nuclear action targeting Odin scores negative infinity.
- Any nuclear action targeting a non-Odin player outranks every ordinary action.
- Among simultaneously safe nuclear actions, prefer the action with the greatest `nuclearTargetPriority`, then the weapon with the greatest focused destructive value: MIRV, Hydrogen Bomb, Atom Bomb.
- Prefer targets with valuable structures and low SAM coverage when the environment exposes those fields.
- Construct one Missile Silo immediately when legal. Additional silos are lower priority unless replay evidence shows one silo cannot sustain the decision cadence.
- Keep the existing anti-loop logic, but do not penalize repeated accepted nuclear launches against non-Odin rivals.

## Odin protection and support

The protection barrier applies to `attack`, `boat`, `warship`, `move_warship`, `nuke`, `embargo`, `target_player`, `alliance_reject`, and `break_alliance`. It checks both target name and target ID because action labels are not always reliable.

Alliance requests and extensions, gold donations, and troop donations to Odin are allowed. Donation logic keeps a nuclear reserve when possible. Public rationale must not expose the private relationship.

## Strategy text

`STRATEGY` will describe the Kuroi Taiyō orders in Japanese-inspired language:

- Odin is the protected shōgun.
- Tsukuyomi no Kage is the shinobi shield and nuclear spear.
- All non-Odin players are rival daimyō.
- The first strategic economic milestone is the kakushi misairu-jō, the hidden missile castle.
- Nuclear strikes are the Kuroi Taiyō and are mandatory against legal non-Odin targets.

The strategy text supplements the deterministic rules; it cannot weaken them.

## Verification

Before upload:

- `node --check llm-player.mjs`
- deterministic self-tests for Odin-target rejection by name and ID
- deterministic self-test proving a safe nuke outranks attack, build, hold, and social actions
- deterministic self-test proving an Odin-targeted nuke is rejected
- deterministic self-test proving a first Missile Silo outranks ordinary actions when no safe nuke exists
- Docker build for `linux/amd64`

After upload:

- inspect qualifier and competition `decisions.jsonl`
- require accepted decisions with no fallback or planner degradation attributable to the change
- require zero chosen harmful actions against Odin
- confirm an accepted Missile Silo build when the action becomes legal
- confirm every observed non-Odin nuclear opportunity is selected and accepted
- measure Odin's win rate and compare it with the pre-change batch, split by Asia, Pangaea, and World

The new policy is promoted only after the build and hosted qualification gates pass. Competition replays drive the next RCI iteration.

## Non-goals

- No attack or nuke against Odin, even if the environment ranks Odin as the best target.
- No attempt to make Tsukuyomi win at Odin's expense.
- No unrelated refactor of the websocket, Bedrock, authentication, or upload plumbing.

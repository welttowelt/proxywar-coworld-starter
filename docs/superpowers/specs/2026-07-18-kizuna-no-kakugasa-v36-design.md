# 絆の核傘 — Kizuna no Kakugasa v36

## Objective

Make `odin free` the winner while keeping `katanasan` useful for longer. Katanasan must never attack, embargo, betray, reject, or launch any nuclear weapon at Odin. Every legal nuclear strike against another player remains the highest-priority action unless the policy is deliberately banking for a Hydrogen Bomb.

The first v35 competition replay proved three missing capabilities:

1. An accepted outbound alliance action did not create an alliance because Odin never sent the reciprocal request. `hasAlliance` stayed false for all 169 katanasan decisions, so direct donations never became legal.
2. Katanasan built only one Missile Silo, never built a redundant silo, and never upgraded or defended the nuclear platform. The silo was lost before elimination and nuclear support stopped.
3. Katanasan immediately spent every affordable Atom Bomb and therefore never accumulated the 5,000,000 gold required for a Hydrogen Bomb.

## Considered designs

### A. 拒否刻 — Kyohi-doki, the veto-turn scheduler (selected)

Safe nuclear strikes against non-Odin targets remain first. When a nuclear option targets only Odin, the policy vetoes it and spends that turn on alliance, aid, nuclear infrastructure, defense, or banking. This preserves offensive pressure while turning previously idle safety vetoes into direct support for Odin.

### B. 貢ぎ槍 — Mitsugi-yari, aid before offense

Donation actions would sometimes outrank safe nuclear strikes. This could accelerate Odin but would reduce pressure on rivals and make the result depend on an alliance that katanasan cannot establish alone.

### C. 原爆雨 — Genbaku-ame, Atom-only barrage

Keep the v35 barrage and add only alliance retries. This is simple, but it leaves the single-silo failure mode and never exercises advanced weapons.

Design A is selected because it implements all three replay learnings without weakening the non-Odin strike mandate.

## Decision hierarchy

The deterministic scorer will use this priority order:

1. Reject every harmful action whose target is Odin, including nuclear weapons.
2. Fire a safe MIRV, Hydrogen Bomb, or Atom Bomb at a non-Odin player, except during an active Hydrogen banking window.
3. Request or extend alliance with Odin on a cooldown until observed state confirms the alliance.
4. Donate gold or troops to Odin when the action is legal and katanasan can preserve the nuclear platform.
5. Build and preserve the 隠しミサイル城 (`kakushi misairu-jo`) network: first silo, second silo, silo upgrades, SAM Launcher, then Defense Post.
6. Continue ordinary attacks and expansion against every non-Odin rival.

Safe non-Odin nuclear actions score above alliance and infrastructure actions. Alliance and infrastructure actions score above ordinary combat. This makes Odin-veto turns productive without discarding a safe strike.

## Learning 1: 絆返し — Kizuna-gaeshi alliance handshake

Katanasan will no longer treat one outbound request as permanent completion. While Odin is present and `isAllied` is not true, the scorer may send another alliance request after three policy decisions. That cadence allows a pending request to expire or cool down while avoiding request spam.

An alliance extension to Odin receives the same protected priority. Once the observation reports a real alliance, requests stop and donation actions may activate.

The reciprocal half cannot be forced by katanasan. A mailbox packet is therefore sent to Odin's Kimi policy owner requiring Odin to answer a pending request from katanasan with the reverse alliance request and never break it.

## Learning 2: 二重城 — Niju-jo resilient nuclear platform

Silo state must come from the current observation when unit counts are available, rather than only from historical orders. History remains a fallback for older observation shapes. This allows katanasan to rebuild a destroyed silo.

The infrastructure order is:

1. Build the first Missile Silo at the first safe legal opportunity.
2. Build a second Missile Silo on an Odin-veto or Hydrogen-bank turn for redundancy.
3. Upgrade a Missile Silo to increase concurrent launch capacity.
4. Add a SAM Launcher against nuclear threats.
5. Add a Defense Post against the conventional dogpile seen in v35.

No infrastructure action may outrank an immediately safe non-Odin nuclear strike. Under severe incoming pressure, defensive infrastructure outranks ordinary expansion.

Aid uses a cadence per donation type. Gold is donated only above the protected reserve. Troops are donated only when there is no severe incoming threat and katanasan's troop ratio is at least 0.75, preventing support from destroying the nuclear platform prematurely.

## Learning 3: 水爆貯め — Suibaku-tame controlled Hydrogen banking

After six accepted Atom Bomb launches, katanasan enters one Hydrogen banking window when all of these conditions hold:

- no severe incoming attack threatens immediate survival;
- no Hydrogen Bomb or MIRV has been launched in the current salvo cycle;
- current gold is below 5,000,000;
- a safe Atom Bomb is available only against non-Odin targets.

During the window, Atom Bomb actions are suppressed and the turn is spent on the alliance or resilient-platform hierarchy while gold accumulates. When a safe Hydrogen Bomb becomes legal, it outranks all Atom Bombs and ends the bank. A MIRV, if naturally affordable and legal, always outranks lower weapons and also ends the bank.

The policy will not deliberately bank 25,000,000 gold for a MIRV in v36 because the replay does not yet show that such a long delay is survivable. MIRV banking can be considered after Hydrogen banking produces evidence.

If every advanced nuclear target is Odin, those actions remain forbidden. A safe Atom Bomb at a rival is allowed rather than waiting on an unsafe advanced weapon.

## Safety invariants

- Odin is matched by normalized name and player ID before scoring.
- Every hostile action against Odin scores negative infinity.
- Every alliance reject or break action involving Odin scores negative infinity.
- Hydrogen banking never relaxes the Odin target veto.
- The LLM cannot override deterministic safety or scoring.
- A decision is recorded only after the runner accepts it; rejected actions do not advance salvo, aid, or alliance cooldown state.

## Verification

The implementation must begin with failing, live-shaped tests for:

1. retrying an alliance request after two intervening decisions;
2. choosing a second Missile Silo over ordinary combat on an Odin-veto turn;
3. choosing a Missile Silo upgrade over neutral expansion on an Odin-veto turn;
4. banking after six accepted Atom Bombs when below Hydrogen cost;
5. donating to Odin when allied and safe, but preserving troops under severe incoming pressure;
6. preserving all v35 invariants: never harm Odin, prefer stronger nuclear weapons at equal target priority, and select every safe non-Odin strike outside a bank window.

After unit tests pass, run syntax checks and a local replay-shaped decision trace. Deployment requires a new Japanese policy label and a fresh policy version ID; v35 remains the rollback version until hosted evidence confirms v36 behavior.

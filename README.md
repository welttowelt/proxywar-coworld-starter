# ProxyWar — agent starter

Build an AI agent that plays **ProxyWar**, a live AI-vs-AI strategy game — claim
territory, form alliances, betray them, nuke rivals — and run it against other agents
on [Softmax's Observatory](https://softmax.com/observatory).

**The default agent is LLM-powered (Claude, via Bedrock) and needs no API key.** Claude
writes your nation's PLAN (expand / attack whom / build what) and refreshes it in the
background every few decisions; each turn is answered instantly from the current plan. It
ships ready to run; you edit one strategy brief to make it yours. (A simple no-LLM rule
agent is included too — see below.)

> Why plan in the background instead of asking the model every turn? Hosted decisions
> have a **15-second response cap**, and an episode can run all 300 decision steps. An
> inline model call can time out and disconnect; this agent keeps legal moves immediate.

You can't make an illegal move — the game only ever offers valid options and validates
your pick — so your agent can never break the game, only play it well or badly.

## What you need

- **Docker** installed ([get it](https://docs.docker.com/get-docker/)) — if it isn't
  running, the script offers to start it for you (macOS).
- That's it. `launch.sh` checks everything else itself: it offers to install
  [uv](https://docs.astral.sh/uv/) if it's missing, and runs the Softmax sign-in
  (free account, in your browser) on first use.

macOS and Linux (on Windows, use WSL).

## Run it

```bash
git clone https://github.com/welttowelt/proxywar-coworld-starter.git
cd proxywar-coworld-starter
bash launch.sh my-agent
```

First run: checks your setup → signs you in (browser, once) → builds → uploads
(**Bedrock auto-enabled — no API key needed**) → prints your **policy id**. Send that id
to whoever invited you — they seat your agent against theirs and send back the replay.

Preflight only: `bash launch.sh --doctor`. Driving it from a coding agent or CI:
`bash launch.sh my-agent --yes` auto-approves the safe setup steps.

## Make it your own

The policy is split into two layers:
- **`llm-player.mjs` / `STRATEGY`** - standing orders for the background planner.
- **`strategy-engine.mjs`** - target scoring, attack escalation, build cadence, boat
  limits, and the final legal move selection.

That's your agent. Re-run `bash launch.sh my-agent` to push a new version.
(`PLAN_EVERY` sets how often the plan refreshes; default every 3 decisions.)

Run `npm test` before uploading. The suite covers the pure strategy engine and the
actual WebSocket player process.

This fork pins the Coworld and Softmax CLIs, installs Node dependencies from a lockfile
without lifecycle scripts, and keeps `hold` behind every productive legal action.

## Join the Proxy War league

After uploading, submit the named policy to the recurring league:

```bash
uvx --from 'coworld==0.1.28' coworld submit my-agent:v1 \
  --league league_cb60d526-ecfd-4836-ab3a-81fc6cf7dc42 \
  --auto-champion always
```

The league first runs a short self-play connection check, then promotes a working policy
into competition automatically.

## Replay data and statistics

This fork can collect the latest 20 completed Competition rounds, normalize public
replay telemetry, and run the current-meta queries with DuckDB:

```bash
npm run data:refresh
```

The versioned outputs live in [`data/`](data/README.md). They include compressed
Parquet tables at round, episode, participant, and decision grain; official round
standings; a leaderboard snapshot; FFA-only competitor statistics; provenance hashes;
and automated quality checks. The 600+ MB replay cache stays local and is ignored by
Git.

Use the FFA tables for current policy decisions. Rounds 163-180 in the initial snapshot
are head-to-head, while rounds 181 onward use four-player FFA.

## Results dashboard

The static dashboard in [`site/`](site/) turns the committed round data into a compact
results, standings, and FFA-meta view. Refreshing the data also regenerates the JSON used
by the frontend:

**Public dashboard:** [GitHub Pages](https://welttowelt.github.io/proxywar-coworld-starter/)

**Netlify entrypoint:** [welttowelt-proxywar.netlify.app](https://welttowelt-proxywar.netlify.app)

```bash
npm run data:refresh
npm run dashboard:serve
```

`npm run dashboard:update` is the guarded publish loop. It only runs from a clean
worktree, refreshes the snapshot, commits changed datasets, and pushes `main`. GitHub
Pages publishes the changed `site/` files, and the Netlify entrypoint redirects there
without consuming deploy credits. The local LaunchAgent runs this loop every five
minutes while the machine is awake and skips any cycle that finds active worktree
edits. Open dashboard tabs poll for fresh data every minute and refresh when they regain
focus. Set `PROXYWAR_DEPLOY_NETLIFY=1` only for an intentional direct Netlify deploy.

Out of the box it already: reads your territory share, troops, gold, and each rival's
relative strength / who borders you / who's allied; uses the model's focus and named
target as bounded hints; applies replay-derived target continuity and action cadence;
**avoids repeating the same move** when it stops helping; parses the model's reply
robustly; and **keeps playing on the last good plan (loudly flagged)** if Bedrock ever
hiccups.

## Prefer a non-LLM agent?

`starter-player.mjs` is a ~80-line rule agent (no model, no Bedrock). To use it instead,
edit `launch.sh` to `--run node --run /app/starter-player.mjs` and drop `--use-bedrock`.

## More

- **Full walkthrough + troubleshooting:** [`ONBOARDING.md`](ONBOARDING.md)
- **Your matches, replays, per-decision logs:** [softmax.com/observatory](https://softmax.com/observatory)

The contract each turn: you receive the game state plus a list of legal moves, and return
exactly one of them (its `id`). Any language that speaks websockets works; this starter
uses Node.

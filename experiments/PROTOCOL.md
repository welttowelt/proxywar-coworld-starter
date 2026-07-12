# experiment protocol

This protocol is the RCI correction after v27-v29 produced one hosted win in
twelve episodes. It blocks attractive but weakly evidenced policy changes from
reaching promotion gates.

## critique

- Four seeded mock runs repeated one strategic trace and were overstated as four
  trials.
- Frontier candidates lacked a current v14 baseline on the same roster and seat.
- v29 was hosted before its expected mechanism reach was measured.
- The audit tool could not count v29's mechanism even after the episodes ran.
- Source plausibility was allowed to stand in for expected effect size.

## corrected gate

1. Isolate exactly one candidate delta.
2. Prove at least one reachable historical decision before upload.
3. Report local runs and independent strategic traces separately.
4. Register a replay-visible mechanism marker and its parser before the hosted
   request starts.
5. Run a matched v14 baseline with identical roster, variant, seat, and episode
   count. Without it, the request is diagnostic-only.
6. Require `4/4`, zero holds, zero rejections, zero fallbacks, and at least one
   productive mechanism execution.
7. Require a separate `20/20` map-and-seat regression before league promotion.
8. Keep v14 as the sole active league policy until every condition passes.

Validate a preflight with:

```bash
npm run experiment:preflight -- experiments/preflight-v30.json
```

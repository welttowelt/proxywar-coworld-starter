# GR1 fresh full-suite receipt

- Date: 2026-07-19
- Branch: `rci/gr1`
- Exact source commit under test: `73ce9aeb2ad6b15c59249ff506e09eb2ff4e1a1a`
- Exact parent: `f1347251834a6283182b631e1336595eb2e08342`
- Command: `npm test`
- Result: `148/148` tests passed, `0` failed, `0` cancelled, `0` skipped
- Duration reported by Node: `2575.385ms`
- Deployed-player integration:
  - `deployed player wiring expands first and converts a weak rival next`: passed in `956.101917ms`
  - `deployed player reconnects after an unexpected match socket close`: passed in `807.692167ms`
- GR1 selector tests: all six passed.
- Source files were not changed after the exact image was built and byte-checked.

This clean rerun resolves the transient reconnect-test timeout reported in
`HRAFN_TO_CODEX_ODIN_GR1_SOURCE_READY_VERDICT_20260719.md`. It is a source
receipt only. No qualifier, mirror, hosted request, upload, submission,
membership, or champion action is implied.

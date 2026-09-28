# BNL delivery evidence screenshots — 28 September 2026

These are screenshots of real browser/terminal output, not design mockups. Capture timezone: Africa/Accra (UTC). The files are used by the [GroundControl case study](../../articles/bnl-playground-from-the-browser.md), the BNL evidence archive and the portfolio articles.

| Image | What it establishes | Scope |
|---|---|---|
| [GC verification](gc-bnl-scorecard-20260928.jpg) | Saved scorecard counts and exact runtime source/binary identity were inspected through the live GC terminal. | Cropped to remove host identity and shell prompt. A script reads recorded outcomes; these are not native GC product metrics. |
| [Empty public playground](bnl-production-empty-20260928.jpg) | The deployed route loads its actual Rust/WASM runtime with zero business records. | Public portfolio release cb61c49. No sample customers or orders are preloaded. |
| [Public execution result](bnl-production-execution-20260928.jpg) | A supplied integer changes the result of an actual compiled declaration. | days > 30 returned true for 31 and false for 12; the image shows the second run. These are explicit test inputs. |

For original desktop/mobile acceptance screenshots, the failed browser attempt and all 31 final browser assertions, see the [immutable portfolio archive](https://github.com/teckedd-code2save/edward.entire/tree/cb61c49e5fe133ee465d13f4e965af4511443721/docs/evidence/bnl-playground-2026-09-28). Business values in those acceptance images are synthetic test inputs used by the harness, never production defaults.

The [manifest](manifest.json) records dimensions, SHA-256, artifact/source identity and captions. A screenshot demonstrates the visible state at capture time; it does not independently establish all test assertions, native-provider acceptance or production durability. Read the scorecards and protocol for those boundaries.

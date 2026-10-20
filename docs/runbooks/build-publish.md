# Build and publish verification

GroundControl's BuildKit path uses the same isolated Docker configuration for builder discovery, creation, registry login, publishing and pulling test images. It publishes selected Compose targets directly from BuildKit, then pulls and verifies each SHA-tagged artifact. A failed build/push stops the command before pull/verification. Requested tests execute once per distinct image, with both output streams recorded.

Build operations retain complete redacted phase stdout/stderr in `operation.get` → `evidence.logs`. Successful operations also include logs in `result.logs`. The short error message uses the final output lines; it is not the stored log. JSON evidence must never be truncated as a serialized string. Host command capture drains both streams without child_process.exec's default buffer limit. Logs may include source paths and compiler diagnostics; access remains restricted by the existing administrator/session and operation-grant boundaries.

## Automated checks

`npm test` includes generated-shell execution with fake Docker (shared credentials, missing-builder bootstrap, selected targets, build/publish failures), full-stream capture beyond 1 MiB per stream, route restoration and all-image test coverage, and worker persistence beyond the former 20 KB JSON cutoff.

## Real registry proof

Use a disposable managed deployment linked to this repository at an exact commit. Point its source path at a dedicated checkout and its Compose path at `tests/fixtures/build-publish/compose.yml`. Request only `api` and `web`, BuildKit, with `runTests: true` and `testCommand: "test $(cat /proof) = groundcontrol-build-proof"`. The deliberately broken `unselected` service must never build. Confirm both registry digests and test results.

Point a separate disposable deployment at `tests/fixtures/build-publish/failure.yml`. Its build must fail with `GC_PROOF_FINAL_BUILD_FAILURE` after more than 20 KB of output. Verify the first output, full length and final failure are retained in operation evidence, including after a process restart. Never promote the proof images or use a production application's tag for this test. Retain the proof operation IDs as evidence, then remove the disposable projects/checkouts.

# Pilot readiness patches — 15 September 2026

These changes correct source-level execution defects. They have not been deployed or verified against customer infrastructure.

## Patched behavior

- The terminal requires a current database administrator role for execution, completion, and AI assistance. Existing signed-in sessions whose role was revoked cannot continue using those routes.
- Opening a terminal pins its saved VPS ID. Execution, context, completion, and capability requests carry that ID; deleting the target fails the request instead of switching hosts. Reload to choose the current active VPS.
- The complete command reaches the remote shell, including the command after `cd`. A failed starting directory stops execution. Explicit shell invocations are preserved. The UI updates its directory from the shell result and displays HTTP/API failures.
- Concurrent job output appends are atomic in SQLite. A pending job can be claimed once; its ordered logger finishes persisting before a terminal status is stored.
- Job SSE events carry a job-specific output cursor. Reconnection uses Last-Event-ID; malformed/cross-job cursors fail, and a cursor beyond the available output produces a reset event.
- With no Daytona configuration, structural checks are explicitly unverified. They cannot claim a reproduced runtime failure or invent a validated proxy fix.

## Validation

`npm test`: 381 tests pass across 51 files. Added tests execute real shell commands, exercise terminal request boundaries, use a temporary SQLite database for concurrent writes and duplicate claims, and verify stream reconnect behavior. `npx tsc --noEmit --pretty false` and ESLint on changed source/tests pass. `npm run build` passes (with a Turbopack file-tracing warning in the unchanged component-QA source discovery path). A cloud rehearsal and a signed-in live terminal session are separate acceptance steps.

## Remaining pilot gates

1. Project/environment/target-scoped machine identities and approval records. Terminal administrator access is not a scoped agent API.
2. A durable worker with restart recovery, cancellation, and reconciliation before retrying uncertain external mutations. Current jobs still execute in the request worker.
3. Action-specific connector verification and useful investigation failure details.
4. A shared sandbox deadline, cancellation, cleanup obligations, and baseline/candidate execution at the same revision. Structural validation cannot satisfy this gate.
5. A GC-backed Convoy target with shared operation IDs, external health verification, recorded recovery, and two named agent clients.
6. Repeatable scoped Worker/R2 binding and round-trip verification when storage is in pilot scope.

Use one explicitly selected staging app to verify the release before any customer pilot. Record the deployed revision, target, actual result, and recovery evidence.

# Run Telemetry Writer

## Contract

Persist a telemetry package through an injected write target after validating the package cannot write outside its own repo-visible root.

| Requirement | Coverage |
| --- | --- |
| Writer preserves package file order and returns file count, content length, and paths. | `validates then writes package files in package order` |
| Writer validates every package path before the first write. | `rejects unsafe paths before writing any file` |
| Absolute paths, Windows drive paths, backslash paths, dot segments, out-of-root paths, non-`.runs` roots, exact duplicates, and case-insensitive duplicates are rejected. | `rejects unsafe paths before writing any file` |
| Writer writes and reports a validated snapshot, not mutable package references. | `writes a validated snapshot even if caller mutates package during write` |
| Writer appends `.complete.json` only after every package file writes successfully. | `validates then writes package files in package order`; `does not write a completion marker when a package file write fails` |

## Mechanism

`writeAutonomousRunTelemetryPackage(pkg, target)` accepts the pure telemetry package from `createAutonomousRunTelemetryPackage` and a caller-owned `writeTextFile(path, content)` sink. It writes package files first, then writes `.complete.json` as the final completion marker.

The module does not import filesystem APIs. A later CLI or worker can provide a Node `fs/promises` adapter, while tests use an in-memory sink. Consumers must treat a telemetry directory without `.complete.json` as incomplete.

## Adversarial Probe

The unsafe-path probe feeds packages with traversal roots, absolute roots, Windows drive roots, backslash roots, non-`.runs` roots, sibling-root files, dot-segment files, exact duplicates, and case-insensitive duplicates. The writer must reject each package before any write callback runs.

The mutable-package probe mutates the original package and original file objects during the first write callback. The writer must continue writing and reporting only the already validated snapshot.

The partial-write probe fails on the second package file and asserts no `.complete.json` marker is written.

## Self Review

Grade: A after review-driven iteration. This slice adds a narrow persistence boundary without touching Chrome/runtime files or `entrypoints/background.ts`.

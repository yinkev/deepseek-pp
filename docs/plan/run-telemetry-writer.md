# Run Telemetry Writer

## Contract

Persist a telemetry package through an injected write target after validating the package cannot write outside its own repo-visible root.

| Requirement | Coverage |
| --- | --- |
| Writer preserves package file order and returns file count, content length, and paths. | `validates then writes package files in package order` |
| Writer validates every package path before the first write. | `rejects unsafe paths before writing any file` |
| Absolute paths, Windows drive paths, backslash paths, dot segments, out-of-root paths, and duplicate paths are rejected. | `rejects unsafe paths before writing any file` |

## Mechanism

`writeAutonomousRunTelemetryPackage(pkg, target)` accepts the pure telemetry package from `createAutonomousRunTelemetryPackage` and a caller-owned `writeTextFile(path, content)` sink.

The module does not import filesystem APIs. A later CLI or worker can provide a Node `fs/promises` adapter, while tests use an in-memory sink.

## Adversarial Probe

The unsafe-path probe feeds packages with traversal roots, absolute roots, Windows drive roots, backslash roots, sibling-root files, dot-segment files, and duplicate files. The writer must reject each package before any write callback runs.

## Self Review

Grade: A. This slice adds a narrow persistence boundary without touching Chrome/runtime files or `entrypoints/background.ts`.

# Pet Telemetry Handoff

## Contract

Project orchestrator telemetry write results into the pet snapshot and handoff capsule as safe metadata only.

| Requirement | Coverage |
| --- | --- |
| New pet snapshots default to `telemetry.status = none` with no completion, counts, or error. | `createPetControlSnapshotFromRunCockpit and createBase default to no telemetry observed` |
| Null or undefined telemetry results are a no-op and preserve snapshot identity. | `mergeOrchestratorTelemetryResultIntoSnapshot returns original snapshot object unchanged if result null or undefined` |
| Written telemetry is marked complete only when both status is `written` and the writer completion marker is present. | `mergeOrchestratorTelemetryResultIntoSnapshot projects completion marker and safe counts only`; `mergeOrchestratorTelemetryResultIntoSnapshot requires completion marker and normalizes counts`; `mergeOrchestratorTelemetryResultIntoSnapshot never trusts a completion marker on non-written telemetry` |
| Counts are finite, non-negative integers before reaching the pet. | `mergeOrchestratorTelemetryResultIntoSnapshot requires completion marker and normalizes counts` |
| Failed and skipped telemetry expose only safe status and whitelisted error codes. | `mergeOrchestratorTelemetryResultIntoSnapshot projects failed and skipped telemetry as safe metadata only` |
| Unknown telemetry error codes are collapsed to `unknown_telemetry_error`. | `privacy false-positive probe: raw telemetry paths, roots, run ids, and unknown errors stay out of pet and handoff projection` |
| Handoff capsule fields agree with the merged pet snapshot. | `createPetHandoffCapsule projects telemetry fields that agree with the merged snapshot` |
| Telemetry metadata does not change handoff `nextAction` priority. | `telemetry metadata does not alter nextAction priority` |
| Raw telemetry run IDs, roots, paths, private query strings, and raw errors never reach pet or handoff JSON. | `privacy false-positive probe: raw telemetry paths, roots, run ids, and unknown errors stay out of pet and handoff projection` |

## Mechanism

`mergeOrchestratorTelemetryResultIntoSnapshot(snapshot, result)` is a pure reducer. It accepts the safe result object returned by the orchestrator telemetry handoff, drops all raw location and ID fields, and stores only:

- status;
- completion-marker presence;
- file count;
- content length;
- whitelisted error code.

`createPetHandoffCapsule` mirrors those compact fields so an operator surface can show whether repo-visible telemetry finished without learning where the package was written or which durable run ID produced it.

## Privacy

The pet is not a telemetry browser. It does not carry:

- orchestrator `runId`;
- telemetry `rootDir`;
- telemetry file paths;
- writer-private path fragments;
- unrecognized writer error strings.

The projection is safe enough for UI handoff and worker coordination. Raw package inspection remains a repo-side/debug action, not a pet snapshot concern.

## Adversarial Probe

The false-positive probe builds a source telemetry result containing secret run IDs, secret roots, private path query strings, and an unknown error string. The source JSON must contain those secrets. The merged pet snapshot and handoff capsule JSON must omit them while still reporting `written`, `complete`, counts, and `unknown_telemetry_error`.

## Self Review

Grade: A.

This slice is pure pet projection. It does not write files, schedule work, mutate runs, or touch Chrome/runtime files. The completion signal is conservative because it requires the writer's final `.complete.json` marker and cannot be set by status alone.

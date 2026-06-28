# Milestones

| # | Milestone | Target Phase | Criteria | Status |
|:--|:--|:--|:--|:--|
| 1 | Browser Control Contracts Ready | After Phase 1 | Contracts, settings, platform capabilities, Chromium permissions, policy checks, and permission docs are aligned | Done locally |
| 2 | Background Runtime Ready | After Phase 2 | CDP connection, controlled tabs/groups, and AX snapshot manager are implemented and tested with mocked Chrome APIs | Done locally |
| 3 | Browser Action Tools Ready | After Phase 3 | Navigation, observation, and input action tools are exposed through one local provider and pass runtime tests | Done locally |
| 4 | Tool Loops Unified | After Phase 4 | Manual chat, sidepanel chat, inline agent, and automation share browser-control execution without large payload regressions | Done locally |
| 5 | User Control Surface Ready | After Phase 5 | Sidepanel exposes Browser Control enable/status/target/detach controls with i18n | Done locally |
| 6 | Release Readiness | After Phase 6 | Chrome smoke, docs, manifest policy, full validation, and diff review are complete | Automated validation and passive smoke preflight done; live Chrome smoke pending |

## Future Roadmap Notes

- **Discrete agent activity UI**: Tool use, searches, file reads, and other execution telemetry should render as compact, collapsible activity rows similar to Codex instead of appearing as verbose assistant text in the main response. The default chat surface should stay focused on the answer/result, with raw tool details available on demand for audit.
- **Engineered autonomy control plane**: DeepSeek++ should evolve as a browser-side adapter and cockpit for bounded agent jobs, not as ambient always-on intelligence. The core runtime law is: idle is quiet; no work runs without a job; every job has a budget, heartbeat, cancellation path, evidence log, and verification result; model outputs remain advisory until checked against local/runtime evidence.
- **Checkpoint-only durable traces**: Live streaming/tool-continuation state may update in memory for responsive UI, but `chrome.storage.local` writes should happen only at meaningful checkpoints such as job start, step complete, loop complete, error, or stop. Do not persist every streamed token/chunk or high-frequency trace update.

## GitHub Milestone Titles

- `Phase 1: Contracts, Capabilities, and Permissions`
- `Phase 2: Background Browser-Control Runtime`
- `Phase 3: Browser Action Tools`
- `Phase 4: Tool-Loop and Result Integration`
- `Phase 5: Sidepanel Browser Control UI`
- `Phase 6: Verification, Documentation, and Release Readiness`

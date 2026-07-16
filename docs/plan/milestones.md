# DeepSeek++ PC Runtime Hardening Wave 2 — Milestones

## Milestone 1 — External Boundary Correctness

Goal: malformed external input fails visibly before privileged consumption while all legal MCP, DeepSeek request and tool-stream contracts remain unchanged.

GitHub Milestone [#49](https://github.com/zhu1090093659/deepseek-pp/milestone/49). Tasks: W2.1/#395, W2.2/#396, W2.3/#397.

```yaml
adaptive:
  drift_score: 1
  strategy: "strict receiving boundaries with byte-compatible legal paths"
  thresholds:
    annotate: 1
    replan: 2
    rescope: 2
  total_tasks: 3
  completed_tasks: 3
```

## Milestone 2 — Capability, Performance and Closure

Goal: desktop capability/version truth is authoritative, the first Chat screen regains measured headroom, and live compatibility evidence closes through one PC-browser batch.

GitHub Milestone [#50](https://github.com/zhu1090093659/deepseek-pp/milestone/50). Tasks: W2.4/#398, W2.5/#399, W2.6/#400, W2.7/#401.

```yaml
adaptive:
  drift_score: 1
  strategy: "independent desktop truth lanes followed by one evidence closure"
  thresholds:
    annotate: 1
    replan: 2
    rescope: 3
  total_tasks: 4
  completed_tasks: 4
```

## Scope Guard

Deferred work—Content/Background monolith decomposition, `core/types.ts` migration, Skill importer unification and a broad browser-E2E platform—does not enter either milestone without an explicit rescope decision. Android/mobile support remains removed and is not a deferred deliverable.

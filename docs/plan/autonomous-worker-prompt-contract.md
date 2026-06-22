# Autonomous Worker Prompt Contract

## Contract

Freeze a reusable prompt contract for worker agents before wiring deeper autonomous governance behavior.

| Requirement | Coverage |
| --- | --- |
| Worker prompt includes the required `Evaluate, Review, Grade, Iterate` operating loop. | `builds a deterministic worker prompt with the required quality gate and XML report contract` |
| Worker prompt includes the exact quality gate block requested for every implementation prompt. | `builds a deterministic worker prompt with the required quality gate and XML report contract` asserts the exported constant equals an independent literal snapshot; `keeps the required marker list aligned with the quality gate text` |
| Worker prompt requires commit after implementation. | `builds a deterministic worker prompt with the required quality gate and XML report contract`; marker review includes `commit after implementation` |
| Worker prompt repeats the `entrypoints/background.ts` and Chrome/runtime freeze. | `builds a deterministic worker prompt with the required quality gate and XML report contract`; `deduplicates defaults and escapes XML-significant text` |
| Worker prompt requires XML reporting with contract coverage, adversarial probe, verification, self-review, grade, commit, blockers, and next step. | `builds a deterministic worker prompt with the required quality gate and XML report contract` asserts every required XML report field is present with opening and closing tags. |
| Prompt contract reviewer flags missing quality-gate markers. | `reviewAutonomousWorkerPromptContract flags missing contract markers` |
| Prompt builder redacts common credential, signed URL, cookie, bearer, API key, and inline-media shapes before emitting worker text. | `adversarial privacy probe: redacts sensitive prompt inputs without weakening required contract markers` |
| Prompt builder deduplicates repeated commands/files/defaults and escapes XML-significant text. | `deduplicates defaults and escapes XML-significant text` |
| False-positive success probe proves result object and durable stored state agree. | Not testable in this slice: prompt generation is pure and does not create result objects or mutate durable run state. The prompt requires workers to run this probe in implementation slices; the dedicated result-state consistency slice will make it executable. |

## Mechanism

`buildAutonomousWorkerPrompt(input)` returns a deterministic XML-shaped prompt for bounded worker slices. It accepts the slice title, objective, worktree, likely files, verification commands, reviewer gate, and stop condition. It always includes:

- the evaluate/review/grade/iterate loop;
- the quality gate block;
- commit-after-implementation instruction;
- forbidden `entrypoints/background.ts` default;
- no Chrome/runtime work unless explicitly resumed;
- one XML report contract.

`reviewAutonomousWorkerPromptContract(prompt)` checks for the required markers so future callers can reject weakened prompts before dispatching a worker.

## Privacy

The builder treats all prompt input as untrusted. It redacts common inline credentials, signed URL query parameters, cookies, bearer tokens, OpenAI/Google API-key shapes, assignment-style `token=` and `secret=`, and inline base64 media before XML escaping.

This does not make arbitrary prompt text safe for public publication. It is a guardrail for accidental worker-prompt leakage.

## Adversarial Probe

The privacy probe passes secret-bearing title, objective, worktree, branch, scope, likely file, verification command, and extra instruction values. The source values contain credentials and inline media. The resulting prompt must preserve all required contract markers while omitting the raw secrets.

## Self Review

Grade: A.

The slice is pure run-layer prompt construction and tests. It does not wire runtime prompts, modify prompt augmentation, touch Chrome/runtime files, or touch `entrypoints/background.ts`.

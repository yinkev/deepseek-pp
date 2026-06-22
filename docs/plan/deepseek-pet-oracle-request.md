I am building the next DeepSeek++ pet. I do not want a cute mascot spec. I want the strongest product/architecture call for turning the existing DeepSeek whale pet into a useful personal control panel, closer to how Codex pet works for me: visible runtime state, orchestration, review gates, long-running agent loops, and a direct path from "what is happening" to "what should I do next".

Please use the attached repo context. The current product is a WXT/React MV3 browser extension for chat.deepseek.com with DeepSeek Web interception, memory, Skills, MCP tools, browser control, sidepanel chat, automation, runtime doctor, personal convenience defaults, and an existing floating whale pet. The pet already reacts to thinking/streaming/tool/success/error states, supports speech bubbles, drag positioning, size, opacity, and motion. It is not yet a command center.

My wording may be incomplete or aimed at the wrong layer. Reconstruct the real ask before answering. I want expert-peer judgment under execution pressure, not a generic feature list.

Lead with the call: what should the DeepSeek pet become, and what should it explicitly not become?

Then give:

1. The finalized end-state vision for me as the local power user. Treat this as a control panel built around my actual workflow: persistent agent work, readiness, browser target, memory, Skills, MCP, automation, evidence, review/grade/iterate loops, and recovery.
2. The mechanism: repo-level architecture contract. Which existing surfaces should own this, which should not, and what minimal new modules/state/events are justified?
3. The implementation sequence: small reviewable slices, each with success criteria and verification commands. Keep it surgical. Do not invent a parallel runtime if existing runtime doctor, personal convenience, automation, inline agent, and browser-control surfaces should be reused.
4. The unconventional/novel features that could open my mind. I want ideas that change what I build, reject, test, measure, or believe. Separate plausible near-term features from speculative moonshots. Avoid gimmicks.
5. The second-order consequences: privacy, user trust, prompt-freeze risk, page DOM fragility, storage safety, extension review risk, and how pet-as-control-panel changes the product.
6. The strongest counterargument against doing this now, and what evidence would change your mind.
7. A concrete long-running agent prompt I can give to coding agents so they can loop over this vision continuously: plan, implement one slice, evaluate, review, grade, iterate, verify, hand off, then continue until the end-state is carried out. Include stop conditions and forbidden actions.

Important constraints:

- Keep this grounded in the attached code. If a claim is inference, label it as inference.
- Do not propose public README implementation details. User-facing docs should stay feature-focused.
- Do not change prompt-output contracts casually. Existing docs say prompt output is frozen byte-for-byte in key areas.
- Do not store secrets, auth headers, raw screenshot bytes, or durable Vision refs.
- Browser control and visual evidence must stay user-controlled and metadata-safe.
- The pet should not become an always-on autonomous actor that silently clicks, sends, deletes, publishes, or changes accounts.
- Prefer boring, testable architecture over clever UX.

Answer shape I want: decision memo plus implementation spec plus the reusable agent prompt. End only with open questions that materially change the answer; for each, state your default assumption and what evidence would change it.

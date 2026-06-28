# Private Internal License Checkpoint

This repo is intentionally documented as MIT at the current checkpoint.

Verified basis:

- The local fork is based on upstream `zhu1090093659/deepseek-pp` `v1.0.2`.
- Upstream `v1.0.2` advertised `MIT` in the README license section.
- Upstream switched its current repo metadata to `Apache-2.0` later, in commit `153ff84` (`docs: switch license to Apache 2.0`), released in `v1.0.5`.
- This checkpoint does not import upstream post-`v1.0.2` Apache-licensed source patches.

Internal rule:

- Current codebase and local changes stay MIT.
- Do not copy or merge upstream `v1.0.5+` Apache source, tests, docs, or assets into this MIT-only tree.
- Reimplementing the same product behavior from public release notes or observed behavior is acceptable; keep that implementation independent and covered by local tests.
- If Apache-licensed upstream source is copied later, add Apache notices and treat the affected distribution as mixed-license.

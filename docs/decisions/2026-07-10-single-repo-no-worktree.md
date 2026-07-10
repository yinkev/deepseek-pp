# Decision: single repo folder, no platform worktree

**Date:** 2026-07-10  
**Status:** Accepted

## Context

Bridge work temporarily lived in git worktree `deepseek-pp-platform` while `deepseek-pp` remained `main`. Chrome often loaded `deepseek-pp/dist/chrome-mv3`. Builds and rsyncs desynced. User repeatedly reloaded “the” extension while code ran elsewhere. Multi-account/auth debugging was poisoned by wrong dist.

User also rejected resurrecting deleted `deepseek-pp-ds2api-integration`.

## Decision

1. **Only** `/Users/kyin/Projects/deepseek-pp` for code.
2. Remove `deepseek-pp-platform` worktree after merging working tree into main.
3. Chrome Load unpacked **must** be `deepseek-pp/dist/chrome-mv3`.
4. Do not create convenience worktrees unless user explicitly asks and load path is updated in the same change.

## Consequences

- Simpler mental model for user and agents
- All docs/scripts assume one path
- Parallel branches still allowed via normal git branches, not dual folders Chrome can confuse

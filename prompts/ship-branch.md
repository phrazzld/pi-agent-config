---
description: Review entire branch, organize changes into semantic commits, then push
---
Task:
$@

Role:
- Release integrator for the current branch.

Objective:
- Turn the current working tree (tracked + untracked + staged + unstaged) into clean, semantically grouped commits and push the branch.

Workflow:
1. Inspect branch state (`git status --short --branch`, staged/unstaged/untracked).
2. Review all changed files and classify each change:
   - keep as-is
   - reorganize/split
   - drop/delete
   - ignore (if generated/noise)
3. Propose a commit plan before writing commits:
   - group by behavior/theme, not by file type
   - use conventional commit messages
4. Execute the plan:
   - stage per group
   - commit with detailed body (what + why + risk/verification)
   - repeat until clean
5. Push current branch to origin.
6. Report final results.

Deliverable:
- A completion report containing:
  1. Branch name + upstream
  2. Commit plan (groups + rationale)
  3. Executed commits (`<sha> <type(scope): subject>`)
  4. Push result
  5. Any intentionally uncommitted/ignored files (and why)

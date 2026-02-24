---
description: Squash-merge a PR only when truly ready, then run post-merge reflection
---
# SQUASH-MERGE

> Merge only when done-done, then reflect.

## Arguments

- PR number (required): `$1`
- Reflection focus (optional): `${@:2}`

## Preconditions (must all pass)

1. PR exists and is open.
2. PR is not draft.
3. Required checks are green.
4. Review feedback has been addressed (or explicitly dispositioned).
5. Local verification is green for changed scope.

## Workflow

1. Validate PR readiness:
   - `gh pr view $1 --json number,state,isDraft,mergeStateStatus,reviewDecision,title,url`
   - `gh pr checks $1`
2. If anything is not ready, stop and report blockers.
3. If ready, squash-merge:
   - `gh pr merge $1 --squash --delete-branch`
4. Sync local branch:
   - `git checkout master`
   - `git pull --ff-only`
5. Immediately run reflection:
   - `/reflect "post-merge PR #$1 ${@:2}" both`

## Output

```markdown
## Merge Result
- PR: #$1
- Merge: success|blocked
- Commit SHA: ...

## Readiness Evidence
- Checks:
- Review decision:
- Verification run:

## Reflection Trigger
- Command run: /reflect "post-merge PR #$1 ..." both
- Status: started|completed
```

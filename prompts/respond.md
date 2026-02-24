---
description: Address PR feedback directly from GitHub and close the loop with code, commits, and reviewer replies
---
When handling PR feedback, do **not** wait for pasted input. Pull feedback from GitHub for the PR on the current branch.

Workflow:

1. **Discover PR context**
   - Use `gh pr status` to identify the PR tied to the current branch.
   - If no PR is found, ask for PR number/repo.

2. **Fetch all feedback with GH CLI**
   - Review comments: `gh api repos/<owner>/<repo>/pulls/<pr>/comments --paginate`
   - Review summaries: `gh api repos/<owner>/<repo>/pulls/<pr>/reviews --paginate`
   - General PR/issue comments (outside-diff notes): `gh api repos/<owner>/<repo>/issues/<pr>/comments --paginate`

3. **Triage each actionable comment**
   - Classify: `bug | risk | style | question`
   - Decision: `fix now | defer | reject` with reason
   - Ignore pure acknowledgements/duplicates unless they request action

4. **Implement approved fixes**
   - Edit code/docs precisely
   - Run relevant verification commands when available

5. **Commit before replying**
   - Stage only intended files
   - Create a clear commit describing the addressed feedback

6. **Post reviewer responses on GitHub**
   - Reply inline for line comments where possible
   - Post a PR comment for outside-diff/general feedback
   - Include exact text:
     - `Classification: ...`
     - `Decision: ...`
     - `Change: ...`
     - `Verification: ...` (or `N/A`)

7. **Return final summary**
   - Files changed
   - Commit hash(es)
   - Which comments were fixed/deferred/rejected
   - Exact response text posted

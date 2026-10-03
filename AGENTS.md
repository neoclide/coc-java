# AGENTS.md

This project is a fork of git@github.com:redhat-developer/vscode-java.git for use with coc.nvim.

## Compatibility and API reuse

- Code changes must preserve all existing user-facing interfaces and behavior unless the user explicitly requests a breaking change.
- Prefer APIs provided by coc.nvim over reimplementing equivalent functionality.

## Task branches

After applicable tests pass and the diff is verified to contain only task changes, commit and push the working branch to its verified remote without asking for approval again. Preserve unrelated local changes. Do not force-push, merge the default branch, publish npm packages, or change credentials or permissions. An explicit tool approval rejection remains a blocker and must be reported, not bypassed.

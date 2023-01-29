# Change Log

## 1.14.1

- Fix background task not finish during completion by avoid selection range
  request.
- Fix an exception caused by undefined kind of WorkspaceSymbol on resolve.

## 1.14.0 (2023-01-29)

- Synchronize with [vscode-java@1.14.0](https://github.com/redhat-developer/vscode-java/tree/v1.14.0).
- `Standard` launch mode is used by default, because bugs with `Hybrid` mode.

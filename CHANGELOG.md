# Change Log

## 1.15.0 (2023-09-20)
 * performance - Skip generated methods when calculating document symbols.
 * performance - Make the debounce adaptive for the publish diagnostic job.
 * performance - Only perform context sensitive import rewrite when resolving completion items.
 * performance - Extension activation should not depend on language server being started.
 * enhancement - Support "extract interface" refactoring.
 * enhancement - Add "Convert String concatenation to Text Block" quick assist.
 * enhancement - Add clean up for using `try-with-resource`.
 * enhancement - Enable formatting support in syntax server.
 * enhancement - Add option to configure behaviour when mojo execution metadata not available.
 * enhancement - Add option to permit usage of test resources of a Maven project as dependencies within the compile scope of other projects.
 * bug fix - Change default generated method stub to throw exception.
 * bug fix - Prevent the paste handler for missing imports from generating overlapping text edits.
 * bug fix - Reference search doesn't work for fields in JDK classes.
 * bug fix - Paste event handling blocks pasting while project loading.
 * bug fix - Avoid generating boilerplate code repeatedly in new Java file.
 * bug fix - Completion results should include filtered (excluded) types if they are also present in the import declarations.
 * bug fix - Fix type hierarchy regression since VS Code 1.75.1.
 * bug fix - Re-publish diagnostics for null analysis configuration change when auto-build is disabled.
 * bug fix - Dependency Analytics extension popup shoud respect user choice.
 * bug fix - Only do full build for a configuration change when auto-build is enabled.
 * bug fix - The command to upgrade gradle should check for cancellation prior to updating metadata files.
 * bug fix - Fix incorrect ordering of completion items that use a decorator.
 * bug fix - Reduce the amount of logging from `org.apache.http` bundles.
 * documentation - Clarify the `README` quick start instructions.


## 1.14.1

- Fix background task not finish during completion by avoid selection range
  request.
- Fix an exception caused by undefined kind of WorkspaceSymbol on resolve.

## 1.14.0 (2023-01-29)

- Synchronize with [vscode-java@1.14.0](https://github.com/redhat-developer/vscode-java/tree/v1.14.0).
- `Standard` launch mode is used by default, because bugs with `Hybrid` mode.

# Upstream review — 2026-10-03

Downstream base: `8caf177` (coc-java 1.56.0), including prior semantic port `d9adc8902e149569c02893f62074c82d9c13439b` and subsequent Coc fixes. That commit does not record an exact upstream SHA. The existing local upstream checkout before fetch was `53806cd41757fe77262e1da6830b5ec6fb79e3a8`; this review covers its delta to verified `redhat-developer/vscode-java` origin/main `4e49f187a903b8c7b1ed7277a3b2535691fd59f3`. This is a bounded incremental review, not a claim of full upstream parity.

Adopted:

- `0f340dc`: Maven project cache size (default 50) as a JVM parameter, with positive-integer validation and explicit vmargs precedence. Coc restart detection includes the new setting.
- `40b302b`: classpath variable configuration. An empty-array default preserves Coc's explicit default/initialization contract.
- `a0b2508`: JavaSE-27 execution environment definition.
- `b7b8713`: suppress automatically generated AppCDS arguments on Java 26+, retaining the existing lower-version/debug/explicit-archive safeguards.
- `4afde40`: skip system JDK enumeration when the configured tooling JDK is valid. Preserve configured project runtimes, fallback order and Termux handling. Project-JDK auto-detection is deferred until each language client is ready, then delivered through a configuration notification. Both clients share discovery, and explicit project runtimes and selected build importers retain precedence. VS Code context.extension.packageJSON is not a Coc context API; retained existing package metadata access. Contrary to its commit description, this upstream diff does not change getMajorVersion's implementation, so no release-file parser was invented.

Omitted:

- `777cc2c`: embedded JRE/required JDK 25 upgrade; Coc retains its existing bundled JDT LS, JRE and minimum version behavior. Updating these would be a separate runtime compatibility change.
- `c70dfd8`: upstream pipe/stdio fallback removal; retained Coc's user-selectable transport and fallback plus its associated adapters.
- `2f656c5`: VS Code languageclient 10 APIs, LogOutputChannel and provider removal; Coc owns the client API and still needs its JDT content provider and completion adaptation.
- `28e5962`: VS Code TextMate Java grammar; this extension relies on the editor's syntax support and has no corresponding grammar.
- Upstream version/release notes (`98e302b`, `9262eef`, `2616f20`, `1f24503`, `4e49f18`) and dependency changes (`9b9665d`, `65b6a0c`, `addfdfe`, `5278202`, `11a35c3`, `1231ede`) apply to upstream's release/build/webview stack; no corresponding dependency is required by this port.

Validation:

- Baseline build/typecheck and Neovim virtual-server contracts: 31/31 passed.
- Final build/typecheck: passed. Neovim contracts: 33/33; real JDT LS integration: 8/8.
- Vim contracts: 31/33; the same two failures reproduce on untouched base (29/31): extended-outline tree navigation and postfix completion entering insert mode. New setting/argument/runtime regression checks all pass.
- Vim real JDT LS integration: 6/8; the identical member-access insert mode and enum completion menu failures reproduce on untouched base (6/8). These are pre-existing editor-interaction failures, not introduced by this port.
- Tests use the existing JDK 23 cache and local coc.nvim; no JDK installed. Original untracked history.md is untouched. No server binary upgrade.
- Coc contract inventory: riskCount 0; only additive manifest settings/runtime enum. git diff --check passed.

Earlier commit-and-push attempts were rejected by automatic approval because the later authorization was only available via delegated messages. Delivery was resumed after renewed user authorization; see Git history and the task report for commit/remote verification. The validation limitations above remain unchanged.

## PR #308 review follow-up

- Anchor the classpath-variable schema and add invalid-prefix/name regression cases.
- Move project-runtime discovery out of activation's critical path. Standard and syntax clients start with explicit settings, share background discovery after readiness, and receive the current merged configuration without changing user settings.
- Preserve explicit/default project runtimes, disabled detection, stopped clients, discovery-failure isolation, and the selected Maven/Gradle importer. Derive supported execution environments from the manifest instead of an uninitialized cache.
- Cloud validation with official Temurin 21 and Neovim 0.11.3: build/typecheck and diff checks passed; real JDT LS integration 8/8 passed. Contracts 37/40 passed, including all seven added tests and the updated manifest test. The same three failures reproduce on untouched PR head 26d9914 (30/33): nested Maven/Gradle roots resolve to an ancestor Git workspace in this container, and the clipboard-copy test has no headless clipboard provider. These are not reported as passing. Vim was not rerun for this follow-up.

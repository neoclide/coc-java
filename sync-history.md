# Unreleased upstream maintenance

- Add Java 27 runtime definitions and classpath variable settings.
- Configure Maven project cache size while preserving explicit VM arguments.
- Avoid unsupported AppCDS options on Java 26 and later.
- Skip tooling-JDK discovery when a valid tooling JDK is explicitly configured, and defer project-JDK auto-detection until the language client is ready.
- Validate the complete classpath variable name.

This separate history entry intentionally preserves the user's untracked history.md in the source checkout. See migrate.md for the reviewed commit range, adaptations and validation limitations.

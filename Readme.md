# coc-java

Fork of [vscode-java](https://github.com/redhat-developer/vscode-java) to
works with [coc.nvim](https://github.com/neoclide/coc.nvim).

# Quick Start

1. Install this extension by run command:

```
:CocInstall coc-java
```

2. If you do not have a _Java_ Development Kit correctly [set](#setting-the-jdk)
   - Download and install a recent Java Development Kit (latest Java 8 is the minimum requirement).
3. Extension is activated when you first access a Java file
   - Recognizes projects with _Maven_ or _Gradle_ build files in the directory hierarchy.

**Note**: this extension would download latest [jdt.ls](https://github.com/eclipse/eclipse.jdt.ls) for you when not found.

# Setting the JDK

The path to the Java Development Kit is searched in the following order:

- the `java.home` setting in coc.nvim settings (workspace then user settings)
- the `JDK_HOME` environment variable
- the `JAVA_HOME` environment variable
- on the current system path

# Features

- Maven pom.xml project support
- Basic Gradle Java project support
- As you type reporting of parsing and compilation errors
- Code completion
- Code actions / Refactoring
- Javadoc hovers
- Organize imports
- Type search
- Code outline
- Code navigation
- Code lens (references/implementations)
- Highlights
- Code formatting (on-type/selection/file)
- Code snippets
- Annotation processing support (automatic for Maven projects)

Please note that [Gradle-based Android projects are not supported](https://github.com/redhat-developer/vscode-java/issues/10#issuecomment-268834749).

# Available commands

The following commands are available:

- `java.updateLanguageServer`: download latest [jdt.ls](https://github.com/eclipse/eclipse.jdt.ls) from [eclipse.org](https://download.eclipse.org/jdtls/snapshots/?d).
- `java.projectConfiguration.update`: is available when the editor is focused on a Maven pom.xml or a Gradle file. It forces project configuration / classpath updates (eg. dependency changes or Java compilation level), according to the project build descriptor.
- `java.open.serverLog`: opens the Java Language Server log file, useful for troubleshooting problems.
- `java.workspace.compile`: manually triggers compilation of the workspace.
- `java.action.organizeImports`: Organize imports in the currently opened Java file.
- `java.open.formatter.settings`: Open the Eclipse formatter settings. Creates a new settings file if none exists.
- `java.clean.workspace`: Clean the Java language server workspace.

# Supported settings

The following settings are supported:

- `java.enabled`: When false, coc-java is disabled, default `true`.
- `java.home` : Absolute path to JDK 8 home folder used to launch the Java Language Server. Requires coc server restart.
- `java.jdt.ls.vmargs` : Extra VM arguments used to launch the Java Language Server. Requires coc server restart.
- `java.jdt.ls.home` : Directory contains jdt.ls server, would be used instead of bundled server when specified.
- `java.configuration.updateBuildConfiguration` : Specifies how modifications on build files update the Java classpath/configuration. Supported values are `disabled` (nothing happens), `interactive` (asks about updating on every modification), `automatic` (updating is automatically triggered).
- `java.errors.incompleteClasspath.severity` : Specifies the severity of the message when the classpath is incomplete for a Java file. Supported values are `ignore`, `info`, `warning`, `error`.
- `java.trace.server` : Traces the communication between VS Code and the Java language server.
- `java.configuration.maven.userSettings` : Absolute path to Maven's settings.xml.
- `java.import.exclusions` : Exclude folders from import via glob patterns.
- `java.referencesCodeLens.enabled` : Enable/disable the references code lenses.
- `java.implementationsCodeLens.enabled` : Enable/disable the implementations code lenses.
- `java.signatureHelp.enabled` : Enable/disable signature help support (triggered on `(`).
- `java.format.enabled` : Enable/disable the default Java formatter.
- `java.contentProvider.preferred` : Preferred content provider (see 3rd party decompilers available in [vscode-java-decompiler](https://github.com/dgileadi/vscode-java-decompiler)).
- `java.import.gradle.enabled` : Enable/disable the Gradle importer.
- `java.import.maven.enabled` : Enable/disable the Maven importer.
- `java.autobuild.enabled` : Enable/disable the 'auto build'.
- `java.completion.favoriteStaticMembers` : Defines a list of static members or types with static members.
- `java.completion.importOrder` : Defines the sorting order of import statements.
- `java.progressReports.enabled` : [Experimental] Enable/disable progress reports from background processes on the server.
- `java.completion.overwrite` : When set to true, code completion overwrites the current text. When set to false, code is simply added instead.
- `java.format.settings.url` : Specifies the url or file path to the [Eclipse formatter xml settings](https://github.com/redhat-developer/vscode-java/wiki/Formatter-settings).
- `java.format.settings.profile` : Optional formatter profile name from the Eclipse formatter settings.
- `java.format.comments.enabled` : Includes the comments during code formatting.
- `java.format.onType.enabled` : Enable/disable on-type formatting (triggered on `;`, `}` or `<return>`).
- `java.completion.guessMethodArguments` : When set to true, method arguments are guessed when a method is selected from as list of code assist proposals.
- `java.completion.enabled` : Enable/disable code completion support.
- `java.clean.workspace` : Clean the Java language server workspace.
- `java.foldingRange.enabled`: Enable/disable smart folding range support. If disabled, it will use the default indentation-based folding range provided by VS Code.

New in 1.3.0:

- `java.maven.downloadSources`: Enable/disable eager download of Maven source artifacts.
- `java.codeGeneration.useBlocks`: Use blocks in 'if' statements when generating the methods. Defaults to `false`.
- `java.codeGeneration.generateComments`: Generate method comments when generating the methods. Defaults to `false`.
- `java.codeGeneration.toString.template`: The template for generating the toString method. Defaults to `${object.className} [${member.name()}=${member.value}, ${otherMembers}]`.
- `java.codeGeneration.toString.codeStyle`: The code style for generating the toString method. Defaults to `STRING_CONCATENATION`.
- `java.codeGeneration.toString.skipNullValues`: Skip null values when generating the toString method. Defaults to `false`.
- `java.codeGeneration.toString.listArrayContents`: List contents of arrays instead of using native toString(). Defaults to `true`.
- `java.codeGeneration.toString.limitElements`: Limit number of items in arrays/collections/maps to list, if 0 then list all. Defaults to `0`.

New in 1.3.1:

- `java.import.gradle.wrapper.enabled`: Enable/disable the Gradle wrapper.
- `java.import.gradle.version`: Gradle version, used if the gradle wrapper is missing or disabled.
- CodeAction: `generate constructors` and `generate delegateMethods`

# Troubleshooting

- Run `:messages` to get echoed messages in vim.
- Text `JDT.LS` would be in your statusline when you have statusline integration with coc.nvim.
- Enable verbose trace for jdt.ls by add `"java.trace.server": "verbose"` in
  your settings file, then check output by `:CocCommand workspace.showOutput java`
- Run `:CocCommand java.open.serverLog` to open log of jdt.ls.
- Try `:CocCommand java.clean.workspace` to clean workspace cache.

# License

EPL 1.0, See [LICENSE](LICENSE) for more information.

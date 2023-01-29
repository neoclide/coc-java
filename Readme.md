# coc-java

[![License](https://img.shields.io/github/license/neoclide/coc-java?style=for-the-badge&logo=eclipse)](https://github.com/neoclide/coc-java/blob/master/LICENSE)

Fork of [vscode-java](https://github.com/redhat-developer/vscode-java) to
works with [coc.nvim](https://github.com/neoclide/coc.nvim).

Provides Java &trade; language support via
[Eclipse &trade; JDT Language Server](https://github.com/eclipse/eclipse.jdt.ls), which utilizes
[Eclipse &trade; JDT](http://www.eclipse.org/jdt/), [M2Eclipse](http://www.eclipse.org/m2e/) and [Buildship](https://github.com/eclipse/buildship).

## Quick Start

1. Install this extension by run command:

```
:CocInstall coc-java
```

2. If you do not have a _Java_ Development Kit correctly [set](#setting-the-jdk)
   - Download and install a Java Development Kit for your project (Java 1.5 or above is supported)
3. Extension is activated when you first access a Java file
   - Recognizes projects with _Maven_ or _Gradle_ build files in the directory hierarchy.

**Note**: this extension comes with bunlded [jdt.ls](https://github.com/eclipse/eclipse.jdt.ls) from 1.14.0, the same as vscode-java.

## Setting the JDK

The path to the Java Development Kit is searched in the following order:

- the `java.jdt.ls.java.home` setting in coc.nvim settings (workspace then user settings)
- the `JDK_HOME` environment variable
- the `JAVA_HOME` environment variable
- on the current system path

This JDK will be used to launch the Java Language Server. And by default, will be used to compile your projects.

If you need to compile your projects against a different JDK version, it's recommended you configure the `java.configuration.runtimes` property in your user settings, eg:

```json
"java.configuration.runtimes": [
  {
    "name": "JavaSE-1.11",
    "path": "/path/to/jdk-11",
  },
  {
    "name": "JavaSE-11",
    "path": "/path/to/jdk-11",
  },
  {
    "name": "JavaSE-14",
    "path": "/path/to/jdk-14",
    "default": true
  },
]
```

The default runtime will be used when you open standalone Java files.

## Features

- Supports code from Java 1.5 to Java 19
- Maven pom.xml project support
- Gradle project support (with experimental Android project import support)
- Standalone Java files support
- As-you-type reporting of parsing and compilation errors
- Code completion
- Code/Source actions / Refactoring
- Javadoc hovers
- Organize imports
  - triggered manually (by `:call CocAction('organizeImport')`) or on save
  - ~when pasting code into a java file with `Ctrl+Shift+v` (`Cmd+Shift+v` on Mac)~
- Type search
- Code outline
- Code folding
- Code navigation
- Code lens (references/implementations)
- Highlights
- Code formatting (on-type/selection/file)
- Code snippets
- Annotation processing support (automatic for Maven projects)
- Semantic selection
- Diagnostic tags
- Call Hierarchy
- Type Hierarchy (`:CocCommand java.action.showTypeHierarchy`)
- Share indexes (enabled by configuration `java.sharedIndexes.enabled`)

See the [changelog](CHANGELOG.md) for the latest release.

## Available commands

The following commands are available:

- `java.projectConfiguration.update: Reload Projects`: It forces project configuration / classpath updates (eg. dependency changes or Java compilation level), according to the project build descriptor.
- `java.project.import.command: Import Java Projects into Workspace`: detects and imports all the Java projects into the Java Language Server workspace.
- `java.open.serverLog: Open Java Language Server Log File`: opens the Java Language Server log file, useful for troubleshooting problems.
- `java.open.clientLog: Open Java Extension Log File`: opens the Java extension log file, useful for troubleshooting problems.
- `java.open.logs: Open All Log Files`: opens both the Java Language Server log file and the Java extension log file.
- `java.workspace.compile: Force Java Compilation`: manually triggers compilation of the workspace.
- `java.project.build: Rebuild Projects`: manually triggers a full build of the selected projects.
- `java.open.formatter.settings: Open Java Formatter Settings`: opens the Eclipse formatter settings. Creates a new settings file if none exists.
- `java.clean.workspace: Clean Java Language Server Workspace`: cleans the Java language server workspace.
- `java.project.updateSourceAttachment.command: Attach Source`: attaches a jar/zip source to the currently opened binary class file.
- `java.project.addToSourcePath.command: Add Folder to Java Source Path`: adds the selected folder to its project source path.
- `java.project.removeFromSourcePath.command: Remove Folder from Java Source Path`: removes the selected folder from its project source path.
- `java.project.listSourcePaths.command: List All Java Source Paths`: lists all the Java source paths recognized by the Java Language Server workspace.
- `java.show.server.task.status: Show Build Job Status`: shows the Java Language Server job status in Visual Studio Code terminal.
- `java.action.navigateToSuperImplementation: Go to Super Implementation`: goes to the super implementation for the current selected symbol in editor.

## Supported settings

The following coc.nvim settings are supported (checkout `:h coc-configuration` for how to use them):

- `java.enabled`: When false, coc-java is disabled.  Default: `true`
- `java.home`: **Deprecated, please use 'java.jdt.ls.java.home' instead.** Absolute path to JDK home folder used to launch the Java Language Server. Requires VS Code restart.
- `java.jdt.ls.directory`: Specifies the directory that contains jdt.ls  Default: `null`
- `java.jdt.ls.statusIcons`: Specifies the status icon for the Java Language Server. The status icon is displayed in the status bar when the Java Language Server is running. default to {"busy": "Busy", "ready": "OK", "warning": "Warning", "Error", "Error"}  Default: `null`
- `java.jdt.ls.java.home`: Specifies the folder path to the JDK (17 or more recent) used to launch the Java Language Server. This setting will replace the Java extension's embedded JRE to start the Java Language Server.   On Windows, backslashes must be escaped, i.e. "java.jdt.ls.java.home":"C:\\Program Files\\Java\\jdk-17.0_3"  Default: `null`
- `java.jdt.ls.vmargs`: Specifies extra VM arguments used to launch the Java Language Server. Eg. use `-XX:+UseParallelGC -XX:GCTimeRatio=4 -XX:AdaptiveSizePolicyWeight=90 -Dsun.zip.disableMemoryMapping=true -Xmx1G -Xms100m -Xlog:disable` to optimize memory usage with the parallel garbage collector  Default: `"-XX:+UseParallelGC -XX:GCTimeRatio=4 -XX:AdaptiveSizePolicyWeight=90 -Dsun.zip.disableMemoryMapping=true -Xmx1G -Xms100m -Xlog:disable"`
- `java.errors.incompleteClasspath.severity`: Specifies the severity of the message when the classpath is incomplete for a Java file  Default: `"warning"`
    Valid options: ["ignore","info","warning","error"]
- `java.configuration.checkProjectSettingsExclusions`: Controls whether to exclude extension-generated project settings files (.project, .classpath, .factorypath, .settings/) from the file explorer.  Default: `false`
- `java.configuration.updateBuildConfiguration`: Specifies how modifications on build files update the Java classpath/configuration  Default: `"interactive"`
    Valid options: ["disabled","interactive","automatic"]
- `java.trace.server`: Traces the communication between VS Code and the Java language server.  Default: `"off"`
    Valid options: ["off","messages","verbose"]
- `java.import.maven.enabled`: Enable/disable the Maven importer.  Default: `true`
- `java.import.maven.offline.enabled`: Enable/disable the Maven offline mode.  Default: `false`
- `java.import.gradle.enabled`: Enable/disable the Gradle importer.  Default: `true`
- `java.import.gradle.wrapper.enabled`: Use Gradle from the 'gradle-wrapper.properties' file.  Default: `true`
- `java.import.gradle.version`: Use Gradle from the specific version if the Gradle wrapper is missing or disabled.  Default: `null`
- `java.import.gradle.home`: Use Gradle from the specified local installation directory or GRADLE_HOME if the Gradle wrapper is missing or disabled and no 'java.import.gradle.version' is specified.  Default: `null`
- `java.import.gradle.java.home`: The location to the JVM used to run the Gradle daemon.  Default: `null`
- `java.import.gradle.offline.enabled`: Enable/disable the Gradle offline mode.  Default: `false`
- `java.import.gradle.arguments`: Arguments to pass to Gradle.  Default: `null`
- `java.import.gradle.jvmArguments`: JVM arguments to pass to Gradle.  Default: `null`
- `java.import.gradle.user.home`: Setting for GRADLE_USER_HOME.  Default: `null`
- `java.import.gradle.annotationProcessing.enabled`: Enable/disable the annotation processing on Gradle projects and delegate Annotation Processing to JDT APT. Only works for Gradle 5.2 or higher.  Default: `true`
- `java.maven.downloadSources`: Enable/disable download of Maven source artifacts as part of importing Maven projects.  Default: `false`
- `java.eclipse.downloadSources`: Enable/disable download of Maven source artifacts for Eclipse projects.  Default: `false`
- `java.maven.updateSnapshots`: Force update of Snapshots/Releases.  Default: `false`
- `java.referencesCodeLens.enabled`: Enable/disable the references code lens.  Default: `false`
- `java.signatureHelp.enabled`: Enable/disable the signature help.  Default: `true`
- `java.signatureHelp.description.enabled`: Enable/disable to show the description in signature help.  Default: `false`
- `java.implementationsCodeLens.enabled`: Enable/disable the implementations code lens.  Default: `false`
- `java.configuration.maven.userSettings`: Path to Maven's user settings.xml  Default: `null`
- `java.configuration.maven.globalSettings`: Path to Maven's global settings.xml  Default: `null`
- `java.configuration.maven.notCoveredPluginExecutionSeverity`: Specifies severity if the plugin execution is not covered by Maven build lifecycle.  Default: `"warning"`
    Valid options: ["ignore","warning","error"]
- `java.configuration.workspaceCacheLimit`: The number of days (if enabled) to keep unused workspace cache data. Beyond this limit, cached workspace data may be removed.  Default: `90`
- `java.format.enabled`: Enable/disable default Java formatter  Default: `true`
- `java.saveActions.organizeImports`: Enable/disable auto organize imports on save action  Default: `false`
- `java.import.exclusions`: Configure glob patterns for excluding folders. Use `!` to negate patterns to allow subfolders imports. You have to include a parent directory. The order is important.  Default: `["**/node_modules/**","**/.metadata/**","**/archetype-resources/**","**/META-INF/maven/**"]`
- `java.import.generatesMetadataFilesAtProjectRoot`: Specify whether the project metadata files(.project, .classpath, .factorypath, .settings/) will be generated at the project root. Click [HERE](command:_java.metadataFilesGeneration) to learn how to change the setting to make it take effect.  Default: `false`
- `java.project.referencedLibraries`: Configure glob patterns for referencing local libraries to a Java project.  Default: `["lib/**/*.jar"]`
- `java.project.outputPath`: A relative path to the workspace where stores the compiled output. `Only` effective in the `WORKSPACE` scope. The setting will `NOT` affect Maven or Gradle project.  Default: `""`
- `java.project.sourcePaths`: Relative paths to the workspace where stores the source files. `Only` effective in the `WORKSPACE` scope. The setting will `NOT` affect Maven or Gradle project.  Default: `[]`
- `java.contentProvider.preferred`: Preferred content provider (a 3rd party decompiler id, usually)  Default: `null`
- `java.autobuild.enabled`: Enable/disable the 'auto build'  Default: `true`
- `java.maxConcurrentBuilds`: Max simultaneous project builds  Default: `1`
- `java.recommendations.dependency.analytics.show`: Show the recommended Dependency Analytics extension.  Default: `true`
- `java.completion.maxResults`: Maximum number of completion results (not including snippets). `0` (the default value) disables the limit, all results are returned. In case of performance problems, consider setting a sensible limit.  Default: `0`
- `java.completion.enabled`: Enable/disable code completion support  Default: `true`
- `java.completion.guessMethodArguments`: When set to true, method arguments are guessed when a method is selected from as list of code assist proposals.  Default: `true`
- `java.completion.favoriteStaticMembers`: Defines a list of static members or types with static members. Content assist will propose those static members even if the import is missing.  Default: `["org.junit.Assert.*","org.junit.Assume.*","org.junit.jupiter.api.Assertions.*","org.junit.jupiter.api.Assumptions.*","org.junit.jupiter.api.DynamicContainer.*","org.junit.jupiter.api.DynamicTest.*","org.mockito.Mockito.*","org.mockito.ArgumentMatchers.*","org.mockito.Answers.*"]`
- `java.completion.filteredTypes`: Defines the type filters. All types whose fully qualified name matches the selected filter strings will be ignored in content assist or quick fix proposals and when organizing imports. For example 'java.awt.*' will hide all types from the awt packages.  Default: `["java.awt.*","com.sun.*","sun.*","jdk.*","org.graalvm.*","io.micrometer.shaded.*"]`
- `java.completion.importOrder`: Defines the sorting order of import statements. A package or type name prefix (e.g. 'org.eclipse') is a valid entry. An import is always added to the most specific group. As a result, the empty string (e.g. '') can be used to group all other imports. Static imports are prefixed with a '#'  Default: `["#","java","javax","org","com",""]`
- `java.completion.postfix.enabled`: Enable/disable postfix completion support. `#editor.snippetSuggestions#` can be used to customize how postfix snippets are sorted.  Default: `true`
- `java.completion.matchCase`: Specify whether to match case for code completion.  Default: `"auto"`
    Valid options: ["auto","firstLetter","off"]
- `java.foldingRange.enabled`: Enable/disable smart folding range support. If disabled, it will use the default indentation-based folding range provided by VS Code.  Default: `true`
- `java.progressReports.enabled`: [Experimental] Enable/disable progress reports from background processes on the server.  Default: `true`
- `java.format.settings.url`: Specifies the url or file path to the [Eclipse formatter xml settings](https://github.com/redhat-developer/vscode-java/wiki/Formatter-settings).  Default: `null`
- `java.format.settings.profile`: Optional formatter profile name from the Eclipse formatter settings.  Default: `null`
- `java.format.comments.enabled`: Includes the comments during code formatting.  Default: `true`
- `java.format.onType.enabled`: Enable/disable automatic block formatting when typing `;`, `<enter>` or `}`  Default: `true`
- `java.codeGeneration.hashCodeEquals.useJava7Objects`: Use Objects.hash and Objects.equals when generating the hashCode and equals methods. This setting only applies to Java 7 and higher.  Default: `false`
- `java.codeGeneration.hashCodeEquals.useInstanceof`: Use 'instanceof' to compare types when generating the hashCode and equals methods.  Default: `false`
- `java.codeGeneration.useBlocks`: Use blocks in 'if' statements when generating the methods.  Default: `false`
- `java.codeGeneration.generateComments`: Generate method comments when generating the methods.  Default: `false`
- `java.codeGeneration.toString.template`: The template for generating the toString method.  Default: `"${object.className} [${member.name()}=${member.value}, ${otherMembers}]"`
- `java.codeGeneration.toString.codeStyle`: The code style for generating the toString method.  Default: `"STRING_CONCATENATION"`
    Valid options: ["STRING_CONCATENATION","STRING_BUILDER","STRING_BUILDER_CHAINED","STRING_FORMAT"]
- `java.codeGeneration.toString.skipNullValues`: Skip null values when generating the toString method.  Default: `false`
- `java.codeGeneration.toString.listArrayContents`: List contents of arrays instead of using native toString().  Default: `true`
- `java.codeGeneration.toString.limitElements`: Limit number of items in arrays/collections/maps to list, if 0 then list all.  Default: `0`
- `java.codeGeneration.insertionLocation`: Specifies the insertion location of the code generated by source actions.  Default: `"afterCursor"`
    Valid options: ["afterCursor","beforeCursor","lastMember"]
- `java.selectionRange.enabled`: Enable/disable Smart Selection support for Java. Disabling this option will not affect the VS Code built-in word-based and bracket-based smart selection.  Default: `true`
- `java.showBuildStatusOnStart.enabled`: Automatically show build status on startup.  Default: `"notification"`
- `java.configuration.runtimes`: Map Java Execution Environments to local JDKs.  Default: `[]`
- `java.server.launchMode`: The launch mode for the Java extension  Default: `"Standard"`
    Valid options: ["Standard","LightWeight","Hybrid"]
- `java.sources.organizeImports.starThreshold`: Specifies the number of imports added before a star-import declaration is used.  Default: `99`
- `java.sources.organizeImports.staticStarThreshold`: Specifies the number of static imports added before a star-import declaration is used.  Default: `99`
- `java.imports.gradle.wrapper.checksums`: Defines allowed/disallowed SHA-256 checksums of Gradle Wrappers  Default: `[]`
- `java.project.importOnFirstTimeStartup`: Specifies whether to import the Java projects, when opening the folder in Hybrid mode for the first time.  Default: `"automatic"`
    Valid options: ["disabled","interactive","automatic"]
- `java.project.importHint`: Enable/disable the server-mode switch information, when Java projects import is skipped on startup.  Default: `true`
- `java.project.resourceFilters`: Excludes files and folders from being refreshed by the Java Language Server, which can improve the overall performance. For example, ["node_modules","\.git"] will exclude all files and folders named 'node_modules' or '.git'. Pattern expressions must be compatible with `java.util.regex.Pattern`. Defaults to ["node_modules","\.git"].  Default: `["node_modules","\\.git"]`
- `java.templates.fileHeader`: Specifies the file header comment for new Java file. Supports configuring multi-line comments with an array of strings, and using ${variable} to reference the [predefined variables](command:_java.templateVariables).  Default: `[]`
- `java.templates.typeComment`: Specifies the type comment for new Java type. Supports configuring multi-line comments with an array of strings, and using ${variable} to reference the [predefined variables](command:_java.templateVariables).  Default: `[]`
- `java.references.includeAccessors`: Include getter, setter and builder/constructor when finding references.  Default: `true`
- `java.references.includeDecompiledSources`: Include the decompiled sources when finding references.  Default: `true`
- `java.typeHierarchy.lazyLoad`: Enable/disable lazy loading the content in type hierarchy. Lazy loading could save a lot of loading time but every type should be expanded manually to load its content.  Default: `false`
- `java.settings.url`: Specifies the url or file path to the workspace Java settings. See [Setting Global Preferences](https://github.com/redhat-developer/vscode-java/wiki/Settings-Global-Preferences)  Default: `null`
- `java.symbols.includeSourceMethodDeclarations`: Include method declarations from source files in symbol search.  Default: `false`
- `java.quickfix.showAt`: Show quickfixes at the problem or line level.  Default: `"line"`
    Valid options: ["line","problem"]
- `java.inlayHints.parameterNames.enabled`: Enable/disable inlay hints for parameter names: ```java  Integer.valueOf(/* s: */ '123', /* radix: */ 10)   ```  `#java.inlayHints.parameterNames.exclusions#` can be used to disable the inlay hints for methods.  Default: `"literals"`
    Valid options: ["none","literals","all"]
- `java.inlayHints.parameterNames.exclusions`: The patterns for the methods that will be disabled to show the inlay hints. Supported pattern examples:  - `java.lang.Math.*` - All the methods from java.lang.Math.  - `*.Arrays.asList` - Methods named as 'asList' in the types named as 'Arrays'.  - `*.println(*)` - Methods named as 'println'.  - `(from, to)` - Methods with two parameters named as 'from' and 'to'.  - `(arg*)` - Methods with one parameter whose name starts with 'arg'.  Default: `[]`
- `java.project.encoding`: Project encoding settings  Default: `"ignore"`
    Valid options: ["ignore","warning","setDefault"]
- `java.jdt.ls.lombokSupport.enabled`: Whether to load lombok processors from project classpath  Default: `true`
- `java.jdt.ls.protobufSupport.enabled`: Specify whether to automatically add Protobuf output source directories to the classpath.  **Note:** Only works for Gradle `com.google.protobuf` plugin `0.8.4` or higher.  Default: `true`
- `java.jdt.ls.androidSupport.enabled`: [Experimental] Specify whether to enable Android project importing. When set to `auto`, the Android support will be enabled in Visual Studio Code - Insiders.  **Note:** Only works for Android Gradle Plugin `3.2.0` or higher.  Default: `"auto"`
    Valid options: ["auto","on","off"]
- `java.codeAction.sortMembers.avoidVolatileChanges`: Reordering of fields, enum constants, and initializers can result in semantic and runtime changes due to different initialization and persistence order. This setting prevents this from occurring.  Default: `true`
- `java.compile.nullAnalysis.nonnull`: Specify the Nonnull annotation types to be used for null analysis. If more than one annotation is specified, then the topmost annotation will be used first if it exists in project dependencies. This setting will be ignored if `java.compile.nullAnalysis.mode` is set to `disabled`  Default: `["javax.annotation.Nonnull","org.eclipse.jdt.annotation.NonNull","org.springframework.lang.NonNull"]`
- `java.compile.nullAnalysis.nullable`: Specify the Nullable annotation types to be used for null analysis. If more than one annotation is specified, then the topmost annotation will be used first if it exists in project dependencies. This setting will be ignored if `java.compile.nullAnalysis.mode` is set to `disabled`  Default: `["javax.annotation.Nullable","org.eclipse.jdt.annotation.Nullable","org.springframework.lang.Nullable"]`
- `java.compile.nullAnalysis.mode`: Specify how to enable the annotation-based null analysis.  Default: `"interactive"`
    Valid options: ["disabled","interactive","automatic"]
- `java.cleanup.actionsOnSave`: The list of clean ups to be run on the current document when it's saved. Clean ups can automatically fix code style or programming mistakes. Click [HERE](command:_java.learnMoreAboutCleanUps) to learn more about what each clean up does.  Default: `[]`
- `java.sharedIndexes.enabled`: [Experimental] Specify whether to share indexes between different workspaces. When set to `auto`, shared indexes will be enabled in Visual Studio Code - Insiders.  Default: `"auto"`
    Valid options: ["auto","on","off"]
- `java.sharedIndexes.location`: Specifies a common index location for all workspaces. See default values as follows:   Windows: First use `"$APPDATA\\.jdt\\index"`, or `"~\\.jdt\\index"` if it does not exist   macOS: `"~/Library/Caches/.jdt/index"`   Linux: First use `"$XDG_CACHE_HOME/.jdt/index"`, or `"~/.cache/.jdt/index"` if it does not exist  Default: `""`

Settings added by coc-java:

- `java.enabled`
- `java.jdt.ls.directory`
- `java.jdt.ls.statusIcons`

## Semantic Highlighting

To enable semantic highlighting support, use configuration:

``` json
"semanticTokens.enable": true,
```

For java filetype only, use:

``` json
"[java]": {
  "semanticTokens.enable": true,
}
```

Checkout `:h coc-configuration-scope`.

## Buffer not work

The jdt.ls requires buffer saved to disk to work, save the buffer by `:w`
command and reload it by `:e` command in your vim.  Or create the file on disk
before buffer create.

## Compiler warnings

To customize compiler warnings, create the file `root_project/.settings/org.eclipse.jdt.core.prefs` with values presented at https://help.eclipse.org/neon/topic/org.eclipse.jdt.doc.isv/reference/api/org/eclipse/jdt/core/JavaCore.html 

## "Classpath is incomplete" warning

See https://github.com/redhat-developer/vscode-java/wiki/%22Classpath-is-incomplete%22-warning


## Troubleshooting

- Text `OK` would be in your statusline when jdt.ls is ready and you have
  statusline integration with coc.nvim. (could be configured by `java.jdt.ls.statusIcons`)
- Run `:CocOpenLog` to get unexpected errors thrown by coc.nvim extensions.
- Enable verbose trace for jdt.ls by add `"java.trace.server": "verbose"` in
  your settings file, then check output by `:CocCommand java.open.output`
- Run `:CocCommand java.open.serverLog` to open log of jdt.ls.
- Run `:CocCommand java.open.clientLog` to open extension Log File.
- Try `:CocCommand java.clean.workspace` to clean workspace cache.

## Feedback
* Have a question? Start a discussion on [GitHub Discussions](https://github.com/neoclide/coc.nvim/discussions),
* File a bug in [GitHub Issues](https://github.com/neoclide/coc-java/issues),
* Chat with us on [Gitter](https://gitter.im/neoclide/coc.nvim),

## License

EPL 1.0, See [LICENSE](LICENSE) for more information.

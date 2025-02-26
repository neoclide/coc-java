'use strict'

import { CancellationToken, CodeActionKind, commands, ConfigurationTarget, DocumentSelector, Emitter, ExtensionContext, extensions, LanguageClient, LanguageClientOptions, languages, Location, Position, Range, services, StreamInfo, TextDocumentPositionParams, TextEditor, Uri, window, nvim, workspace, diagnosticManager, DiagnosticSeverity, DiagnosticItem } from "coc.nvim"
import * as fse from 'fs-extra'
import { findRuntimes } from "jdk-utils"
import * as net from 'net'
import * as path from 'path'
import { ConfigurationParams, ConfigurationRequest, MessageType } from "vscode-languageserver-protocol"
import { apiManager } from "./apiManager"
import * as buildPath from './buildpath'
import { javaRefactorKinds, RefactorDocumentProvider } from "./codeActionProvider"
import { Commands } from "./commands"
import { ClientStatus } from "./extension.api"
import * as fileEventHandler from './fileEventHandler'
import { gradleCodeActionMetadata, GradleCodeActionProvider } from "./gradle/gradleCodeActionProvider"
import { JavaInlayHintsProvider } from "./inlayHintsProvider"
import { awaitServerConnection, prepareExecutable } from "./javaServerStarter"
import { createLogger } from "./log"
import { checkLombokDependency } from "./lombokSupport"
import { markdownPreviewProvider } from "./markdownPreviewProvider"
import { collectBuildFilePattern, onExtensionChange } from "./plugin"
import { pomCodeActionMetadata, PomCodeActionProvider } from "./pom/pomCodeActionProvider"
import { ActionableNotification, BuildProjectParams, BuildProjectRequest, CompileWorkspaceRequest, BuildWorkspaceStatus, EventNotification, EventType, ExecuteClientCommandRequest, FeatureStatus, FindLinks, GradleCompatibilityInfo, LinkLocation, ProgressReportNotification, ServerNotification, SourceAttachmentAttribute, SourceAttachmentRequest, SourceAttachmentResult, StatusNotification, UpgradeGradleWrapperInfo } from "./protocol"
import * as refactorAction from './refactorAction'
import { getJdkUrl, RequirementsData, sortJdksBySource, sortJdksByVersion } from "./requirements"
import { serverStatus, ServerStatusKind } from "./serverStatus"
import { serverStatusBarProvider } from "./serverStatusBarProvider"
import { activationProgressNotification, serverTaskPresenter } from "./serverTaskPresenter"
import { serverTasks } from "./serverTasks"
import { excludeProjectSettingsFiles, ServerMode, setGradleWrapperChecksum } from "./settings"
import * as sourceAction from './sourceAction'
import { askForProjects, projectConfigurationUpdate, upgradeGradle } from "./standardLanguageClientUtils"
import { TypeHierarchyDirection, TypeHierarchyItem } from "./typeHierarchy/protocol"
import { typeHierarchyTree } from "./typeHierarchy/typeHierarchyTree"
import { getAllJavaProjects, getJavaConfig, getJavaConfiguration } from "./utils"

const extensionName = 'Language Support for Java'
const GRADLE_CHECKSUM = "gradle/checksum/prompt"
const GET_JDK = "Get the Java Development Kit"
const USE_JAVA = "Use Java "
const AS_GRADLE_JVM = " as Gradle JVM"
const UPGRADE_GRADLE = "Upgrade Gradle to "
const GRADLE_IMPORT_JVM = "java.import.gradle.java.home"
export const JAVA_SELECTOR: DocumentSelector = [
  { scheme: "file", language: "java", pattern: "**/*.java" },
  { scheme: "jdt", language: "java", pattern: "**/*.class" },
  { scheme: "untitled", language: "java", pattern: "**/*.java" }
]

export class StandardLanguageClient {

  private languageClient: LanguageClient
  private status: ClientStatus = ClientStatus.uninitialized;

  public async initialize(context: ExtensionContext, requirements: RequirementsData, clientOptions: LanguageClientOptions, workspacePath: string, jdtEventEmitter: Emitter<Uri>): Promise<void> {
    if (this.status !== ClientStatus.uninitialized) {
      return
    }

    const hasImported: boolean = await fse.pathExists(path.join(workspacePath, ".metadata", ".plugins"))

    if (workspace.getConfiguration().get("java.showBuildStatusOnStart.enabled") === "terminal") {
      commands.executeCommand(Commands.SHOW_SERVER_TASK_STATUS)
    }

    context.subscriptions.push(commands.registerCommand(Commands.RUNTIME_VALIDATION_OPEN, () => {
      // commands.executeCommand("workbench.action.openSettings", "java.configuration.runtimes")
    }))

    serverStatus.initialize()
    serverStatus.onServerStatusChanged(status => {
      if (status === ServerStatusKind.busy) {
        serverStatusBarProvider.setBusy()
      } else if (status === ServerStatusKind.error) {
        serverStatusBarProvider.setError()
      } else if (status === ServerStatusKind.warning) {
        serverStatusBarProvider.setWarning()
      } else {
        serverStatusBarProvider.setReady()
      }
    })

    let serverOptions: any
    const port = process.env['SERVER_PORT']
    if (!port) {
      const lsPort = process.env['JDTLS_CLIENT_PORT']
      if (!lsPort) {
        serverOptions = prepareExecutable(requirements, workspacePath, getJavaConfig(requirements.java_home), context, false)
      } else {
        serverOptions = () => {
          const socket = net.connect(lsPort)
          const result: StreamInfo = {
            writer: socket,
            reader: socket
          }
          return Promise.resolve(result)
        }
      }
    } else {
      // used during development
      serverOptions = awaitServerConnection.bind(null, port)
    }

    // Create the language client and start the client.
    this.languageClient = new LanguageClient('java', extensionName, serverOptions, clientOptions)
    services.registerLanguageClient(this.languageClient)

    this.languageClient.onReady().then(() => {
      activationProgressNotification.showProgress()
      this.languageClient.onNotification(StatusNotification.type, (report) => {
        switch (report.type) {
          case 'ServiceReady':
            apiManager.updateServerMode(ServerMode.standard)
            apiManager.fireDidServerModeChange(ServerMode.standard)
            apiManager.resolveServerReadyPromise()

            if (extensions.onDidActiveExtension) {// Theia doesn't support this API yet
              extensions.onDidActiveExtension(async () => {
                await onExtensionChange(extensions.all)
              })
            }

            activationProgressNotification.hide()
            if (!hasImported) {
              showImportFinishNotification(context)
            }
            checkLombokDependency(context)
            apiManager.getApiInstance().onDidClasspathUpdate((uri: Uri) => {
              checkLombokDependency(context, uri)
            })
            // Disable the client-side snippet provider since LS is ready.
            // snippetCompletionProvider.dispose()
            break
          case 'Started':
            this.status = ClientStatus.started
            serverStatus.updateServerStatus(ServerStatusKind.ready)
            // commands.executeCommand('setContext', 'javaLSReady', true)
            apiManager.updateStatus(ClientStatus.started)
            break
          case 'Error':
            this.status = ClientStatus.error
            serverStatus.updateServerStatus(ServerStatusKind.error)
            apiManager.updateStatus(ClientStatus.error)
            break
          case 'ProjectStatus':
            if (report.message === "WARNING") {
              serverStatus.updateServerStatus(ServerStatusKind.warning)
            } else if (report.message === "OK") {
              this.status = ClientStatus.started
              serverStatus.errorResolved()
              serverStatus.updateServerStatus(ServerStatusKind.ready)
            }
            return
          case 'Starting':
          case 'Message':
            // message goes to progress report instead
            break
        }
        if (!serverStatus.hasErrors()) {
          serverStatusBarProvider.updateTooltip(report.message)
        }
      })

      this.languageClient.onNotification(ProgressReportNotification.type, (progress) => {
        serverTasks.updateServerTask(progress)
      })

      this.languageClient.onNotification(EventNotification.type, async (notification) => {
        switch (notification.eventType) {
          case EventType.classpathUpdated:
            apiManager.fireDidClasspathUpdate(Uri.parse(notification.data))
            break
          case EventType.projectsImported: {
            const projectUris: Uri[] = []
            if (notification.data) {
              for (const uriString of notification.data) {
                projectUris.push(Uri.parse(uriString))
              }
            }
            if (projectUris.length > 0) {
              apiManager.fireDidProjectsImport(projectUris)
            }
            break
          }
          case EventType.projectsDeleted: {
            const projectUris: Uri[] = []
            if (notification.data) {
              for (const uriString of notification.data) {
                projectUris.push(Uri.parse(uriString))
              }
            }
            if (projectUris.length > 0) {
              apiManager.fireDidProjectsDelete(projectUris)
            }
            break
          }
          case EventType.incompatibleGradleJdkIssue:
            const options: string[] = []
            const info = notification.data as GradleCompatibilityInfo
            const highestJavaVersion = Number(info.highestJavaVersion)
            let runtimes = await findRuntimes({ checkJavac: true, withVersion: true, withTags: true })
            runtimes = runtimes.filter(runtime => {
              return runtime.version.major <= highestJavaVersion
            })
            sortJdksByVersion(runtimes)
            sortJdksBySource(runtimes)
            options.push(UPGRADE_GRADLE + info.recommendedGradleVersion)
            if (!runtimes.length) {
              options.push(GET_JDK)
            } else {
              options.push(USE_JAVA + runtimes[0].version.major + AS_GRADLE_JVM)
            }
            this.showGradleCompatibilityIssueNotification(info.message, options, info.projectUri, info.recommendedGradleVersion, runtimes[0]?.homedir)
            break
          case EventType.upgradeGradleWrapper:
            const neverShow: boolean | undefined = context.globalState.get<boolean>("java.neverShowUpgradeWrapperNotification")
            if (!neverShow) {
              const upgradeInfo = notification.data as UpgradeGradleWrapperInfo
              const option = `Upgrade to ${upgradeInfo.recommendedGradleVersion}`
              window.showWarningMessage(upgradeInfo.message, option, "Don't show again").then(async (choice) => {
                if (choice === option) {
                  await upgradeGradle(upgradeInfo.projectUri, upgradeInfo.recommendedGradleVersion)
                } else if (choice === "Don't show again") {
                  context.globalState.update("java.neverShowUpgradeWrapperNotification", true)
                }
              })
            }
            break
          default:
            break
        }
      })

      this.languageClient.onNotification(ActionableNotification.type, (notification) => {
        let show = null
        switch (notification.severity) {
          case MessageType.Log:
            show = logNotification
            break
          case MessageType.Info:
            show = window.showInformationMessage.bind(window)
            break
          case MessageType.Warning:
            show = window.showWarningMessage.bind(window)
            break
          case MessageType.Error:
            show = window.showErrorMessage.bind(window)
            break
        }
        if (!show) {
          return
        }
        const titles = notification.commands.map(a => a.title)
        show(notification.message, ...titles).then((selection) => {
          for (const action of notification.commands) {
            if (action.title === selection) {
              const args: any[] = (action.arguments) ? action.arguments : []
              commands.executeCommand(action.command, ...args)
              break
            }
          }
        })
      })

      this.languageClient.onRequest(ExecuteClientCommandRequest.type, (params) => {
        return commands.executeCommand(params.command, ...params.arguments)
      })

      this.languageClient.onNotification(ServerNotification.type, (params) => {
        commands.executeCommand(params.command, ...params.arguments)
      })

      this.languageClient.onRequest(ConfigurationRequest.type as any, (params: ConfigurationParams) => {
        const result: any[] = []
        const activeEditor: TextEditor | undefined = window.activeTextEditor
        const currUri = activeEditor?.document.uri
        for (const item of params.items) {
          const scopeUri: Uri | undefined = item.scopeUri && Uri.parse(item.scopeUri)
          if (scopeUri && scopeUri.toString() === currUri) {
            if (item.section === "java.format.insertSpaces") {
              result.push(activeEditor.options.insertSpaces)
            } else if (item.section === "java.format.tabSize") {
              result.push(activeEditor.options.tabSize)
            } else {
              result.push(null)
            }
          } else {
            result.push(workspace.getConfiguration(null, scopeUri).get(item.section, null /* defaultValue */))
          }
        }
        return result
      })
    })

    this.registerCommandsForStandardServer(context, jdtEventEmitter)
    fileEventHandler.registerFileEventHandlers(this.languageClient, context)

    collectBuildFilePattern(extensions.all)

    this.status = ClientStatus.initialized
  }

  private showGradleCompatibilityIssueNotification(message: string, options: string[], projectUri: string, gradleVersion: string, newJavaHome: string) {
    window.showErrorMessage(`${message} [Learn More](https://docs.gradle.org/current/userguide/compatibility.html)`, ...options).then(async (choice) => {
      if (choice === GET_JDK) {
        commands.executeCommand(Commands.OPEN_BROWSER, Uri.parse(getJdkUrl()))
      } else if (choice.startsWith(USE_JAVA)) {
        await workspace.getConfiguration().update(GRADLE_IMPORT_JVM, newJavaHome, ConfigurationTarget.Global)
        commands.executeCommand("workbench.action.openSettings", GRADLE_IMPORT_JVM)
        commands.executeCommand(Commands.IMPORT_PROJECTS_CMD)
      } else if (choice.startsWith(UPGRADE_GRADLE)) {
        await upgradeGradle(projectUri, gradleVersion)
      }
    })
  }

  private registerCommandsForStandardServer(context: ExtensionContext, jdtEventEmitter: Emitter<Uri>): void {
    context.subscriptions.push(commands.registerCommand(Commands.IMPORT_PROJECTS_CMD, async () => {
      return await commands.executeCommand<void>(Commands.EXECUTE_WORKSPACE_COMMAND, Commands.IMPORT_PROJECTS)
    }))

    context.subscriptions.push(commands.registerCommand(Commands.OPEN_OUTPUT, () => this.languageClient.outputChannel.show()))
    context.subscriptions.push(commands.registerCommand(Commands.SHOW_SERVER_TASK_STATUS, () => serverTaskPresenter.presentServerTaskView()))

    this.languageClient.onReady().then(() => {
      context.subscriptions.push(commands.registerCommand(GRADLE_CHECKSUM, (wrapper: string, sha256: string) => {
        setGradleWrapperChecksum(wrapper, sha256)
      }, null, true))

      context.subscriptions.push(commands.registerCommand(Commands.SHOW_JAVA_REFERENCES, (uri: string, position: Position, locations: Location[]) => {
        commands.executeCommand(Commands.SHOW_REFERENCES, uri, position, locations)
      }, null, true))
      context.subscriptions.push(commands.registerCommand(Commands.SHOW_JAVA_IMPLEMENTATIONS, (uri: string, position: Position, locations: Location[]) => {
        commands.executeCommand(Commands.SHOW_REFERENCES, Uri.parse(uri), position, locations)
      }, null, true))

      context.subscriptions.push(commands.registerCommand(Commands.CONFIGURATION_UPDATE, (uri?: Uri) => projectConfigurationUpdate(this.languageClient, uri)))

      context.subscriptions.push(commands.registerCommand(Commands.IGNORE_INCOMPLETE_CLASSPATH, () => setIncompleteClasspathSeverity('ignore'), null, true))

      context.subscriptions.push(commands.registerCommand(Commands.IGNORE_INCOMPLETE_CLASSPATH_HELP, () => {
        commands.executeCommand(Commands.OPEN_BROWSER, 'https://github.com/redhat-developer/vscode-java/wiki/%22Classpath-is-incomplete%22-warning')
      }))

      context.subscriptions.push(commands.registerCommand(Commands.PROJECT_CONFIGURATION_STATUS, (uri, status) => setProjectConfigurationUpdate(this.languageClient, uri, status), null, true))

      context.subscriptions.push(commands.registerCommand(Commands.NULL_ANALYSIS_SET_MODE, (status) => setNullAnalysisStatus(status), null, true))

      context.subscriptions.push(commands.registerCommand(Commands.APPLY_WORKSPACE_EDIT, (obj) => {
        return workspace.applyEdit(obj)
      }, null, true))

      context.subscriptions.push(commands.registerCommand(Commands.NAVIGATE_TO_SUPER_IMPLEMENTATION_COMMAND, async (location?: LinkLocation | Uri) => {
        let superImplLocation: Location | undefined

        if (!location) { // comes from command palette
          if (!window.activeTextEditor) return
          if (window.activeTextEditor?.document.languageId !== "java") return
          location = Uri.parse(window.activeTextEditor.document.uri)
        }
        let position = await window.getCursorPosition()

        if (location instanceof Uri) { // comes from context menu
          const params: TextDocumentPositionParams = {
            textDocument: {
              uri: location.toString(),
            },
            position
          }
          const response = await this.languageClient.sendRequest(FindLinks.type, {
            type: 'superImplementation',
            position: params,
          })

          if (response && response.length > 0) {
            const superImpl = response[0]
            superImplLocation = Location.create(
              superImpl.uri,
              superImpl.range
            )
          }
        } else { // comes from hover information
          superImplLocation = Location.create(
            Uri.parse(decodeBase64(location.uri)).toString(),
            location.range,
          )
        }

        if (superImplLocation) {
          await workspace.jumpTo(superImplLocation.uri, superImplLocation.range.start)
          return window.selectRange(superImplLocation.range)
        } else {
          return showNoLocationFound('No super implementation found')
        }
      }))

      context.subscriptions.push(commands.registerCommand(Commands.SHOW_TYPE_HIERARCHY, async (location?: any) => {
        let position = await window.getCursorPosition()
        if (location instanceof Uri) {
          typeHierarchyTree.setTypeHierarchy(Location.create(location.toString(), Range.create(position, position)), TypeHierarchyDirection.both)
        } else {
          if (window.activeTextEditor?.document.languageId !== "java") return
          typeHierarchyTree.setTypeHierarchy(Location.create(window.activeTextEditor.document.uri, Range.create(position, position)), TypeHierarchyDirection.both)
        }
      }))

      context.subscriptions.push(commands.registerCommand(Commands.SHOW_CLASS_HIERARCHY, () => {
        typeHierarchyTree.changeDirection(TypeHierarchyDirection.both)
      }, null, true))

      context.subscriptions.push(commands.registerCommand(Commands.SHOW_SUPERTYPE_HIERARCHY, () => {
        typeHierarchyTree.changeDirection(TypeHierarchyDirection.parents)
      }, null, true))

      context.subscriptions.push(commands.registerCommand(Commands.SHOW_SUBTYPE_HIERARCHY, () => {
        typeHierarchyTree.changeDirection(TypeHierarchyDirection.children)
      }, null, true))

      context.subscriptions.push(commands.registerCommand(Commands.CHANGE_BASE_TYPE, async (item: TypeHierarchyItem) => {
        typeHierarchyTree.changeBaseItem(item)
      }, null, true))

      context.subscriptions.push(commands.registerCommand(Commands.BUILD_PROJECT, async (uris: Uri[] | Uri, isFullBuild: boolean, token: CancellationToken) => {
        let resources: Uri[] = []
        if (uris instanceof Uri) {
          resources.push(uris)
        } else if (Array.isArray(uris)) {
          for (const uri of uris) {
            if (uri instanceof Uri) {
              resources.push(uri)
            }
          }
        }

        if (!resources.length) {
          let doc = window.activeTextEditor?.document
          resources = await askForProjects(
            doc ? Uri.parse(doc.uri) : undefined,
            "Please select the project(s) to rebuild.",
          )
          if (!resources?.length) {
            return
          }
        }

        const params: BuildProjectParams = {
          identifiers: resources.map((u => {
            return { uri: u.toString() }
          })),
          // we can consider expose 'isFullBuild' according to users' feedback,
          // currently set it to true by default.
          isFullBuild: isFullBuild === undefined ? true : isFullBuild,
        }

        return window.withProgress({ title: 'Rebuild' }, async p => {
          p.report({ message: 'Rebuilding projects...' })
          return new Promise(async (resolve, reject) => {
            const start = new Date().getTime()
            let res: BuildWorkspaceStatus
            try {
              res = token ? await this.languageClient.sendRequest(BuildProjectRequest.type, params, token) :
                await this.languageClient.sendRequest(BuildProjectRequest.type, params)
            } catch (error) {
              if (error && error.code === -32800) { // Check if the request is cancelled.
                res = BuildWorkspaceStatus.cancelled
              }
              reject(error)
            }

            const elapsed = new Date().getTime() - start
            const humanVisibleDelay = elapsed < 1000 ? 1000 : 0

            if (res == BuildWorkspaceStatus.withError) {
              showCompileBuildDiagnostics()
              window.showWarningMessage("Build finished with errors")
            } else if (res == BuildWorkspaceStatus.succeed) {
              window.showInformationMessage("Build finished successfully")
            } else if (res == BuildWorkspaceStatus.cancelled) {
              window.showWarningMessage("Build process was canceled")
            } else {
              window.showErrorMessage("Build process failed")
            }
            setTimeout(() => { // set a timeout so user would still see the message when build time is short
              resolve()
            }, humanVisibleDelay)
          })
        })
      }))

      context.subscriptions.push(commands.registerCommand(Commands.COMPILE_WORKSPACE, (isFullCompile: boolean, token?: CancellationToken) => {
        return window.withProgress({ title: 'Compiling' }, async p => {
          if (typeof isFullCompile !== 'boolean') {
            const selection = await window.showQuickPick(['Incremental', 'Full'], { placeholder: 'please choose compile type:' })
            isFullCompile = selection !== 'Incremental'
          }
          p.report({ message: 'Compiling workspace...' })
          return new Promise(async (resolve, reject) => {
            const start = new Date().getTime()
            let res: BuildWorkspaceStatus
            try {
              res = token ? await this.languageClient.sendRequest(CompileWorkspaceRequest.type, isFullCompile, token)
                : await this.languageClient.sendRequest(CompileWorkspaceRequest.type, isFullCompile)
            } catch (error) {
              if (error && error.code === -32800) { // Check if the request is cancelled.
                res = BuildWorkspaceStatus.cancelled
              } else {
                reject(error)
              }
            }

            const elapsed = new Date().getTime() - start
            const humanVisibleDelay = elapsed < 1000 ? 1000 : 0

            if (res == BuildWorkspaceStatus.withError) {
              showCompileBuildDiagnostics()
              window.showWarningMessage("Compilation for workspace finished with errors")
            } else if (res == BuildWorkspaceStatus.succeed) {
              window.showInformationMessage("Compilation for workspace finished successfully")
            } else if (res == BuildWorkspaceStatus.cancelled) {
              window.showWarningMessage("Compilation process was canceled")
            } else {
              window.showErrorMessage("Compilation process failed")
            }
            setTimeout(() => { // set a timeout so user would still see the message when build time is short
              resolve(res)
            }, humanVisibleDelay)
          })
        })
      }))

      context.subscriptions.push(commands.registerCommand(Commands.UPDATE_SOURCE_ATTACHMENT_CMD, async (classFileUri?: Uri): Promise<boolean> => {
        if (!classFileUri) {
          classFileUri = window.activeTextEditor ? Uri.parse(window.activeTextEditor.document.uri) : undefined
          if (!classFileUri || classFileUri.scheme !== 'file') return
        }
        const resolveRequest: SourceAttachmentRequest = {
          classFileUri: classFileUri.toString(),
        }
        const resolveResult: SourceAttachmentResult = await <SourceAttachmentResult>commands.executeCommand(Commands.EXECUTE_WORKSPACE_COMMAND, Commands.RESOLVE_SOURCE_ATTACHMENT, JSON.stringify(resolveRequest))
        if (resolveResult.errorMessage) {
          window.showErrorMessage(resolveResult.errorMessage)
          return false
        }

        const attributes: SourceAttachmentAttribute = resolveResult.attributes || {}
        const defaultPath = attributes.sourceAttachmentPath || attributes.jarPath
        const sourcePath = await workspace.nvim.callAsync('coc#util#with_callback', ['input', ['Source File: ', defaultPath ?? '', 'file']]) as string
        if (!sourcePath) return
        if (!sourcePath.endsWith('.jar') && !sourcePath.endsWith('.zip')) {
          window.showWarningMessage(`Source file must be a jar or zip file.`)
          return
        }

        const updateRequest: SourceAttachmentRequest = {
          classFileUri: classFileUri.toString(),
          attributes: {
            ...attributes,
            sourceAttachmentPath: sourcePath
          },
        }
        const updateResult: SourceAttachmentResult = await <SourceAttachmentResult>commands.executeCommand(Commands.EXECUTE_WORKSPACE_COMMAND, Commands.UPDATE_SOURCE_ATTACHMENT, JSON.stringify(updateRequest))
        if (updateResult.errorMessage) {
          window.showErrorMessage(updateResult.errorMessage)
          return false
        }

        // Notify jdt content provider to rerender the classfile contents.
        jdtEventEmitter.fire(classFileUri)
        return true
      }))

      buildPath.registerCommands(context)
      sourceAction.registerCommands(this.languageClient, context)
      refactorAction.registerCommands(this.languageClient, context)
      // pasteAction.registerCommands(this.languageClient, context)

      excludeProjectSettingsFiles()

      context.subscriptions.push(languages.registerCodeActionProvider([{ scheme: 'file', language: 'java' }], new RefactorDocumentProvider(), 'java', RefactorDocumentProvider.metadata.providedCodeActionKinds.slice()))
      context.subscriptions.push(commands.registerCommand(Commands.LEARN_MORE_ABOUT_REFACTORING, async (kind: CodeActionKind) => {
        const sectionId: string = javaRefactorKinds.get(kind) || ''
        markdownPreviewProvider.show(context.asAbsolutePath(path.join('document', `${Commands.LEARN_MORE_ABOUT_REFACTORING}.md`)), 'Java Refactoring', sectionId, context)
      }))

      context.subscriptions.push(commands.registerCommand(Commands.CREATE_MODULE_INFO_COMMAND, async () => {
        let doc = window.activeTextEditor?.document
        const uri = await askForProjects(
          doc ? Uri.parse(doc.uri) : undefined,
          "Please select the project to create module-info.java",
          false,
        )
        if (!uri?.length) {
          return
        }

        const moduleInfoUri: string = await commands.executeCommand(
          Commands.EXECUTE_WORKSPACE_COMMAND,
          Commands.CREATE_MODULE_INFO,
          uri[0].toString(),
        )

        if (moduleInfoUri) {
          await workspace.jumpTo(moduleInfoUri)
        }
      }))

      context.subscriptions.push(commands.registerCommand(Commands.UPGRADE_GRADLE_WRAPPER, (projectUri: string, version?: string) => {
        upgradeGradle(projectUri, version)
      }))

      languages.registerCodeActionProvider([{
        language: "xml",
        scheme: "file",
        pattern: "**/pom.xml"
      }], new PomCodeActionProvider(context), 'java', pomCodeActionMetadata.providedCodeActionKinds.slice())

      languages.registerCodeActionProvider([{
        scheme: "file",
        pattern: "**/{gradle/wrapper/gradle-wrapper.properties,build.gradle,build.gradle.kts,settings.gradle,settings.gradle.kts}"
      }], new GradleCodeActionProvider(), 'java', gradleCodeActionMetadata.providedCodeActionKinds.slice())

      if (languages.registerInlayHintsProvider) {
        context.subscriptions.push(languages.registerInlayHintsProvider(JAVA_SELECTOR, new JavaInlayHintsProvider(this.languageClient)))
      }

      // registerPasteEventHandler(context, this.languageClient)
    })
  }

  public start(): void {
    if (this.languageClient && this.status === ClientStatus.initialized) {
      this.languageClient.start()
      this.status = ClientStatus.starting
    }
  }

  public stop(): Promise<void> {
    this.status = ClientStatus.stopping
    if (this.languageClient) {
      try {
        return this.languageClient.stop()
      } finally {
        this.languageClient = null
      }
    }
    return Promise.resolve()
  }

  public getClient(): LanguageClient {
    return this.languageClient
  }

  public getClientStatus(): ClientStatus {
    return this.status
  }
}

async function showImportFinishNotification(context: ExtensionContext) {
  const neverShow: boolean | undefined = context.globalState.get<boolean>("java.neverShowImportFinishNotification")
  if (!neverShow) {
    let choice: string | undefined
    const options = ["Don't show again"]
    if (serverStatus.hasErrors()) {
      options.unshift("Show errors")
      choice = await window.showWarningMessage("Errors occurred during import of Java projects.", ...options)
    } else {
      const projectUris: string[] = await getAllJavaProjects()
      if (projectUris.length === 0) {
        return
      }

      if (extensions.getExtensionById("vscjava.vscode-java-dependency")) {
        options.unshift("View projects")
      }

      choice = await window.showInformationMessage("Projects are imported into workspace.", ...options)
    }

    if (choice === "Don't show again") {
      context.globalState.update("java.neverShowImportFinishNotification", true)
    } else if (choice === "View projects") {
      commands.executeCommand("javaProjectExplorer.focus")
    } else if (choice === "Show errors") {
      workspace.nvim.command('CocList diagnostics', true)
    }
  }
}

async function showCompileBuildDiagnostics() {
  const diagnostics = await diagnosticManager.getDiagnosticList()
  const normalized = Uri.parse(workspace.getWorkspaceFolder(workspace.cwd).uri)

  const workingDirectoryList = diagnostics.filter(item => isParentFolder(normalized.fsPath, item.file))
  const errorDiagnostics = workingDirectoryList.filter(item => isErrorDiagnostic(item.level))
  const filesDiagnostics = errorDiagnostics.filter(item => isFileDiagnostic(item))
  const quickFixList = await workspace.getQuickfixList(filesDiagnostics.map(item => item.location))

  const quickListConfig: any = { title: `[JDTLS] Compile & Build project [${formatDate(new Date())}]`, items: quickFixList }
  await nvim.call('setqflist', [[], " ", quickListConfig])

  let openCommand = await nvim.getVar('coc_quickfix_open_command') as string
  nvim.command(typeof openCommand === 'string' ? openCommand : 'copen', true)
}

function logNotification(message: string) {
  return new Promise(() => {
    createLogger().trace(message)
  })
}

function setIncompleteClasspathSeverity(severity: string) {
  const config = getJavaConfiguration()
  const section = 'errors.incompleteClasspath.severity'
  config.update(section, severity, true).then(
    () => createLogger().info(`${section} globally set to ${severity}`),
    (error) => createLogger().error(error)
  )
}

function setProjectConfigurationUpdate(languageClient: LanguageClient, uri: Uri, status: FeatureStatus) {
  const config = getJavaConfiguration()
  const section = 'configuration.updateBuildConfiguration'

  const st = FeatureStatus[status]
  config.update(section, st).then(
    () => createLogger().info(`${section} set to ${st}`),
    (error) => createLogger().error(error)
  )
  if (status !== FeatureStatus.disabled) {
    projectConfigurationUpdate(languageClient, uri)
  }
}

function setNullAnalysisStatus(status: FeatureStatus) {
  const config = getJavaConfiguration()
  const section = 'compile.nullAnalysis.mode'

  const st = FeatureStatus[status]
  config.update(section, st).then(
    () => createLogger().info(`${section} set to ${st}`),
    (error) => createLogger().error(error)
  )
}

function decodeBase64(text: string): string {
  return Buffer.from(text, 'base64').toString('ascii')
}

function fileStartsWith(dir: string, pdir: string) {
  return dir.toLowerCase().startsWith(pdir.toLowerCase())
}

function normalizeFilePath(filepath: string) {
  return Uri.file(path.resolve(path.normalize(filepath))).fsPath
}

function isErrorDiagnostic(level: number): boolean {
  return level == DiagnosticSeverity.Error
}

function isFileDiagnostic(item: DiagnosticItem): boolean {
  const basename = path.basename(item.file)
  const extension = path.extname(item.file)
  return basename == "pom.xml" || basename === "build.gradle" || extension === ".java"
}

function isParentFolder(folder: string, filepath: string): boolean {
  let pdir = normalizeFilePath(folder)
  let dir = normalizeFilePath(filepath)
  return fileStartsWith(dir, pdir) && dir[pdir.length] == path.sep
}

function formatDate(date: Date): string {
  // Weekday names
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  // Month names
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Extract components
  const dayOfWeek = weekdays[date.getDay()];
  const month = months[date.getMonth()];
  const dayOfMonth = date.getDate();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  const year = date.getFullYear();

  // Format the date string
  return `${dayOfWeek} ${month} ${dayOfMonth} ${hours}:${minutes}:${seconds} ${year}`;
}

export function showNoLocationFound(message: string): void {
  window.showWarningMessage(message)
}

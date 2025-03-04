'use strict'

import * as chokidar from 'chokidar'
import { CancellationToken, CodeActionContext, CodeActionTriggerKind, commands, ConfigurationTarget, Diagnostic, Document, Emitter, events, ExtensionContext, extensions, LanguageClient, LanguageClientOptions, RelativePattern, RevealOutputChannelOn, Uri, window, workspace, WorkspaceConfiguration } from 'coc.nvim'
import { createHash } from 'crypto'
import * as fs from 'fs'
import * as fse from 'fs-extra'
import * as os from 'os'
import * as path from 'path'
import * as semver from 'semver'
import { CodeActionParams, CodeActionRequest, DidChangeConfigurationNotification, ExecuteCommandParams, ExecuteCommandRequest } from 'vscode-languageserver-protocol'
import { apiManager } from './apiManager'
import { ClientErrorHandler } from './clientErrorHandler'
import { Commands } from './commands'
import { ClientStatus, ExtensionAPI } from './extension.api'
import * as fileEventHandler from './fileEventHandler'
import { getSharedIndexCache, HEAP_DUMP_LOCATION, prepareExecutable, removeEquinoxFragmentOnDarwinX64 } from './javaServerStarter'
import { createLogger, initializeLogFile } from './log'
import { cleanupLombokCache } from "./lombokSupport"
import { markdownPreviewProvider } from "./markdownPreviewProvider"
import { OutputInfoCollector } from './outputInfoCollector'
import { collectJavaExtensions, getBundlesToReload } from './plugin'
import { registerClientProviders } from './providerDispatcher'
import { initialize as initializeRecommendation } from './recommendation'
import * as requirements from './requirements'
import { runtimeStatusBarProvider } from './runtimeStatusBarProvider'
import { serverStatusBarProvider } from './serverStatusBarProvider'
import { ACTIVE_BUILD_TOOL_STATE, cleanWorkspaceFileName, getJavaServerMode, onConfigurationChange, ServerMode } from './settings'
import { StandardLanguageClient } from './standardLanguageClient'
import { SyntaxLanguageClient } from './syntaxLanguageClient'
import { addAutoDetectedJdks, convertToGlob, deleteDirectory, ensureExists, getBuildFilePatterns, getExclusionBlob, getInclusionPatternsFromNegatedExclusion, getJavaConfig, getJavaConfiguration, hasBuildToolConflicts, rangeIntersect } from './utils'
import glob = require('glob')

const syntaxClient: SyntaxLanguageClient = new SyntaxLanguageClient()
const standardClient: StandardLanguageClient = new StandardLanguageClient()
const jdtEventEmitter = new Emitter<Uri>()
const extensionName = 'Language Support for Java'

let storagePath: string
let clientLogFile: string

/**
 * Shows a message about the server crashing due to an out of memory issue
 */
async function showOOMMessage(): Promise<void> {
  const CONFIGURE = 'Increase Memory ..'
  const result = await window.showErrorMessage('The Java Language Server encountered an OutOfMemory error. Some language features may not work due to limited memory. ',
    CONFIGURE)
  if (result === CONFIGURE) {
    let jvmArgs: string = getJavaConfiguration().get('jdt.ls.vmargs')
    const results = MAX_HEAP_SIZE_EXTRACTOR.exec(jvmArgs)
    if (results && results[0]) {
      const maxMemArg: string = results[0]
      const maxMemValue: number = Number(results[1])
      const newMaxMemArg: string = maxMemArg.replace(maxMemValue.toString(), (maxMemValue * 2).toString())
      jvmArgs = jvmArgs.replace(maxMemArg, newMaxMemArg)
      await workspace.getConfiguration().update("java.jdt.ls.vmargs", jvmArgs, ConfigurationTarget.Workspace)
    }
  }
}

const HEAP_DUMP_FOLDER_EXTRACTOR = new RegExp(`${HEAP_DUMP_LOCATION}(?:'([^']+)'|"([^"]+)"|([^\\s]+))`)
const MAX_HEAP_SIZE_EXTRACTOR = new RegExp(`-Xmx([0-9]+)[kKmMgG]`)

/**
 * Returns the heap dump folder defined in the user's preferences, or undefined if the user does not set the heap dump folder
 *
 * @returns the heap dump folder defined in the user's preferences, or undefined if the user does not set the heap dump folder
 */
function getHeapDumpFolderFromSettings(): string {
  const jvmArgs: string = getJavaConfiguration().get('jdt.ls.vmargs')
  const results = HEAP_DUMP_FOLDER_EXTRACTOR.exec(jvmArgs)
  if (!results || !results[0]) {
    return undefined
  }
  return results[1] || results[2] || results[3]
}


export async function activate(context: ExtensionContext): Promise<ExtensionAPI> {
  let enabled = getJavaConfiguration().get('enabled', true)
  if (!enabled) return undefined

  context.subscriptions.push(markdownPreviewProvider)
  context.subscriptions.push(commands.registerCommand(Commands.TEMPLATE_VARIABLES, async () => {
    markdownPreviewProvider.show(context.asAbsolutePath(path.join('document', `${Commands.TEMPLATE_VARIABLES}.md`)), 'Predefined Variables', "", context)
  }, null, true))
  context.subscriptions.push(commands.registerCommand(Commands.NOT_COVERED_EXECUTION, async () => {
    markdownPreviewProvider.show(context.asAbsolutePath(path.join('document', `_java.notCoveredExecution.md`)), 'Not Covered Maven Plugin Execution', "", context)
  }))

  storagePath = context.storagePath
  if (!storagePath) {
    storagePath = getTempWorkspace();
  }
  context.subscriptions.push(commands.registerCommand(Commands.MEATDATA_FILES_GENERATION, async () => {
    markdownPreviewProvider.show(context.asAbsolutePath(path.join('document', `_java.metadataFilesGeneration.md`)), 'Metadata Files Generation', "", context)
  }, null, true))
  context.subscriptions.push(commands.registerCommand(Commands.LEARN_MORE_ABOUT_CLEAN_UPS, async () => {
    markdownPreviewProvider.show(context.asAbsolutePath(path.join('document', `${Commands.LEARN_MORE_ABOUT_CLEAN_UPS}.md`)), 'Java Clean Ups', "java-clean-ups", context)
  }))
  clientLogFile = path.join(storagePath, 'client.log')
  initializeLogFile(clientLogFile)

  enableJavadocSymbols()

  initializeRecommendation(context)

  registerOutOfMemoryDetection(storagePath)

  cleanJavaWorkspaceStorage()

  serverStatusBarProvider.initialize(context)

  // https://github.com/redhat-developer/vscode-java/issues/3484
  if (process.platform === 'darwin' && process.arch === 'x64') {
    try {
      if (semver.lt(os.release(), '20.0.0')) {
        removeEquinoxFragmentOnDarwinX64(context);
      }
    } catch (error) {
      // do nothing
    }
  }

  return requirements.resolveRequirements(context).catch(error => {
    // show error
    window.showErrorMessage(error.message, error.label).then((selection) => {
      if (error.label && error.label === selection && error.command) {
        commands.executeCommand(error.command, error.commandParam)
      }
    })
    // rethrow to disrupt the chain.
    throw error
  }).then(async (requirements) => {
    const triggerFiles = await getTriggerFiles()
    return new Promise<ExtensionAPI>(async (resolve) => {
      const id = createHash('md5').update(workspace.root).digest('hex')
      const workspacePath = path.resolve(`${storagePath}/jdt_ws_${id}`)
      const syntaxServerWorkspacePath = path.resolve(`${storagePath}/ss_ws`)

      let serverMode = getJavaServerMode()
      const isWorkspaceTrusted = (workspace as any).isTrusted // TODO: use workspace.isTrusted directly when other clients catch up to adopt 1.56.0
      if (isWorkspaceTrusted !== undefined && !isWorkspaceTrusted) { // keep compatibility for old engines < 1.56.0
        serverMode = ServerMode.lightWeight
      }
      // commands.executeCommand('setContext', 'java:serverMode', serverMode)
      const isDebugModeByClientPort = !!process.env['SYNTAXLS_CLIENT_PORT'] || !!process.env['JDTLS_CLIENT_PORT']
      const requireSyntaxServer = (serverMode !== ServerMode.standard) && (!isDebugModeByClientPort || !!process.env['SYNTAXLS_CLIENT_PORT'])
      let requireStandardServer = (serverMode !== ServerMode.lightWeight) && (!isDebugModeByClientPort || !!process.env['JDTLS_CLIENT_PORT'])

      // Options to control the language client
      const clientOptions: LanguageClientOptions = {
        // Register the server for java
        documentSelector: [
          { scheme: 'file', language: 'java' },
          { scheme: 'jdt', language: 'java' },
          { scheme: 'untitled', language: 'java' }
        ],
        synchronize: {
          configurationSection: ['java'],
        },
        initializationOptions: {
          bundles: collectJavaExtensions(extensions.all),
          workspaceFolders: workspace.workspaceFolders ? workspace.workspaceFolders.map(f => f.uri.toString()) : null,
          settings: {
            java: getJavaConfig(requirements.java_home),
          },
          extendedClientCapabilities: {
            progressReportProvider: getJavaConfiguration().get('progressReports.enabled'),
            classFileContentsSupport: true,
            overrideMethodsPromptSupport: true,
            hashCodeEqualsPromptSupport: true,
            advancedOrganizeImportsSupport: true,
            generateToStringPromptSupport: true,
            advancedGenerateAccessorsSupport: true,
            generateConstructorsPromptSupport: true,
            generateDelegateMethodsPromptSupport: true,
            advancedExtractRefactoringSupport: true,
            inferSelectionSupport: ["extractMethod", "extractVariable", "extractField"],
            moveRefactoringSupport: true,
            clientHoverProvider: true,
            clientDocumentSymbolProvider: true,
            gradleChecksumWrapperPromptSupport: true,
            advancedIntroduceParameterRefactoringSupport: true,
            actionableRuntimeNotificationSupport: true,
            shouldLanguageServerExitOnShutdown: true,
            onCompletionItemSelectedCommand: "editor.action.triggerParameterHints",
            extractInterfaceSupport: true,
            advancedUpgradeGradleSupport: true,
            executeClientCommandSupport: true,
          },
          triggerFiles,
        },
        middleware: {
          workspace: {
            didChangeConfiguration: () => {
              return standardClient.getClient().sendNotification(DidChangeConfigurationNotification.type.method, {
                settings: {
                  java: getJavaConfig(requirements.java_home),
                }
              })
            }
          },
          provideSelectionRanges: (document, positions, token, next) => {
            if (events.insertMode) return undefined
            return next(document, positions, token)
          },
          // https://github.com/redhat-developer/vscode-java/issues/2130
          // include all diagnostics for the current line in the CodeActionContext params for the performance reason
          provideCodeActions: (document, range, context, token, _) => {
            const client: LanguageClient = standardClient.getClient()
            const params: CodeActionParams = {
              textDocument: { uri: document.uri },
              range,
              context
            }
            const showAt = getJavaConfiguration().get<string>("quickfix.showAt")
            if (showAt === 'line' && range.start.line === range.end.line && range.start.character === range.end.character) {
              const textLine = document.lineAt(params.range.start.line)
              if (textLine !== null) {
                const diagnostics = client.diagnostics.get(document.uri)
                const allDiagnostics: Diagnostic[] = []
                for (const diagnostic of diagnostics) {
                  if (rangeIntersect(textLine.range, diagnostic.range)) {
                    const newLen = allDiagnostics.push(diagnostic)
                    if (newLen > 1000) {
                      break
                    }
                  }
                }
                const codeActionContext: CodeActionContext = {
                  diagnostics: allDiagnostics,
                  only: context.only,
                  triggerKind: CodeActionTriggerKind.Invoked,
                }
                params.context = codeActionContext
              }
            }
            return client.sendRequest(CodeActionRequest.type.method, params, token).then((values) => {
              if (values === null) return undefined
              return values
            }, (error) => {
              return client.handleFailedRequest(CodeActionRequest.type as any, token, error, [])
            })
          }
        },
        revealOutputChannelOn: RevealOutputChannelOn.Never,
        errorHandler: new ClientErrorHandler(extensionName),
        initializationFailedHandler: error => {
          createLogger().error(`Failed to initialize ${extensionName} due to ${error && error.toString()}`)
          return true
        },
        outputChannel: requireStandardServer ? new OutputInfoCollector('java') : undefined,
        outputChannelName: 'java'
      }

      const detectJdksAtStart: boolean = getJavaConfiguration().get<boolean>('configuration.detectJdks')
      if (detectJdksAtStart) {
        const javaConfig = clientOptions.initializationOptions.settings.java
        const userRuntimes = javaConfig.configuration.runtimes
        javaConfig.configuration.runtimes = await addAutoDetectedJdks(userRuntimes)
        createLogger().info(`Server configured with the following runtimes: ${JSON.stringify(javaConfig.configuration.runtimes, null, 2)}`)
      }

      apiManager.initialize(requirements, serverMode)
      resolve(apiManager.getApiInstance())
      // the promise is resolved
      // no need to pass `resolve` into any code past this point,
      // since `resolve` is a no-op from now on

      if (requireSyntaxServer) {
        if (process.env['SYNTAXLS_CLIENT_PORT']) {
          syntaxClient.initialize(requirements, clientOptions)
        } else {
          syntaxClient.initialize(requirements, clientOptions, prepareExecutable(requirements, syntaxServerWorkspacePath, getJavaConfig(requirements.java_home), context, true))
        }
        syntaxClient.start()
        serverStatusBarProvider.showLightWeightStatus()
      }

      context.subscriptions.push(commands.registerCommand(Commands.EXECUTE_WORKSPACE_COMMAND, (command, ...rest) => {
        const api: ExtensionAPI = apiManager.getApiInstance()
        if (api.serverMode === ServerMode.lightWeight) {
          window.showWarningMessage(`The command: ${command} is not supported in LightWeight mode. See: https://github.com/redhat-developer/vscode-java/issues/1480`)
          return
        }
        let token: CancellationToken
        let commandArgs: any[] = rest
        if (rest && rest.length && CancellationToken.is(rest[rest.length - 1])) {
          token = rest[rest.length - 1]
          commandArgs = rest.slice(0, rest.length - 1)
        }
        const params: ExecuteCommandParams = {
          command,
          arguments: commandArgs
        }
        if (token) {
          return standardClient.getClient().sendRequest(ExecuteCommandRequest.type as any, params, token)
        } else {
          return standardClient.getClient().sendRequest(ExecuteCommandRequest.type as any, params)
        }
      }, null, true))

      const cleanWorkspaceExists = fs.existsSync(path.join(workspacePath, cleanWorkspaceFileName))
      if (cleanWorkspaceExists) {
        try {
          cleanupLombokCache(context)
          deleteDirectory(workspacePath)
          deleteDirectory(syntaxServerWorkspacePath)
        } catch (error) {
          window.showErrorMessage(`Failed to delete ${workspacePath}: ${error}`)
        }
      }

      // Register commands here to make it available even when the language client fails
      context.subscriptions.push(commands.registerCommand(Commands.OPEN_SERVER_LOG, () => openServerLogFile(workspacePath)))
      context.subscriptions.push(commands.registerCommand(Commands.OPEN_SERVER_STDOUT_LOG, () => openRollingServerLogFile(workspacePath, '.out-jdt.ls')))
      context.subscriptions.push(commands.registerCommand(Commands.OPEN_SERVER_STDERR_LOG, () => openRollingServerLogFile(workspacePath, '.error-jdt.ls',)))

      context.subscriptions.push(commands.registerCommand(Commands.OPEN_CLIENT_LOG, () => openClientLogFile(clientLogFile)))

      context.subscriptions.push(commands.registerCommand(Commands.OPEN_LOGS, () => openLogs()))

      context.subscriptions.push(commands.registerCommand(Commands.OPEN_FORMATTER, async () => openFormatter(context.extensionPath)))
      context.subscriptions.push(commands.registerCommand(Commands.OPEN_FILE, async (uri: string) => {
        const parsedUri = Uri.parse(uri)
        await workspace.jumpTo(parsedUri)
      }, null, true))

      context.subscriptions.push(commands.registerCommand(Commands.CLEAN_WORKSPACE, (force?: boolean) => cleanWorkspace(workspacePath, force)))
      context.subscriptions.push(commands.registerCommand(Commands.CLEAN_SHARED_INDEXES, () => cleanSharedIndexes(context)))

      context.subscriptions.push(commands.registerCommand(Commands.GET_WORKSPACE_PATH, () => workspacePath))

      context.subscriptions.push(commands.registerCommand(Commands.REFRESH_BUNDLES_COMMAND, () => {
        return getBundlesToReload()
      }))

      context.subscriptions.push(onConfigurationChange(workspacePath, context))

      /**
       * Command to switch the server mode. Currently it only supports switch from lightweight to standard.
       * @param force force to switch server mode without asking
       */
      commands.registerCommand(Commands.SWITCH_SERVER_MODE, async (switchTo: ServerMode, force: boolean = false) => {
        const isWorkspaceTrusted = (workspace as any).isTrusted
        if (isWorkspaceTrusted !== undefined && !isWorkspaceTrusted) { // keep compatibility for old engines < 1.56.0
          const button = "Manage Workspace Trust"
          const choice = await window.showInformationMessage("For security concern, Java language server cannot be switched to Standard mode in untrusted workspaces.", button)
          if (choice === button) {
            commands.executeCommand("workbench.trust.manage")
          }
          return
        }

        const clientStatus: ClientStatus = standardClient.getClientStatus()
        if (clientStatus === ClientStatus.starting || clientStatus === ClientStatus.started) {
          return
        }

        const api: ExtensionAPI = apiManager.getApiInstance()
        if (api.serverMode === switchTo || api.serverMode === ServerMode.standard) {
          return
        }

        let choice: string
        if (force) {
          choice = "Yes"
        } else {
          choice = await window.showInformationMessage("Are you sure you want to switch the Java language server to Standard mode?", "Yes", "No")
        }

        if (choice === "Yes") {
          await startStandardServer(context, requirements, clientOptions, workspacePath)
        }
      }, null, true)

      context.subscriptions.push(serverStatusBarProvider)
      context.subscriptions.push(runtimeStatusBarProvider)

      registerClientProviders(context, { contentProviderEvent: jdtEventEmitter.event })

      apiManager.getApiInstance().onDidServerModeChange((event: ServerMode) => {
        if (event === ServerMode.standard) {
          syntaxClient.stop()
          fileEventHandler.setServerStatus(true)
          runtimeStatusBarProvider.initialize(context)
        }
        // commands.executeCommand('setContext', 'java:serverMode', event)
      })

      if (serverMode === ServerMode.hybrid && !await fse.pathExists(path.join(workspacePath, ".metadata", ".plugins"))) {
        const config = getJavaConfiguration()
        const importOnStartupSection: string = "project.importOnFirstTimeStartup"
        const importOnStartup = config.get(importOnStartupSection)
        if (importOnStartup === "disabled") {
          // syntaxClient.resolveApi(resolve)
          requireStandardServer = false
        } else if (importOnStartup === "interactive" && await workspaceContainsBuildFiles()) {
          // syntaxClient.resolveApi(resolve)
          requireStandardServer = await promptUserForStandardServer(config)
        } else {
          requireStandardServer = true
        }
      }

      if (requireStandardServer) {
        await startStandardServer(context, requirements, clientOptions, workspacePath)
      }
      // context.subscriptions.push(workspace.onDidChangeTextDocument(event => handleTextBlockClosing(event.document, event.contentChanges)))
    })
  })
}

async function startStandardServer(context: ExtensionContext, requirements: requirements.RequirementsData, clientOptions: LanguageClientOptions, workspacePath: string) {
  if (standardClient.getClientStatus() !== ClientStatus.uninitialized) {
    return
  }

  const checkConflicts: boolean = await ensureNoBuildToolConflicts(context, clientOptions)
  if (!checkConflicts) {
    return
  }

  if (apiManager.getApiInstance().serverMode === ServerMode.lightWeight) {
    // Before standard server is ready, we are in hybrid.
    apiManager.getApiInstance().serverMode = ServerMode.hybrid
    apiManager.fireDidServerModeChange(ServerMode.hybrid)
  }
  await standardClient.initialize(context, requirements, clientOptions, workspacePath, jdtEventEmitter)
  standardClient.start()
  serverStatusBarProvider.showStandardStatus()
}

async function workspaceContainsBuildFiles(): Promise<boolean> {
  // Since the VS Code API does not support put negated exclusion pattern in findFiles(), we need to first parse the
  // negated exclusion to inclusion and do the search. (If negated exclusion pattern is set by user)
  const inclusionPatterns: string[] = getBuildFilePatterns()
  const inclusionPatternsFromNegatedExclusion: string[] = getInclusionPatternsFromNegatedExclusion()
  if (inclusionPatterns.length > 0 && inclusionPatternsFromNegatedExclusion.length > 0 &&
    (await workspace.findFiles(convertToGlob(inclusionPatterns, inclusionPatternsFromNegatedExclusion), null, 1 /* maxResults */)).length > 0) {
    return true
  }

  // Nothing found in negated exclusion pattern, do a normal search then.
  const inclusionBlob: string = convertToGlob(inclusionPatterns)
  const exclusionBlob: string = getExclusionBlob()
  if (inclusionBlob && (await workspace.findFiles(inclusionBlob, exclusionBlob, 1 /* maxResults */)).length > 0) {
    return true
  }

  return false
}

async function ensureNoBuildToolConflicts(context: ExtensionContext, clientOptions: LanguageClientOptions): Promise<boolean> {
  const isMavenEnabled: boolean = getJavaConfiguration().get<boolean>("import.maven.enabled")
  const isGradleEnabled: boolean = getJavaConfiguration().get<boolean>("import.gradle.enabled")
  if (isMavenEnabled && isGradleEnabled) {
    let activeBuildTool: string | undefined = context.workspaceState.get(ACTIVE_BUILD_TOOL_STATE)
    if (!activeBuildTool) {
      if (!await hasBuildToolConflicts()) {
        return true
      }
      activeBuildTool = await window.showInformationMessage("Build tool conflicts are detected in workspace. Which one would you like to use?", "Use Maven", "Use Gradle")
    }

    if (!activeBuildTool) {
      return false // user cancels
    } else if (activeBuildTool.toLocaleLowerCase().includes("maven")) {
      // Here we do not persist it in the settings to avoid generating/updating files in user's workspace
      // Later if user want to change the active build tool, just directly set the related settings.
      clientOptions.initializationOptions.settings.java.import.gradle.enabled = false
      context.workspaceState.update(ACTIVE_BUILD_TOOL_STATE, "maven")
    } else if (activeBuildTool.toLocaleLowerCase().includes("gradle")) {
      clientOptions.initializationOptions.settings.java.import.maven.enabled = false
      context.workspaceState.update(ACTIVE_BUILD_TOOL_STATE, "gradle")
    } else {
      throw new Error(`Unknown build tool: ${activeBuildTool}`) // unreachable
    }
  }

  return true
}

async function promptUserForStandardServer(config: WorkspaceConfiguration): Promise<boolean> {
  const choice: string = await window.showInformationMessage("The workspace contains Java projects. Would you like to import them?", "Yes", "Always", "Later")
  switch (choice) {
    case "Always":
      await config.update("project.importOnFirstTimeStartup", "automatic", ConfigurationTarget.Global)
      return true
    case "Yes":
      return true
    case "Later":
    default:
      const importHintSection: string = "project.importHint"
      const dontShowAgain: string = "Don't Show Again"
      const showHint: boolean = config.get(importHintSection)
      if (showHint && standardClient.getClientStatus() === ClientStatus.uninitialized) {
        const showRocketEmoji: boolean = process.platform === "win32" || process.platform === "darwin"
        const message: string = `Java Language Server is running in LightWeight mode. Click the ${showRocketEmoji ? '🚀' : 'Rocket'} icon in the status bar if you want to import the projects later.`
        window.showInformationMessage(message, dontShowAgain)
          .then(selection => {
            if (selection && selection === dontShowAgain) {
              config.update(importHintSection, false, ConfigurationTarget.Global)
            }
          })
      }
      return false
  }
}

export function deactivate(): Promise<void[]> {
  return Promise.all<void>([
    standardClient.stop(),
    syntaxClient.stop(),
  ])
}

export async function getActiveLanguageClient(): Promise<LanguageClient | undefined> {
  let languageClient: LanguageClient

  const api: ExtensionAPI = apiManager.getApiInstance()
  if (api.serverMode === ServerMode.standard) {
    languageClient = standardClient.getClient()
  } else {
    languageClient = syntaxClient.getClient()
  }

  if (!languageClient) {
    return undefined
  }

  await languageClient.onReady()

  return languageClient
}

function enableJavadocSymbols() {
  // Let's enable Javadoc symbols autocompletion, shamelessly copied from MIT licensed code at
  // https://github.com/Microsoft/vscode/blob/9d611d4dfd5a4a101b5201b8c9e21af97f06e7a7/extensions/typescript/src/typescriptMain.ts#L186
  // languages.setLanguageConfiguration('java', {
  //   indentationRules: {
  //     // ^(.*\*/)?\s*\}.*$
  //     decreaseIndentPattern: /^(.*\*\/)?\s*\}.*$/,
  //     // ^.*\{[^}"']*$
  //     increaseIndentPattern: /^.*\{[^}"']*$/
  //   },
  //   wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
  //   onEnterRules: [
  //     {
  //       // e.g. /** | */ or /* | */
  //       beforeText: /^\s*\/\*\*?(?!\/)([^\*]|\*(?!\/))*$/,
  //       afterText: /^\s*\*\/$/,
  //       action: {indentAction: IndentAction.IndentOutdent, appendText: ' * '}
  //     },
  //     {
  //       // e.g. /** ...|
  //       beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
  //       action: {indentAction: IndentAction.None, appendText: ' * '}
  //     },
  //     {
  //       // e.g.  * ...|
  //       beforeText: /^(\t|(\ \ ))*\ \*(\ ([^\*]|\*(?!\/))*)?$/,
  //       action: {indentAction: IndentAction.None, appendText: '* '}
  //     },
  //     {
  //       // e.g.  */|
  //       beforeText: /^(\t|(\ \ ))*\ \*\/\s*$/,
  //       action: {indentAction: IndentAction.None, removeText: 1}
  //     },
  //     {
  //       // e.g.  *-----*/|
  //       beforeText: /^(\t|(\ \ ))*\ \*[^/]*\*\/\s*$/,
  //       action: {indentAction: IndentAction.None, removeText: 1}
  //     },
  //     {
  //       // e.g. /// ...| (Markdown javadoc)
  //       beforeText: /^\s*\/\/\/(.*)?$/,
  //       action: {indentAction: IndentAction.None, appendText: '/// '}
  //     }
  //   ]
  // });
}

function getTempWorkspace() {
  return path.resolve(os.tmpdir(), `vscodesws_${makeRandomHexString(5)}`)
}

function makeRandomHexString(length: number) {
  const chars = ['0', '1', '2', '3', '4', '5', '6', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f']
  let result = ''
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(chars.length * Math.random())
    result += chars[idx]
  }
  return result
}

async function cleanWorkspace(workspacePath: string, force?: boolean) {
  if (!force) {
    const doIt = 'Reload and delete'
    const selection = await window.showWarningMessage('Are you sure you want to clean the Java language server workspace?', 'Cancel', doIt)
    if (selection !== doIt) {
      return
    }
  }
  ensureExists(workspacePath)
  const file = path.join(workspacePath, cleanWorkspaceFileName)
  fs.closeSync(fs.openSync(file, 'w'))
  commands.executeCommand(Commands.RELOAD_WINDOW)
}

async function cleanSharedIndexes(context: ExtensionContext) {
  const sharedIndexLocation: string = getSharedIndexCache(context)
  if (sharedIndexLocation && fs.existsSync(sharedIndexLocation)) {
    const doIt = 'Clean and Reload'
    const ans = await window.showWarningMessage('The shared indexes might be in use by other workspaces, do you want to clear it? New indexes will be built after reloading.',
      doIt, "Cancel")
    if (ans === doIt) {
      deleteDirectory(sharedIndexLocation)
      commands.executeCommand(Commands.RELOAD_WINDOW)
    }
  }
}

function openServerLogFile(workspacePath: string): Thenable<boolean> {
  const serverLogFile = path.join(workspacePath, '.metadata', '.log')
  return openLogFile(serverLogFile, 'Could not open Java Language Server log file')
}

function openRollingServerLogFile(workspacePath: string, filename: string): Thenable<boolean> {
  return new Promise((resolve) => {
    const dirname = path.join(workspacePath, '.metadata')

    // find out the newest one
    glob(`${filename}-*`, { cwd: dirname }, (err: any, files: string[]) => {
      if (!err && files.length > 0) {
        files.sort()

        const logFile = path.join(dirname, files[files.length - 1])
        openLogFile(logFile, `Could not open Java Language Server log file ${filename}`).then((result) => resolve(result))
      } else {
        resolve(false)
      }
    })
  })
}

function openClientLogFile(logFile: string): Thenable<boolean> {
  return new Promise((resolve) => {
    const filename = path.basename(logFile)
    const dirname = path.dirname(logFile)

    // find out the newest one
    glob(`${filename}.*`, { cwd: dirname }, (err: any, files: string[]) => {
      if (!err && files.length > 0) {
        files.sort((a, b) => {
          const dateA = a.slice(11, 21), dateB = b.slice(11, 21)
          if (dateA === dateB) {
            if (a.length > 22 && b.length > 22) {
              const extA = a.slice(22), extB = b.slice(22)
              return parseInt(extA) - parseInt(extB)
            } else {
              return a.length - b.length
            }
          } else {
            return dateA < dateB ? -1 : 1
          }
        })
        logFile = path.join(dirname, files[files.length - 1])
      }

      openLogFile(logFile, 'Could not open Java extension log file').then((result) => resolve(result))
    })
  })
}

async function openLogs() {
  await commands.executeCommand(Commands.OPEN_CLIENT_LOG)
  await commands.executeCommand(Commands.OPEN_SERVER_LOG)
  await commands.executeCommand(Commands.OPEN_SERVER_STDOUT_LOG)
  await commands.executeCommand(Commands.OPEN_SERVER_STDERR_LOG)
}

function openLogFile(logFile: string, openingFailureWarning: string): Thenable<boolean> {
  if (!fs.existsSync(logFile)) {
    return window.showWarningMessage('No log file available').then(() => false)
  }

  return workspace.openTextDocument(logFile)
    .then(doc => {
      if (!doc) {
        return false
      }
      return workspace.jumpTo(doc.uri)
        .then(() => true)
    }, () => false)
    .then(didOpen => {
      if (!didOpen) {
        window.showWarningMessage(openingFailureWarning)
      }
      return didOpen
    })
}

async function openFormatter(extensionPath: string) {
  const defaultFormatter = path.join(extensionPath, 'formatters', 'eclipse-formatter.xml')
  const formatterUrl: string = getJavaConfiguration().get('format.settings.url')
  if (formatterUrl && formatterUrl.length > 0) {
    if (isRemote(formatterUrl)) {
      return commands.executeCommand(Commands.OPEN_BROWSER, Uri.parse(formatterUrl))
    } else {
      const document = getPath(formatterUrl)
      if (document && fs.existsSync(document)) {
        return openDocument(extensionPath, document, defaultFormatter, null)
      }
    }
  }
  const global = workspace.workspaceFolders === undefined
  const fileName = formatterUrl || 'eclipse-formatter.xml'
  let file: string
  let relativePath: string
  if (!global) {
    const workspacePath = Uri.parse(workspace.workspaceFolders[0].uri).fsPath
    file = path.join(workspacePath, fileName)
    relativePath = fileName
  } else {
    const root = path.join(extensionPath, '..', 'redhat.java')
    ensureExists(root)
    file = path.join(root, fileName)
  }
  if (!fs.existsSync(file)) {
    addFormatter(extensionPath, file, defaultFormatter, relativePath)
  } else {
    if (formatterUrl) {
      getJavaConfiguration().update('format.settings.url', (relativePath !== null ? relativePath : file), global)
      openDocument(extensionPath, file, file, defaultFormatter)
    } else {
      addFormatter(extensionPath, file, defaultFormatter, relativePath)
    }
  }
}

function getPath(f: string) {
  if (workspace.workspaceFolders && !path.isAbsolute(f)) {
    workspace.workspaceFolders.forEach(wf => {
      const fsPath = Uri.parse(wf.uri).fsPath
      const file = path.resolve(fsPath, f)
      if (fs.existsSync(file)) {
        return file
      }
    })
  } else {
    return path.resolve(f)
  }
  return null
}

function openDocument(extensionPath: string, formatterUrl: string, defaultFormatter: string, relativePath: string) {
  return workspace.openTextDocument(formatterUrl)
    .then(doc => {
      if (!doc) {
        addFormatter(extensionPath, formatterUrl, defaultFormatter, relativePath)
      }
      return workspace.jumpTo(doc.uri).then(() => {
        return true
      })
    }, () => false)
    .then(didOpen => {
      if (!didOpen) {
        window.showWarningMessage('Could not open Formatter Settings file')
        addFormatter(extensionPath, formatterUrl, defaultFormatter, relativePath)
      } else {
        return didOpen
      }
    })
}

function isRemote(f: string) {
  return f !== null && f.startsWith('http:/') || f.startsWith('https:/') || f.startsWith('file:/')
}

async function addFormatter(extensionPath: string, formatterUrl: string, defaultFormatter: string, relativePath: string) {
  await window.requestInput('please enter URL or Path:', relativePath ? relativePath : formatterUrl, { position: 'center' }).then(f => {
    if (f) {
      const global = workspace.workspaceFolders === undefined
      if (isRemote(f)) {
        commands.executeCommand(Commands.OPEN_BROWSER, Uri.parse(f))
        getJavaConfiguration().update('format.settings.url', f, global)
      } else {
        if (!path.isAbsolute(f)) {
          const fileName = f
          if (!global) {
            let fsPath = Uri.parse(workspace.workspaceFolders[0].uri).fsPath
            f = path.join(fsPath, fileName)
            relativePath = fileName
          } else {
            const root = path.join(extensionPath, '..', 'redhat.java')
            ensureExists(root)
            f = path.join(root, fileName)
          }
        } else {
          relativePath = null
        }
        getJavaConfiguration().update('format.settings.url', (relativePath !== null ? relativePath : f), global)
        if (!fs.existsSync(f)) {
          const name = relativePath !== null ? relativePath : f
          const msg = `' ${name} ' does not exist. Do you want to create it?`
          const action = 'Yes'
          window.showWarningMessage(msg, action, 'No').then((selection) => {
            if (action === selection) {
              try {
                ensureExists(path.dirname(f))
                fs.createReadStream(defaultFormatter)
                  .pipe(fs.createWriteStream(f))
                  .on('finish', () => openDocument(extensionPath, f, defaultFormatter, relativePath))
              } catch (error) {
                window.showErrorMessage(`Failed to create ${f}: ${error}`)
              }
            }
          })
        } else {
          openDocument(extensionPath, f, defaultFormatter, relativePath)
        }
      }
    }
  })
}

async function getTriggerFiles(): Promise<string[]> {
  const openedJavaFiles = []
  const activeJavaFile = getJavaFilePathOfTextDocument(window.activeTextEditor && window.activeTextEditor.document)
  if (activeJavaFile) {
    openedJavaFiles.push(Uri.file(activeJavaFile).toString())
  }

  if (!workspace.workspaceFolders) {
    return openedJavaFiles
  }

  await Promise.all(workspace.workspaceFolders.map(async (rootFolder) => {
    const uri = Uri.parse(rootFolder.uri)
    if (uri.scheme !== 'file') {
      return
    }

    const rootPath = path.normalize(uri.fsPath)
    if (isPrefix(rootPath, activeJavaFile)) {
      return
    }

    for (const textEditor of window.visibleTextEditors) {
      const javaFileInTextEditor = getJavaFilePathOfTextDocument(textEditor.document)
      if (isPrefix(rootPath, javaFileInTextEditor)) {
        openedJavaFiles.push(Uri.file(javaFileInTextEditor).toString())
        return
      }
    }

    for (const textDocument of workspace.documents) {
      const javaFileInTextDocument = getJavaFilePathOfTextDocument(textDocument)
      if (isPrefix(rootPath, javaFileInTextDocument)) {
        openedJavaFiles.push(Uri.file(javaFileInTextDocument).toString())
        return
      }
    }

    const javaFilesUnderRoot: Uri[] = await workspace.findFiles(new RelativePattern(rootFolder, "*.java"), undefined, 1)
    for (const javaFile of javaFilesUnderRoot) {
      if (isPrefix(rootPath, javaFile.fsPath)) {
        openedJavaFiles.push(javaFile.toString())
        return
      }
    }

    const javaFilesInCommonPlaces: Uri[] = await workspace.findFiles(new RelativePattern(rootFolder, "{src, test}/**/*.java"), undefined, 1)
    for (const javaFile of javaFilesInCommonPlaces) {
      if (isPrefix(rootPath, javaFile.fsPath)) {
        openedJavaFiles.push(javaFile.toString())
        return
      }
    }
  }))

  return openedJavaFiles
}

function getJavaFilePathOfTextDocument(document: Document | undefined): string | undefined {
  if (document) {
    const resource = Uri.parse(document.uri)
    if (resource.scheme === 'file' && resource.fsPath.endsWith('.java')) {
      return path.normalize(resource.fsPath)
    }
  }

  return undefined
}

function isPrefix(parentPath: string, childPath: string): boolean {
  if (!childPath) {
    return false
  }
  const relative = path.relative(parentPath, childPath)
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative)
}

async function cleanJavaWorkspaceStorage() {
  const configCacheLimit = getJavaConfiguration().get<number>("configuration.workspaceCacheLimit")

  // Also leave temporary workspaces alone as they should have their own policy
  if (!storagePath || !configCacheLimit || storagePath.includes('vscodesws')) {
    return
  }

  const limit: number = configCacheLimit * 86400000 // days to ms
  const currTime = new Date().valueOf() // ms since Epoch
  // storage path is Code/User/workspaceStorage/${id}/redhat.java/
  const wsRoot = storagePath

  // find all folders of the form "redhat.java/jdt_ws/" and delete "redhat.java/"
  if (fs.existsSync(wsRoot)) {
    new glob.Glob(`${wsRoot}/**/jdt_ws`, (_err: any, matches: string[]) => {
      for (const javaWSCache of matches) {
        const entry = path.dirname(javaWSCache)
        const entryModTime = fs.statSync(entry).mtimeMs
        if ((currTime - entryModTime) > limit) {
          createLogger().info(`Removing workspace storage folder : ${entry}`)
          deleteDirectory(entry)
        }
      }
    })
  }
}

function registerOutOfMemoryDetection(storagePath: string) {
  const heapDumpFolder = getHeapDumpFolderFromSettings() || storagePath
  chokidar.watch(`${heapDumpFolder}/java_*.hprof`, { ignoreInitial: true }).on('add', path => {
    // Only clean heap dumps that are generated in the default location.
    // The default location is the extension global storage
    // This means that if users change the folder where the heap dumps are placed,
    // then they will be able to read the heap dumps,
    // since they aren't immediately deleted.
    if (heapDumpFolder === storagePath) {
      fse.remove(path)
    }
    showOOMMessage()
  })
}

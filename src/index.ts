import { commands, CompletionContext, ExtensionContext, LanguageClient, LanguageClientOptions, ProvideCompletionItemsSignature, ProviderResult, RevealOutputChannelOn, services, StreamInfo, TextDocumentContentProvider, workspace, WorkspaceConfiguration } from 'coc.nvim'
import * as fs from 'fs'
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import { CancellationToken, CompletionItem, CompletionItemKind, CompletionList, Disposable, ExecuteCommandParams, ExecuteCommandRequest, Location, Position, TextDocument, WorkspaceEdit } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import { Commands } from './commands'
import { ExtensionAPI } from './extension.api'
import { awaitServerConnection, prepareExecutable } from './javaServerStarter'
import { collectionJavaExtensions } from './plugin'
import { ActionableNotification, ClassFileContentsRequest, CompileWorkspaceRequest, CompileWorkspaceStatus, ExecuteClientCommandRequest, FeatureStatus, MessageType, ProgressReportNotification, ProjectConfigurationUpdateRequest, SendNotificationRequest, StatusNotification } from './protocol'
import { RequirementsData, resolveRequirements } from './requirements'
import { fixComment } from './fixes'

let oldConfig
let languageClient: LanguageClient
const cleanWorkspaceFileName = '.cleanWorkspace'

export async function activate(context: ExtensionContext): Promise<void> {
  let requirements: RequirementsData
  try {
    requirements = await resolveRequirements()
  } catch (e) {
    let res = await workspace.showQuickpick(['Yes', 'No'], `${e.message}, ${e.label}?`)
    if (res == 0) {
      commands.executeCommand(Commands.OPEN_BROWSER, e.openUrl)
    }
    return
  }

  let progressItem = workspace.createStatusBarItem(9, { progress: true })
  progressItem.text = 'jdt starting'
  progressItem.show()

  let storagePath = getTempWorkspace()
  let workspacePath = path.resolve(storagePath + '/jdt_ws')

  // Options to control the language client
  let clientOptions: LanguageClientOptions = {
    // Register the server for java
    documentSelector: [
      { scheme: 'file', language: 'java' },
      { scheme: 'jdt', language: 'java' },
      { scheme: 'untitled', language: 'java' }
    ],
    synchronize: {
      configurationSection: 'java',
      // Notify the server about file changes to .java and project/build files contained in the workspace
      fileEvents: [
        workspace.createFileSystemWatcher('**/*.java'),
        workspace.createFileSystemWatcher('**/pom.xml'),
        workspace.createFileSystemWatcher('**/*.gradle'),
        workspace.createFileSystemWatcher('**/.project'),
        workspace.createFileSystemWatcher('**/.classpath'),
        workspace.createFileSystemWatcher('**/settings/*.prefs'),
        workspace.createFileSystemWatcher('**/src/**')
      ],
    },
    initializationOptions: {
      bundles: collectionJavaExtensions(),
      workspaceFolders: null,
      settings: { java: getJavaConfiguration() },
      extendedClientCapabilities: {
        progressReportProvider: getJavaConfiguration().get<boolean>('progressReports.enabled'),
        classFileContentsSupport: true
      }
    },
    revealOutputChannelOn: RevealOutputChannelOn.Never,
    middleware: {
      provideCompletionItem: (
        document: TextDocument,
        position: Position,
        context: CompletionContext,
        token: CancellationToken,
        next: ProvideCompletionItemsSignature
      ): ProviderResult<CompletionItem[] | CompletionList> => {
        return Promise.resolve(next(document, position, context, token)).then((res: CompletionItem[] | CompletionList) => {
          let doc = workspace.getDocument(document.uri)
          if (!doc) return []
          let items: CompletionItem[] = res.hasOwnProperty('isIncomplete') ? (res as CompletionList).items : res as CompletionItem[]
          let result: any = {
            isIncomplete: false,
            items
          }
          let isModule = items.length > 0 && items.every(o => o.kind == CompletionItemKind.Module)
          if (isModule) {
            result.startcol = doc.fixStartcol(position, ['.'])
          }
          return result
        })
      }
    }
  }
  oldConfig = getJavaConfiguration()
  let serverOptions
  let port = process.env['SERVER_PORT']
  if (!port) {
    let lsPort = process.env['JDTLS_CLIENT_PORT']
    if (!lsPort) {
      serverOptions = prepareExecutable(requirements, workspacePath, getJavaConfiguration())
    } else {
      serverOptions = () => {
        let socket = net.connect(lsPort)
        let result: StreamInfo = {
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
  languageClient = new LanguageClient('java', 'Language Support for Java', serverOptions, clientOptions)

  languageClient.registerProposedFeatures()
  let started = false
  languageClient.onReady().then(() => {
    languageClient.onNotification(StatusNotification.type, report => {
      switch (report.type) {
        case 'Started':
          started = true
          progressItem.hide()
          let info: ExtensionAPI = {
            apiVersion: '0.1',
            javaRequirement: requirements,
          }
          workspace.showMessage('JDT Language Server started')
          languageClient.info('JDT Language Server started', info)
          context.logger.info(info)
          break
        case 'Error':
          progressItem.hide()
          workspace.showMessage(`JDT Language Server error ${report.message}`, 'error')
          break
        case 'Starting':
          if (!started) {
            progressItem.text = report.message
            progressItem.show()
          }
          break
        case 'Message':
          workspace.showMessage(report.message)
          break
      }
    })
    languageClient.onNotification(ProgressReportNotification.type, progress => {
      progressItem.show()
      progressItem.text = progress.status
      if (progress.complete) {
        setTimeout(() => { progressItem.hide() }, 500)
      }
    })
    languageClient.onNotification(ActionableNotification.type, notification => {
      if (notification.severity == MessageType.Log) {
        logNotification(notification.message)
        return
      }
      const titles = notification.commands.map(a => a.title)
      workspace.showQuickpick(titles, notification.message).then(idx => {
        if (idx == -1) return
        let action = notification.commands[idx]
        let args: any[] = (action.arguments) ? action.arguments : []
        commands.executeCommand(action.command, ...args)
      }, _e => {
        // noop
      })
    })
    languageClient.onRequest(ExecuteClientCommandRequest.type, params => {
      return commands.executeCommand(params.command, ...params.arguments)
    })

    languageClient.onRequest(SendNotificationRequest.type, params => {
      return commands.executeCommand(params.command, ...params.arguments)
    })

    commands.registerCommand(Commands.OPEN_OUTPUT, () => {
      languageClient.outputChannel.show()
    })
    commands.registerCommand(Commands.SHOW_JAVA_REFERENCES, (uri: string, position: Position, locations: Location[]) => {
      commands.executeCommand(Commands.SHOW_REFERENCES, Uri.parse(uri), position, locations)
    }, null, true)
    commands.registerCommand(Commands.SHOW_JAVA_IMPLEMENTATIONS, (uri: string, position: Position, locations: Location[]) => {
      commands.executeCommand(Commands.SHOW_REFERENCES, Uri.parse(uri), position, locations)
    }, null, true)

    commands.registerCommand(Commands.CONFIGURATION_UPDATE, uri => projectConfigurationUpdate(languageClient, uri), null, true)

    commands.registerCommand(Commands.IGNORE_INCOMPLETE_CLASSPATH, (_data?: any) => setIncompleteClasspathSeverity('ignore'))

    commands.registerCommand(Commands.IGNORE_INCOMPLETE_CLASSPATH_HELP, (_data?: any) => {
      commands.executeCommand(Commands.OPEN_BROWSER, Uri.parse('https://github.com/redhat-developer/vscode-java/wiki/%22Classpath-is-incomplete%22-warning'))
    })

    commands.registerCommand(Commands.PROJECT_CONFIGURATION_STATUS, (uri, status) => setProjectConfigurationUpdate(languageClient, uri, status), null, true)

    commands.registerCommand(Commands.APPLY_WORKSPACE_EDIT, obj => {
      // tslint:disable-next-line:no-floating-promises
      applyWorkspaceEdit(obj)
    }, null, true)

    commands.registerCommand(Commands.EDIT_ORGANIZE_IMPORTS, async () => {
      let document = await workspace.document
      if (document.filetype !== 'java') {
        return
      }
      commands.executeCommand(Commands.EXECUTE_WORKSPACE_COMMAND, Commands.EDIT_ORGANIZE_IMPORTS, document.uri)
    })

    commands.registerCommand(Commands.EXECUTE_WORKSPACE_COMMAND, (command, ...rest) => {
      const params: ExecuteCommandParams = {
        command,
        arguments: rest
      }
      return languageClient.sendRequest(ExecuteCommandRequest.type, params)
    }, null, true)

    commands.registerCommand(Commands.COMPILE_WORKSPACE, async (isFullCompile: boolean) => {
      if (typeof isFullCompile !== 'boolean') {
        const idx = await workspace.showQuickpick(['Incremental', 'Full'], 'please choose compile type:')
        isFullCompile = idx != 0
      }
      workspace.showMessage('Compiling workspace...')
      const start = new Date().getTime()
      const res = await Promise.resolve(languageClient.sendRequest(CompileWorkspaceRequest.type, isFullCompile))
      const elapsed = ((new Date().getTime() - start) / 1000).toFixed(1)
      if (res === CompileWorkspaceStatus.SUCCEED) {
        workspace.showMessage(`Compile done, used ${elapsed}s.`)
      } else {
        workspace.showMessage('Compile error!', 'error')
      }
    })

    let provider: TextDocumentContentProvider = {
      onDidChange: null,
      provideTextDocumentContent: async (uri: Uri, token: CancellationToken): Promise<string> => {
        let content = await Promise.resolve(languageClient.sendRequest(ClassFileContentsRequest.type, { uri: uri.toString() }, token))
        content = content || ''
        let { nvim } = workspace
        await nvim.command('setfiletype java')
        return content
      }
    }
    workspace.registerTextDocumentContentProvider('jdt', provider)
  }, e => {
    context.logger.error(e.message)
  })

  let cleanWorkspaceExists = fs.existsSync(path.join(workspacePath, cleanWorkspaceFileName))
  if (cleanWorkspaceExists) {
    try {
      deleteDirectory(workspacePath)
    } catch (error) {
      workspace.showMessage('Failed to delete ' + workspacePath + ': ' + error, 'error')
    }
  }

  workspace.showMessage(`JDT Language Server starting at ${workspace.root}`)
  languageClient.start()
  // Register commands here to make it available even when the language client fails
  commands.registerCommand(Commands.OPEN_SERVER_LOG, async () => await openServerLogFile(workspacePath))
  let extensionPath = context.extensionPath
  commands.registerCommand(Commands.OPEN_FORMATTER, async () => openFormatter(extensionPath))
  commands.registerCommand(Commands.CLEAN_WORKSPACE, () => cleanWorkspace(workspacePath))
  context.subscriptions.push(onConfigurationChange())
  context.subscriptions.push(
    services.registLanguageClient(languageClient)
  )
  fixComment(context.subscriptions)
}

function logNotification(message: string, ..._items: string[]): void {
  // tslint:disable-next-line:no-console
  console.log(message)
}

function setIncompleteClasspathSeverity(severity: string): void {
  const config = getJavaConfiguration()
  const section = 'errors.incompleteClasspath.severity'
  config.update(section, severity, true)
  // tslint:disable-next-line:no-console
  console.log(section + ' globally set to ' + severity)
}

async function projectConfigurationUpdate(languageClient: LanguageClient, uri?: Uri): Promise<void> {
  let resource = uri ? uri.toString() : null
  if (!resource) {
    let document = await workspace.document
    resource = document.uri
  }
  if (!resource) {
    workspace.showMessage('No Java project to update!', 'warning')
    return
  }
  if (isJavaConfigFile(resource)) {
    languageClient.sendNotification(ProjectConfigurationUpdateRequest.type, {
      uri: resource
    })
  }
}

function setProjectConfigurationUpdate(languageClient: LanguageClient, uri: Uri, status: FeatureStatus): void {
  const config = getJavaConfiguration()
  const section = 'configuration.updateBuildConfiguration'
  const st = FeatureStatus[status]
  config.update(section, st)
  // tslint:disable-next-line:no-console
  console.log(section + ' set to ' + st)
  if (status !== FeatureStatus.disabled) {
    // tslint:disable-next-line:no-floating-promises
    projectConfigurationUpdate(languageClient, uri)
  }
}

function isJavaConfigFile(path: String): boolean {
  return path.endsWith('pom.xml') || path.endsWith('.gradle')
}

function onConfigurationChange(): Disposable {
  return workspace.onDidChangeConfiguration(async _params => {
    let newConfig = getJavaConfiguration()
    if (hasJavaConfigChanged(oldConfig, newConfig)) {
      let msg = 'Java Language Server configuration changed, please restart VS Code.'
      let action = 'Restart Now'
      let restartId = Commands.RELOAD_WINDOW
      oldConfig = newConfig
      let res = await workspace.showPrompt(`${msg}, ${action}?`)
      if (res) {
        commands.executeCommand(restartId)
      }
    }
  })
}

function hasJavaConfigChanged(oldConfig, newConfig): boolean {
  return hasConfigKeyChanged('home', oldConfig, newConfig)
    || hasConfigKeyChanged('jdt.ls.vmargs', oldConfig, newConfig)
    || hasConfigKeyChanged('progressReports.enabled', oldConfig, newConfig)
}

function hasConfigKeyChanged(key, oldConfig, newConfig): boolean {
  return oldConfig.get(key) !== newConfig.get(key)
}

function getTempWorkspace(): string {
  return path.resolve(os.tmpdir(), 'vscodesws_' + makeRandomHexString(5))
}

function makeRandomHexString(length): string {
  let chars = ['0', '1', '2', '3', '4', '5', '6', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f']
  let result = ''
  for (let i = 0; i < length; i++) {
    let idx = Math.floor(chars.length * Math.random())
    result += chars[idx]
  }
  return result
}

function getJavaConfiguration(): WorkspaceConfiguration {
  return workspace.getConfiguration('java')
}

async function cleanWorkspace(workspacePath): Promise<void> {
  let res = await workspace.showPrompt('Are you sure you want to clean the Java language server workspace?')
  if (res) {
    const file = path.join(workspacePath, cleanWorkspaceFileName)
    fs.closeSync(fs.openSync(file, 'w'))
    commands.executeCommand(Commands.RELOAD_WINDOW)
  }
}

function deleteDirectory(dir): void {
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach(child => {
      let entry = path.join(dir, child)
      if (fs.lstatSync(entry).isDirectory()) {
        deleteDirectory(entry)
      } else {
        fs.unlinkSync(entry)
      }
    })
    fs.rmdirSync(dir)
  }
}

async function openServerLogFile(workspacePath: string): Promise<boolean> {
  let serverLogFile = path.join(workspacePath, '.metadata', '.log')
  if (!serverLogFile) {
    workspace.showMessage('Java Language Server has not started logging.', 'warning')
    return
  }
  await workspace.openResource(Uri.file(serverLogFile).toString())
}

async function openFormatter(extensionPath): Promise<void> {
  let defaultFormatter = path.join(extensionPath, 'formatters', 'eclipse-formatter.xml')
  let formatterUrl: string = getJavaConfiguration().get('format.settings.url')
  if (formatterUrl && formatterUrl.length > 0) {
    if (isRemote(formatterUrl)) {
      commands.executeCommand(Commands.OPEN_BROWSER, Uri.parse(formatterUrl))
    } else {
      let document = getPath(formatterUrl)
      if (document && fs.existsSync(document)) {
        return openDocument(extensionPath, document, defaultFormatter, null)
      }
    }
  }
  let global = true
  let fileName = formatterUrl || 'eclipse-formatter.xml'
  let file
  let relativePath
  let root = path.join(extensionPath, '..', 'redhat.java')
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root)
  }
  file = path.join(root, fileName)
  if (!fs.existsSync(file)) {
    await addFormatter(extensionPath, file, defaultFormatter, relativePath)
  } else {
    if (formatterUrl) {
      getJavaConfiguration().update('format.settings.url', (relativePath !== null ? relativePath : file), global)
      await openDocument(extensionPath, file, file, defaultFormatter)
    } else {
      await addFormatter(extensionPath, file, defaultFormatter, relativePath)
    }
  }
}

function getPath(f): string {
  if (workspace.workspaceFolder && !path.isAbsolute(f)) {
    let file = path.resolve(Uri.parse(workspace.workspaceFolder.uri).fsPath, f)
    if (fs.existsSync(file)) {
      return file
    }
  } else {
    return path.resolve(f)
  }
  return null
}

async function openDocument(_extensionPath, formatterUrl, _defaultFormatter, _relativePath): Promise<void> {
  if (!formatterUrl || !fs.existsSync(formatterUrl)) {
    workspace.showMessage('Could not open Formatter Settings file', 'error')
    return
  }
  await workspace.openResource(Uri.file(formatterUrl).toString())
}

function isRemote(f): boolean {
  return f !== null && f.startsWith('http:/') || f.startsWith('https:/')
}

async function applyWorkspaceEdit(edit: WorkspaceEdit): Promise<void> {
  if (edit) {
    edit = await fixWorkspaceEdit(edit)
    try {
      await workspace.applyEdit(edit)
    } catch (e) {
      workspace.showMessage(`applyEdit error: ${e.message}`, 'error')
      return
    }
  }
}

async function fixWorkspaceEdit(edit: WorkspaceEdit): Promise<WorkspaceEdit> {
  let { changes } = edit
  if (!changes || Object.keys(changes).length == 0) return
  let doc = await workspace.document
  let opts = await workspace.getFormatOptions(doc.uri)
  if (!opts.insertSpaces) return
  for (let uri of Object.keys(changes)) {
    let edits = changes[uri]
    for (let ed of edits) {
      if (ed.newText.indexOf('\t') !== -1) {
        let ind = (new Array(opts.tabSize || 2)).fill(' ').join('')
        ed.newText = ed.newText.replace(/\t/g, ind)
      }
    }
  }
  return edit
}

async function addFormatter(extensionPath, formatterUrl, defaultFormatter, relativePath): Promise<void> {
  let value = relativePath ? relativePath : formatterUrl
  let f = await workspace.nvim.call('input', ['please enter URL or Path:', value])
  let global = true
  if (isRemote(f)) {
    commands.executeCommand(Commands.OPEN_BROWSER, Uri.parse(f))
    getJavaConfiguration().update('format.settings.url', f, global)
  } else {
    if (!path.isAbsolute(f)) {
      let fileName = f
      let root = path.join(extensionPath, '..', 'redhat.java')
      if (!fs.existsSync(root)) {
        fs.mkdirSync(root)
      }
      f = path.join(root, fileName)
    } else {
      relativePath = null
    }
    getJavaConfiguration().update('format.settings.url', (relativePath !== null ? relativePath : f), global)

    if (!fs.existsSync(f)) {
      let name = relativePath !== null ? relativePath : f
      let msg = '\'' + name + '\' does not exist. Do you want to create it?'
      let res = await workspace.showPrompt(msg)
      if (res) {
        fs.createReadStream(defaultFormatter)
          .pipe(fs.createWriteStream(f))
          .on('finish', () => openDocument(extensionPath, f, defaultFormatter, relativePath))
      }
    } else {
      await openDocument(extensionPath, f, defaultFormatter, relativePath)
    }
  }
}

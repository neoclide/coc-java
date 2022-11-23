import { commands, CompletionItem, CompletionContext, CompletionList, ExtensionContext, extensions, LanguageClient, LanguageClientOptions, MsgTypes, ProvideCompletionItemsSignature, ProviderResult, RevealOutputChannelOn, services, ServiceStat, StreamInfo, TextDocumentContentProvider, Uri, window, workspace } from 'coc.nvim'
import { createHash } from 'crypto'
import * as fs from 'fs'
import * as glob from 'glob'
import mkdirp from 'mkdirp'
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import rimraf from 'rimraf'
import { CancellationToken, CompletionItemKind, Emitter, ExecuteCommandParams, ExecuteCommandRequest, Location, Position, TextDocument, TextDocumentPositionParams, WorkspaceEdit } from 'vscode-languageserver-protocol'
import * as buildpath from './buildpath'
import { Commands } from './commands'
import { downloadServer } from './downloader'
import { ExtensionAPI } from './extension.api'
import { fixComment } from './fixes'
import { awaitServerConnection, prepareExecutable } from './javaServerStarter'
import { collectionJavaExtensions, onExtensionChange } from './plugin'
import { ActionableNotification, ClassFileContentsRequest, CompileWorkspaceRequest, CompileWorkspaceStatus, ExecuteClientCommandRequest, FeatureStatus, MessageType, ProgressReport, ProgressReportNotification, ProjectConfigurationUpdateRequest, SendNotificationRequest, SourceAttachmentAttribute, SourceAttachmentRequest, SourceAttachmentResult, StatusNotification } from './protocol'
import { RequirementsData, resolveRequirements, ServerConfiguration } from './requirements'
import * as sourceAction from './sourceAction'

let languageClient: any
let jdtEventEmitter = new Emitter<Uri>()
const cleanWorkspaceFileName = '.cleanWorkspace'

let serverStatus: 'Starting' | 'Started' | 'Error' = 'Starting'

export async function activate(context: ExtensionContext): Promise<ExtensionAPI> {
  let javaConfig = workspace.getConfiguration('java')
  if (!javaConfig.get<boolean>('enabled', true)) return
  let server_home: string = javaConfig.get('jdt.ls.home', '')
  if (server_home) {
    let launchersFound: string[] = glob.sync('**/plugins/org.eclipse.equinox.launcher_*.jar', { cwd: server_home })
    if (launchersFound.length == 0) {
      window.showMessage(`Launcher jar not found in jdt.ls.home: "${server_home}"`, 'error')
      return
    }
  }
  // let server
  let requirements: RequirementsData
  try {
    requirements = await resolveRequirements()
  } catch (e) {
    let res = await window.showQuickpick(['Yes', 'No'], `${e.message}, ${e.label}?`)
    if (res == 0) {
      commands.executeCommand(Commands.OPEN_BROWSER, e.openUrl).catch(_e => {
        // noop
      })
    }
    return
  }
  context.logger.info(`Using java from ${requirements.java_home}, version: ${requirements.java_version}`)

  start(server_home, requirements, context).catch(e => {
    // tslint:disable-next-line: no-console
    console.error(e)
  })
  let info: ExtensionAPI = {
    apiVersion: '0.2',
    javaRequirement: requirements,
    get status(): any {
      return serverStatus
    }
  }
  return info
}

async function start(server_home: string, requirements: RequirementsData, context: ExtensionContext): Promise<void> {
  let storagePath = context.storagePath
  if (!storagePath) {
    storagePath = getTempWorkspace()
  }
  const id = createHash('md5').update(workspace.root).digest('hex')
  let workspacePath = path.resolve(storagePath + `/jdt_ws_${id}`)
  // Register commands here to make it available even when the language client fails
  context.subscriptions.push(commands.registerCommand(Commands.OPEN_SERVER_LOG, () => openServerLogFile(workspacePath)))
  let extensionPath = context.extensionPath
  context.subscriptions.push(commands.registerCommand(Commands.OPEN_FORMATTER, async () => openFormatter(extensionPath)))
  context.subscriptions.push(commands.registerCommand(Commands.CLEAN_WORKSPACE, () => cleanWorkspace(workspacePath)))
  context.subscriptions.push(commands.registerCommand(Commands.DOWNLOAD_SERVER, async () => {
    let server_home = path.join(context.storagePath, 'server')
    if (!fs.existsSync(server_home)) {
      mkdirp.sync(server_home)
    }
    await downloadServer(server_home)
  }))
  if (!server_home) {
    server_home = path.join(context.storagePath, 'server')
    if (!fs.existsSync(server_home)) {
      mkdirp.sync(server_home)
    }
    let launchersFound: string[] = glob.sync('**/plugins/org.eclipse.equinox.launcher_*.jar', { cwd: server_home })
    if (launchersFound.length == 0) {
      window.showMessage('jdt.ls not found, downloading...')
      try {
        await downloadServer(server_home)
      } catch (e) {
        window.showMessage('Download jdt.ls failed, you can download it at https://download.eclipse.org/jdtls/snapshots/?d')
        rimraf.sync(`${server_home}/*`)
        return
      }
      window.showMessage('jdt.ls downloaded')
    }
  }

  let javaConfig = workspace.getConfiguration('java')
  let statusItem = window.createStatusBarItem(0)
  statusItem.text = ''
  let progressItem = window.createStatusBarItem(0, { progress: true })
  progressItem.text = 'jdt starting'
  progressItem.show()

  // Options to control the language client
  let clientOptions: LanguageClientOptions = {
    // Register the server for java
    documentSelector: [
      { scheme: 'file', language: 'java' },
      { scheme: 'jdt', language: 'java' },
      { scheme: 'untitled', language: 'java' }
    ],
    synchronize: {
      configurationSection: 'java'
    },
    initializationOptions: {
      bundles: collectionJavaExtensions(),
      workspaceFolders: workspace.workspaceFolders ? workspace.workspaceFolders.map(f => f.uri) : null,
      settings: { java: javaConfig },
      extendedClientCapabilities: {
        progressReportProvider: javaConfig.get<boolean>('progressReports.enabled'),
        classFileContentsSupport: true,
        overrideMethodsPromptSupport: true,
        hashCodeEqualsPromptSupport: true,
        advancedOrganizeImportsSupport: true,
        generateToStringPromptSupport: true,
        advancedGenerateAccessorsSupport: true,
        generateConstructorsPromptSupport: true,
        generateDelegateMethodsPromptSupport: true
      },
      triggerFiles: getTriggerFiles()
    },
    workspaceFolder: workspace.workspaceFolder,
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
            isIncomplete: res.hasOwnProperty('isIncomplete') ? (res as CompletionList).isIncomplete : false,
            items
          }
          let hasModule = items.some(o => o.kind == CompletionItemKind.Module)
          if (hasModule) {
            let isModule = items.length > 0 && items.every(o => o.kind == CompletionItemKind.Module)
            if (isModule) result.startcol = doc.fixStartcol(position, ['.'])
            if (!isModule && context.triggerCharacter == '.') {
              let line = doc.getline(position.line)
              let r = doc.getWordRangeAtPosition({ line: position.line, character: position.character - 1 }, '.')
              if (r) {
                let word = line.slice(r.start.character, r.end.character)
                if (word.length && word.indexOf('.') !== -1) {
                  for (let item of items) {
                    if (item.kind == CompletionItemKind.Module && item.label.startsWith(word)) {
                      item.label = item.label.slice(word.length)
                    }
                  }
                }
              }
            }
          }
          return result
        })
      }
    }
  }
  let encoding = await workspace.nvim.eval('&fileencoding') as string
  let serverConfig: ServerConfiguration = {
    root: server_home,
    encoding,
    vmargs: javaConfig.get<string>('jdt.ls.vmargs', '')
  }
  let serverOptions
  let port = process.env['SERVER_PORT']
  if (!port) {
    let lsPort = process.env['JDTLS_CLIENT_PORT']
    if (!lsPort) {
      serverOptions = prepareExecutable(requirements, workspacePath, serverConfig)
    } else {
      window.showMessage(`Lanuching jdt.ls from $JDTLS_CLIENT_PORT: ${port}`, 'warning')
      serverOptions = () => {
        let socket = net.connect(lsPort)
        let result: StreamInfo = {
          writer: socket,
          reader: socket
        }
        return new Promise<any>((resolve, reject) => {
          socket.on('connect', () => {
            resolve(result)
          })
          socket.on('error', err => {
            reject(err)
          })
        })
      }
    }
  } else {
    window.showMessage(`Lanuching client with $SERVER_PORT: ${port}`, 'warning')
    // used during development
    serverOptions = awaitServerConnection.bind(null, port)
  }

  // Create the language client and start the client.
  languageClient = new LanguageClient('java', 'Language Support for Java', serverOptions, clientOptions)
  languageClient.registerProposedFeatures()
  let started = false
  languageClient.onReady().then(() => {
    languageClient.onNotification(StatusNotification.type, report => {
      // Because we start the language client in this extension, so we also
      // need to synchronize the service state. Sometimes jdt.ls may notify
      // `Starting` even after `Started`, so we only set service state on
      // `Started`/`Error` to avoid being in a wrong final state.
      const service = services.getService(languageClient.id)
      switch (report.type) {
        case 'Started':
          started = true
          progressItem.isProgress = false
          statusItem.text = 'JDT.LS'
          statusItem.show()
          serverStatus = 'Started'
          service.state = ServiceStat.Running
          languageClient.info('JDT Language Server started', { javaRequirement: requirements, apiVersion: '0.2' })
          break
        case 'Error':
          progressItem.isProgress = false
          statusItem.hide()
          serverStatus = 'Error'
          service.state = ServiceStat.StartFailed
          window.showMessage(`JDT Language Server error ${report.message}`, 'error')
          break
        case 'Starting':
          if (!started) {
            progressItem.text = report.message
            progressItem.show()
          }
          break
        case 'Message':
          window.showMessage(report.message)
          break
      }
    })
    languageClient.onNotification(ProgressReportNotification.type, (progress: ProgressReport) => {
      progressItem.show()
      progressItem.text = progress.task + ": " + progress.status.replace(/%/g, "%%");
      if (progress.complete) {
        setTimeout(() => { progressItem.hide() }, 500)
      }
    })
    languageClient.onNotification(ActionableNotification.type, notification => {
      if (notification.severity == MessageType.Log) {
        logNotification(notification.message)
        return
      }
      if (!notification.commands) {
        let msgType: MsgTypes = 'more'
        if (notification.severity == MessageType.Error) {
          msgType = 'error'
        } else if (notification.severity == MessageType.Warning) {
          msgType = 'warning'
        }
        window.showMessage(notification.message, msgType)
      }
      const titles = notification.commands.map(a => a.title)
      window.showQuickpick(titles, notification.message).then(idx => {
        if (idx == -1) return
        let action = notification.commands[idx]
        let args: any[] = (action.arguments) ? action.arguments : []
        return commands.executeCommand(action.command, ...args)
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

    buildpath.registerCommands(context)
    sourceAction.registerCommands(languageClient, context)
    let { subscriptions } = context
    subscriptions.push(commands.registerCommand(Commands.OPEN_OUTPUT, () => {
      languageClient.outputChannel.show()
    }))
    subscriptions.push(commands.registerCommand(Commands.SHOW_JAVA_REFERENCES, (uri: string, position: Position, locations: Location[]) => {
      return commands.executeCommand(Commands.SHOW_REFERENCES, Uri.parse(uri), position, locations)
    }, null, true))
    subscriptions.push(commands.registerCommand(Commands.SHOW_JAVA_IMPLEMENTATIONS, (uri: string, position: Position, locations: Location[]) => {
      return commands.executeCommand(Commands.SHOW_REFERENCES, Uri.parse(uri), position, locations)
    }, null, true))

    subscriptions.push(commands.registerCommand(Commands.NAVIGATE_TO_SUPER_IMPLEMENTATION_COMMAND, async () => {
      const position = await window.getCursorPosition()
      const doc = await workspace.document
      const params: TextDocumentPositionParams = {
        textDocument: {
          uri: doc.uri
        },
        position
      }
      const resp: Location[] = await languageClient.sendRequest('java/findLinks', {
        type: 'superImplementation',
        position: params
      });
      if (resp && resp.length > 0) {
        if (resp.length === 1) {
          let { uri, range } = resp[0]
          await workspace.jumpTo(uri, range.start);
        } else {
          await workspace.showLocations(resp);
        }
      } else {
        window.showWarningMessage('No super implementation found');
      }
    }, null, false));

    subscriptions.push(commands.registerCommand(Commands.CONFIGURATION_UPDATE, uri => projectConfigurationUpdate(languageClient, uri), null, true))

    subscriptions.push(commands.registerCommand(Commands.IGNORE_INCOMPLETE_CLASSPATH, (_data?: any) => setIncompleteClasspathSeverity('ignore')))

    subscriptions.push(commands.registerCommand(Commands.IGNORE_INCOMPLETE_CLASSPATH_HELP, (_data?: any) => {
      return commands.executeCommand(Commands.OPEN_BROWSER, Uri.parse('https://github.com/redhat-developer/vscode-java/wiki/%22Classpath-is-incomplete%22-warning'))
    }))

    subscriptions.push(commands.registerCommand(Commands.PROJECT_CONFIGURATION_STATUS, (uri, status) => setProjectConfigurationUpdate(languageClient, uri, status), null, true))

    subscriptions.push(commands.registerCommand(Commands.APPLY_WORKSPACE_EDIT, async obj => {
      await applyWorkspaceEdit(obj)
    }, null, true))

    subscriptions.push(commands.registerCommand(Commands.EXECUTE_WORKSPACE_COMMAND, (command, ...rest) => {
      const params: ExecuteCommandParams = {
        command,
        arguments: rest
      }
      return languageClient.sendRequest(ExecuteCommandRequest.type, params)
    }, null, true))

    subscriptions.push(commands.registerCommand(Commands.COMPILE_WORKSPACE, async (isFullCompile: boolean) => {
      if (typeof isFullCompile !== 'boolean') {
        const idx = await window.showQuickpick(['Incremental', 'Full'], 'please choose compile type:')
        isFullCompile = idx != 0
      }
      window.showMessage('Compiling workspace...')
      const start = new Date().getTime()
      const res = await Promise.resolve(languageClient.sendRequest(CompileWorkspaceRequest.type, isFullCompile))
      const elapsed = ((new Date().getTime() - start) / 1000).toFixed(1)
      if (res === CompileWorkspaceStatus.SUCCEED) {
        window.showMessage(`Compile done, used ${elapsed}s.`)
      } else {
        window.showMessage('Compile error!', 'error')
      }
    }))
    subscriptions.push(commands.registerCommand(Commands.UPDATE_SOURCE_ATTACHMENT, async (classFileUri: Uri): Promise<boolean> => {
      const resolveRequest: SourceAttachmentRequest = {
        classFileUri: classFileUri.toString(),
      }
      const resolveResult: SourceAttachmentResult = await commands.executeCommand(Commands.EXECUTE_WORKSPACE_COMMAND, Commands.RESOLVE_SOURCE_ATTACHMENT, JSON.stringify(resolveRequest)) as SourceAttachmentResult
      if (resolveResult.errorMessage) {
        window.showMessage(resolveResult.errorMessage, 'error')
        return false
      }

      const attributes: SourceAttachmentAttribute = resolveResult.attributes || {}
      const defaultPath = attributes.sourceAttachmentPath || attributes.jarPath

      const sourceFile = await workspace.nvim.call('input', ['Path of source file:', defaultPath, 'file'])

      if (sourceFile) {
        const updateRequest: SourceAttachmentRequest = {
          classFileUri: classFileUri.toString(),
          attributes: {
            ...attributes,
            sourceAttachmentPath: sourceFile
          },
        }
        const updateResult: SourceAttachmentResult = await commands.executeCommand(Commands.EXECUTE_WORKSPACE_COMMAND, Commands.UPDATE_SOURCE_ATTACHMENT, JSON.stringify(updateRequest)) as SourceAttachmentResult
        if (updateResult.errorMessage) {
          window.showMessage(updateResult.errorMessage, 'error')
          return false
        }

        // Notify jdt content provider to rerender the classfile contents.
        jdtEventEmitter.fire(classFileUri)
        return true
      }
    }))

    let provider: TextDocumentContentProvider = {
      onDidChange: jdtEventEmitter.event,
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
  extensions.onDidActiveExtension(() => {
    onExtensionChange()
  }, null, context.subscriptions)
  extensions.onDidUnloadExtension(() => {
    onExtensionChange()
  }, null, context.subscriptions)

  let cleanWorkspaceExists = fs.existsSync(path.join(workspacePath, cleanWorkspaceFileName))
  if (cleanWorkspaceExists) {
    try {
      deleteDirectory(workspacePath)
    } catch (error) {
      window.showMessage('Failed to delete ' + workspacePath + ': ' + error, 'error')
    }
  }

  context.logger.info(`JDT Language Server starting at ${workspace.root}`)
  languageClient.start()
  context.subscriptions.push(services.registLanguageClient(languageClient))
  if (javaConfig.get('format.onType.fixComment.enabled')) {
    fixComment(context.subscriptions)
  }
}

function logNotification(message: string, ..._items: string[]): void {
  // tslint:disable-next-line:no-console
  console.log(message)
}

function setIncompleteClasspathSeverity(severity: string): void {
  const config = workspace.getConfiguration('java')
  const section = 'errors.incompleteClasspath.severity'
  config.update(section, severity, true)
  // tslint:disable-next-line:no-console
  console.log(section + ' globally set to ' + severity)
}

async function projectConfigurationUpdate(languageClient: any, uri?: Uri): Promise<void> {
  let resource = uri ? uri.toString() : null
  if (!resource) {
    let document = await workspace.document
    resource = document.uri
  }
  if (!resource) {
    window.showMessage('No Java project to update!', 'warning')
    return
  }
  if (isJavaConfigFile(resource)) {
    languageClient.sendNotification(ProjectConfigurationUpdateRequest.type, {
      uri: resource
    })
  }
}

function setProjectConfigurationUpdate(languageClient: LanguageClient, uri: Uri, status: FeatureStatus): void {
  const config = workspace.getConfiguration('java')
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

async function cleanWorkspace(workspacePath): Promise<void> {
  let res = await window.showPrompt('Are you sure you want to clean the Java language server workspace?')
  if (res) {
    const file = path.join(workspacePath, cleanWorkspaceFileName)
    fs.closeSync(fs.openSync(file, 'w'))
    workspace.nvim.command('CocRestart', true)
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
  if (!fs.existsSync(serverLogFile)) {
    window.showMessage('Java Language Server has not started logging.', 'warning')
    return
  }
  await workspace.openResource(Uri.file(serverLogFile).toString())
}

async function openFormatter(extensionPath): Promise<void> {
  let defaultFormatter = path.join(extensionPath, 'formatters', 'eclipse-formatter.xml')
  let formatterUrl: string = workspace.getConfiguration('java').get('format.settings.url')
  if (formatterUrl && formatterUrl.length > 0) {
    if (isRemote(formatterUrl)) {
      commands.executeCommand(Commands.OPEN_BROWSER, Uri.parse(formatterUrl)).catch(_e => {
        // noop
      })
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
      workspace.getConfiguration('java').update('format.settings.url', (relativePath !== null ? relativePath : file), global)
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
    window.showMessage('Could not open Formatter Settings file', 'error')
    return
  }
  await workspace.openResource(Uri.file(formatterUrl).toString())
}

function isRemote(f): boolean {
  return f !== null && f.startsWith('http:/') || f.startsWith('https:/')
}

export async function applyWorkspaceEdit(edit: WorkspaceEdit): Promise<void> {
  if (edit) {
    edit = await fixWorkspaceEdit(edit)
    try {
      await workspace.applyEdit(edit)
    } catch (e) {
      window.showMessage(`applyEdit error: ${e.message}`, 'error')
      return
    }
  }
}

async function fixWorkspaceEdit(edit: WorkspaceEdit): Promise<WorkspaceEdit> {
  let { changes, documentChanges } = edit
  if (!changes || Object.keys(changes).length == 0) return edit
  let doc = await workspace.document
  let opts = await workspace.getFormatOptions(doc.uri)
  if (!opts.insertSpaces) return edit
  for (let uri of Object.keys(changes || {})) {
    let edits = changes[uri]
    for (let ed of edits) {
      if (ed.newText.indexOf('\t') !== -1) {
        let ind = (new Array(opts.tabSize || 2)).fill(' ').join('')
        ed.newText = ed.newText.replace(/\t/g, ind)
      }
    }
  }
  if (Array.isArray(documentChanges)) {
    for (let change of documentChanges) {
      if (Array.isArray(change['edits'])) {
        change['edits'].forEach(ed => {
          if (ed.newText.indexOf('\t') !== -1) {
            let ind = (new Array(opts.tabSize || 2)).fill(' ').join('')
            ed.newText = ed.newText.replace(/\t/g, ind)
          }
        })
      }
    }
  }
  return edit
}

async function addFormatter(extensionPath, formatterUrl, defaultFormatter, relativePath): Promise<void> {
  let value = relativePath ? relativePath : formatterUrl
  let f = await workspace.nvim.call('input', ['please enter URL or Path:', value])
  let global = true
  let javaConfig = workspace.getConfiguration('java')
  if (isRemote(f)) {
    // tslint:disable-next-line: no-floating-promises
    commands.executeCommand(Commands.OPEN_BROWSER, Uri.parse(f))
    javaConfig.update('format.settings.url', f, global)
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
    javaConfig.update('format.settings.url', (relativePath !== null ? relativePath : f), global)

    if (!fs.existsSync(f)) {
      let name = relativePath !== null ? relativePath : f
      let msg = '\'' + name + '\' does not exist. Do you want to create it?'
      let res = await window.showPrompt(msg)
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

function getTriggerFiles(): string[] {
  const openedJavaFiles = []
  for (let doc of workspace.documents) {
    if (doc.uri.endsWith('.java')) {
      openedJavaFiles.push(doc.uri)
    }
  }
  return openedJavaFiles
}

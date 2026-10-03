import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { commands, ConfigurationTarget, snippetManager, SymbolKind, TransportKind, TreeItemCollapsibleState, Uri, window, workspace } from 'coc.nvim'
import packageJson from '../package.json'
import { apiManager } from '../src/apiManager.ts'
import { resolveJavaPostfixCompletionItems } from '../src/completion.ts'
import type { ExtensionAPI } from '../src/extension.api.ts'
import { getJavaEncoding, getJavaServerMode, ServerMode } from '../src/settings.ts'
import { getBuildFilePatterns, getJavaConfig } from '../src/utils.ts'
import { createTypeBodySnippet } from '../src/fileEventHandler.ts'
import { addAppCDSParams, addJavacParams, addMavenProjectCacheParams, getJavaExecutable, getPredefinedVariablesEnv, getServerConfigurationDirectory, getUnicodeLocaleEnv, prepareExecutable, prepareParams } from '../src/javaServerStarter.ts'
import { sanitizeCommandLinksInHover } from '../src/hoverAction.ts'
import { isCompatibleLombokVersion, parseLombokVersion, parseLombokVersionNumber } from '../src/lombokSupport.ts'
import { isCompatibleRuntime } from '../src/javaRuntimes.ts'
import { getMissingToolingJdkMessage, getRuntimeMajorVersion, isRuntimeVersionInRange, resolveRequirements, sortJdksByVersion } from '../src/requirements.ts'
import { createExtendedOutlineNodes, extendedOutlineTree, ExtendedOutlineTreeDataProvider } from '../src/outline/extendedOutlineTree.ts'
import { requestMoveWithConfirmation } from '../src/refactorAction.ts'
import { showRequirementsError } from '../src/requirementsErrorHandler.ts'
import { escapeSnippetLiterals, prepareSnippetCodeAction } from '../src/snippetEdit.ts'
import { askForProjects } from '../src/standardLanguageClientUtils.ts'

const SERVER_TIMEOUT = 10_000

interface RecordedMessage {
  method: string
  params: any
}

interface VirtualServerState {
  connected: boolean
  initializeParams?: any
  requests: RecordedMessage[]
  notifications: RecordedMessage[]
}

interface VirtualServer {
  getState(): VirtualServerState
  setBuildStatus(status: number): void
  setProjectUris(projectUris: string[]): void
  waitForRequest(method: string, timeout?: number, after?: number): Promise<RecordedMessage>
  waitForNotification(method: string, timeout?: number, after?: number, expectedParams?: unknown): Promise<RecordedMessage>
}

declare global {
  var __coc_java_test_server__: VirtualServer | undefined
}

interface ConfigurationSchema {
  type?: string | string[]
  enum?: unknown[]
  anyOf?: unknown[]
  default?: unknown
}

let api: ExtensionAPI
let virtualServer: VirtualServer
let fixtureDirectory: string
let javaDocumentUri: string
let inheritedJavaFile: string
let emptyJavaUri: string
let snippetJavaFile: string
let postfixJavaFile: string

function plain<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value))
}

function hasNestedValue(value: unknown, path: string[]): boolean {
  let current = value
  for (const part of path) {
    if (current === null || typeof current !== 'object'
      || !Object.prototype.hasOwnProperty.call(current, part)) {
      return false
    }
    current = (current as Record<string, unknown>)[part]
  }
  return true
}

async function withTimeout<T>(promise: Promise<T>, timeout: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeout)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timer)
  }
}

async function executeAndWaitForRequest<T>(method: string, execute: () => Promise<T>): Promise<[T, RecordedMessage]> {
  const after = virtualServer.getState().requests.length
  const pending = virtualServer.waitForRequest(method, 5_000, after)
  const result = await execute()
  return [result, await pending]
}

async function waitForCurrentFile(expectedFile: string, timeout = 5_000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeout) {
    const currentFile = await workspace.nvim.call('expand', ['%:p']) as string
    if (path.resolve(currentFile) === path.resolve(expectedFile)) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  const currentFile = await workspace.nvim.call('expand', ['%:p']) as string
  throw new Error(`expected current file ${expectedFile}, got ${currentFile}`)
}

async function executeAndWaitForNotification<T>(
  method: string,
  execute: () => Promise<T>,
  expectedParams?: unknown,
): Promise<[T, RecordedMessage]> {
  const after = virtualServer.getState().notifications.length
  const pending = virtualServer.waitForNotification(method, 5_000, after, expectedParams)
  const result = await execute()
  return [result, await pending]
}

before(async () => {
  assert.equal(process.env.COC_JAVA_TEST_SERVER, 'virtual')
  virtualServer = globalThis.__coc_java_test_server__
  assert.ok(virtualServer, 'coc-test setup should start the virtual Java server')

  api = apiManager.getApiInstance()
  await withTimeout(api.serverReady(), SERVER_TIMEOUT, 'virtual Java server did not become ready')

  fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-java-contracts-'))
  const javaFile = path.join(fixtureDirectory, 'Greeter.java')
  await fs.writeFile(javaFile, 'public class Greeter {}\n')
  inheritedJavaFile = path.join(fixtureDirectory, 'BaseGreeter.java')
  await fs.writeFile(inheritedJavaFile, [
    'public class BaseGreeter {',
    '',
    '',
    '  public String greet() { return "Hello"; }',
    '}',
    '',
  ].join('\n'))
  const emptyJavaFile = path.join(fixtureDirectory, 'Empty.java')
  await fs.writeFile(emptyJavaFile, 'public class Empty {}\n')
  emptyJavaUri = Uri.file(emptyJavaFile).toString()
  snippetJavaFile = path.join(fixtureDirectory, 'SnippetTarget.java')
  await fs.writeFile(snippetJavaFile, [
    'class SnippetTarget {',
    '  void run() {',
    '    value',
    '  }',
    '}',
    '',
  ].join('\n'))
  postfixJavaFile = path.join(fixtureDirectory, 'PostfixTarget.java')
  await fs.writeFile(postfixJavaFile, [
    'class PostfixTarget {',
    '  void run() {',
    '    new String().var',
    '  }',
    '}',
    '',
  ].join('\n'))
  const document = await workspace.openTextDocument(Uri.file(javaFile))
  await workspace.jumpTo(document.uri)
  await workspace.nvim.command('setfiletype java')
  javaDocumentUri = document.uri
})

after(async () => {
  if (fixtureDirectory) {
    await fs.rm(fixtureDirectory, { recursive: true, force: true })
  }
})

describe('coc-java fast contracts', () => {
  it('reports requirement failures without passing undefined message actions', async () => {
    const command = 'java.test.requirementsErrorAction'
    const calls: Array<{ message: string; items: unknown[] }> = []
    let commandParam: unknown
    const disposable = commands.registerCommand(command, (param: unknown) => {
      commandParam = param
    })
    const originalShowErrorMessage = window.showErrorMessage
    window.showErrorMessage = (async (message: string, ...items: unknown[]) => {
      calls.push({ message, items })
      return items[0]
    }) as typeof window.showErrorMessage

    try {
      await showRequirementsError({ message: 'Unable to download JRE' })
      await showRequirementsError({
        message: 'A recent JDK is required',
        label: 'Get the Java Development Kit',
        command,
        commandParam: 'https://example.test/jdk',
      })
      assert.deepEqual(calls, [
        { message: 'Unable to download JRE', items: [] },
        { message: 'A recent JDK is required', items: ['Get the Java Development Kit'] },
      ])
      assert.equal(commandParam, 'https://example.test/jdk')
    } finally {
      window.showErrorMessage = originalShowErrorMessage
      disposable.dispose()
    }
  })

  it('uses an explicitly configured tooling JDK without system scans or downloads', async () => {
    const javaHome = path.join(fixtureDirectory, 'configured-jdk-23')
    await fs.mkdir(path.join(javaHome, 'bin'), { recursive: true })
    await fs.writeFile(path.join(javaHome, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac'), '')
    let downloadCalls = 0
    const state = { get: () => undefined, update: async () => undefined }
    const context = {
      storagePath: path.join(fixtureDirectory, 'requirements-storage'),
      globalState: state,
      workspaceState: state,
    } as any

    const requirements = await resolveRequirements(context, {
      checkJavaPreferences: async () => ({
        javaHome,
        preference: 'java.jdt.ls.java.home',
      }),
      getRuntimeFromSettings: async () => [],
      findRuntimes: async () => { throw new Error('Configured tooling JDK must skip system discovery') },
      getMajorVersion: async (candidate: string) => candidate === javaHome ? 23 : 0,
      checkAndDownloadJRE: async () => {
        downloadCalls++
        return '/unexpected/downloaded-jre'
      },
    })

    assert.equal(downloadCalls, 0)
    assert.equal(requirements.tooling_jre, javaHome)
    assert.equal(requirements.tooling_jre_version, 23)
    assert.equal(requirements.java_home, javaHome)
    assert.equal(requirements.java_version, 23)
  })

  it('uses an installed Termux JDK and never attempts a bundled runtime download', async () => {
    const javaHome = path.join(fixtureDirectory, 'termux', 'usr', 'lib', 'jvm', 'java-21-openjdk')
    await fs.mkdir(path.join(javaHome, 'bin'), { recursive: true })
    await fs.writeFile(path.join(javaHome, 'bin', 'javac'), '')
    let downloadCalls = 0
    const state = { get: () => undefined, update: async () => undefined }
    const context = {
      storagePath: path.join(fixtureDirectory, 'termux-requirements-storage'),
      globalState: state,
      workspaceState: state,
    } as any

    const requirements = await resolveRequirements(context, {
      platform: 'android',
      checkJavaPreferences: async () => undefined,
      getRuntimeFromSettings: async () => [],
      findRuntimes: async () => [{
        homedir: javaHome,
        version: { java_version: '21.0.12', major: 21 },
      }],
      checkAndDownloadJRE: async () => {
        downloadCalls++
        return '/unexpected/downloaded-jre'
      },
    })

    assert.equal(downloadCalls, 0)
    assert.equal(requirements.tooling_jre, javaHome)
    assert.equal(requirements.java_home, javaHome)
  })

  it('selects JDT LS configurations for the host architecture', async () => {
    assert.equal(getServerConfigurationDirectory(false, 'android', 'arm64'), 'config_linux_arm')
    assert.equal(getServerConfigurationDirectory(true, 'android', 'arm64'), 'config_ss_linux_arm')
    assert.equal(getServerConfigurationDirectory(false, 'darwin', 'arm64'), 'config_mac_arm')
    assert.equal(getServerConfigurationDirectory(true, 'darwin', 'arm64'), 'config_ss_mac_arm')
    assert.equal(getServerConfigurationDirectory(false, 'darwin', 'x64'), 'config_mac')
    assert.equal(getServerConfigurationDirectory(false, 'linux', 'x64'), 'config_linux')

    const macArmConfiguration = await fs.readFile(
      path.resolve('server', 'config_mac_arm', 'config.ini'),
      'utf8',
    )
    assert.match(macArmConfiguration, /launcher\.cocoa\.macosx\.aarch64/)
    assert.doesNotMatch(macArmConfiguration, /launcher\.cocoa\.macosx\.x86_64/)
  })

  it('explains how to install the required JDK when Termux has none', async () => {
    let downloadCalls = 0
    const state = { get: () => undefined, update: async () => undefined }
    const context = {
      storagePath: path.join(fixtureDirectory, 'missing-termux-jdk-storage'),
      globalState: state,
      workspaceState: state,
    } as any

    await assert.rejects(resolveRequirements(context, {
      platform: 'android',
      checkJavaPreferences: async () => undefined,
      getRuntimeFromSettings: async () => [],
      findRuntimes: async () => [],
      checkAndDownloadJRE: async () => {
        downloadCalls++
        return '/unexpected/downloaded-jre'
      },
    }), (error: any) => {
      assert.match(error.message, /pkg install openjdk-21/)
      assert.equal(error.label, undefined)
      assert.equal(error.command, undefined)
      return true
    })

    assert.equal(downloadCalls, 0)
    assert.match(getMissingToolingJdkMessage(21, 'android'), /pkg install openjdk-21/)
  })

  it('resolves a Gradle multi-project build from its settings file', async () => {
    const gradleRoot = path.join(fixtureDirectory, 'gradle-multi-project')
    const subprojectRoot = path.join(gradleRoot, 'app')
    const javaFile = path.join(subprojectRoot, 'src', 'main', 'java', 'App.java')
    await fs.mkdir(path.dirname(javaFile), { recursive: true })
    await fs.writeFile(path.join(gradleRoot, 'settings.gradle.kts'), 'include("app")\n')
    await fs.writeFile(path.join(subprojectRoot, 'build.gradle.kts'), 'plugins { java }\n')
    await fs.writeFile(javaFile, 'class App {}\n')

    const document = await workspace.openTextDocument(Uri.file(javaFile))
    try {
      await workspace.jumpTo(document.uri)
      await workspace.nvim.command('setfiletype java')
      const startedAt = Date.now()
      let folder = workspace.getWorkspaceFolder(document.uri)
      while (!folder && Date.now() - startedAt < 2_000) {
        await new Promise(resolve => setTimeout(resolve, 25))
        folder = workspace.getWorkspaceFolder(document.uri)
      }
      assert.ok(folder, 'the nested Gradle source should resolve a workspace folder')
      assert.equal(path.resolve(Uri.parse(folder.uri).fsPath), gradleRoot)
    } finally {
      await workspace.jumpTo(Uri.parse(javaDocumentUri))
      await workspace.nvim.call('CocActionAsync', ['removeWorkspaceFolder', gradleRoot])
    }
  })

  it('resolves a Maven multi-module build from its parent POM', async () => {
    const mavenRoot = path.join(fixtureDirectory, 'maven-multi-module')
    const moduleRoot = path.join(mavenRoot, 'app')
    const javaFile = path.join(moduleRoot, 'src', 'main', 'java', 'App.java')
    await fs.mkdir(path.dirname(javaFile), { recursive: true })
    await fs.writeFile(path.join(mavenRoot, 'pom.xml'), [
      '<project>',
      '  <modelVersion>4.0.0</modelVersion>',
      '  <groupId>example</groupId>',
      '  <artifactId>parent</artifactId>',
      '  <version>1.0.0</version>',
      '  <packaging>pom</packaging>',
      '  <modules><module>app</module></modules>',
      '</project>',
      '',
    ].join('\n'))
    await fs.writeFile(path.join(moduleRoot, 'pom.xml'), [
      '<project>',
      '  <modelVersion>4.0.0</modelVersion>',
      '  <parent>',
      '    <groupId>example</groupId>',
      '    <artifactId>parent</artifactId>',
      '    <version>1.0.0</version>',
      '  </parent>',
      '  <artifactId>app</artifactId>',
      '</project>',
      '',
    ].join('\n'))
    await fs.writeFile(javaFile, 'class App {}\n')

    const document = await workspace.openTextDocument(Uri.file(javaFile))
    try {
      await workspace.jumpTo(document.uri)
      await workspace.nvim.command('setfiletype java')
      const startedAt = Date.now()
      let folder = workspace.getWorkspaceFolder(document.uri)
      while (!folder && Date.now() - startedAt < 2_000) {
        await new Promise(resolve => setTimeout(resolve, 25))
        folder = workspace.getWorkspaceFolder(document.uri)
      }
      assert.ok(folder, 'the nested Maven source should resolve a workspace folder')
      assert.equal(path.resolve(Uri.parse(folder.uri).fsPath), mavenRoot)
    } finally {
      await workspace.jumpTo(Uri.parse(javaDocumentUri))
      await workspace.nvim.call('CocActionAsync', ['removeWorkspaceFolder', mavenRoot])
    }
  })

  it('loads every contributed Java setting and forwards it during initialization', () => {
    const properties = packageJson.contributes.configuration.properties as Record<string, ConfigurationSchema>
    const entries = Object.entries(properties)
    assert.equal(entries.length, 137, 'update this contract when settings are intentionally added or removed')

    const transport = properties['java.transport']
    assert.equal(transport?.default, 'pipe')
    assert.deepEqual(transport?.enum, ['pipe', 'stdio'])

    const javaSettings = virtualServer.getState().initializeParams?.initializationOptions?.settings?.java
    assert.ok(javaSettings, 'the virtual server should capture Java initialization settings')
    assert.equal(javaSettings.jdt.ls.kotlinSupport.enabled, true)
    assert.equal(javaSettings.completion.lazyResolveTextEdit.enabled, true)
    assert.equal(javaSettings.transport, 'stdio', 'the configured client transport should be forwarded')
    assert.equal(javaSettings.inlayHints.formatParameters.enabled, false)
    assert.equal(javaSettings.search.scope, 'all')
    assert.equal(
      virtualServer.getState().initializeParams?.initializationOptions?.extendedClientCapabilities?.moveRefactoringConfirmationSupport,
      true,
    )
    assert.equal(
      virtualServer.getState().initializeParams?.initializationOptions?.extendedClientCapabilities?.snippetEditSupport,
      true,
    )

    for (const [key, schema] of entries) {
      assert.match(key, /^java\./)
      assert.equal(Object.prototype.hasOwnProperty.call(schema, 'default'), true, `${key} should declare a default`)
      assert.ok(schema.type !== undefined || schema.enum !== undefined || schema.anyOf !== undefined,
        `${key} should declare a value shape`)

      const inspected = workspace.getConfiguration().inspect(key)
      assert.ok(inspected, `${key} should be registered with coc.nvim`)
      assert.deepEqual(plain(inspected.defaultValue), plain(schema.default), `${key} should expose its manifest default`)

      if (schema.enum) {
        assert.ok(schema.enum.some(value => JSON.stringify(value) === JSON.stringify(schema.default)),
          `${key} default should be one of its enum values`)
      }

      const relativePath = key.slice('java.'.length).split('.')
      const clientOnlyUndefined = key === 'java.project.outputPath' || key === 'java.project.sourcePaths'
      assert.ok(clientOnlyUndefined || hasNestedValue(javaSettings, relativePath),
        `${key} should be forwarded to the language server`)
    }
  })

  it('normalizes the main server settings and honors importer toggles', async () => {
    const javaConfig = getJavaConfig('/virtual/jdk')
    assert.equal(javaConfig.home, '/virtual/jdk')
    assert.equal(javaConfig.jdt.ls.androidSupport.enabled, false)
    assert.equal(javaConfig.jdt.ls.javac.enabled, false)
    assert.equal(javaConfig.completion.matchCase, 'off')
    assert.equal(javaConfig.implementationCodeLens, 'none')
    assert.equal(javaConfig.project.outputPath, undefined)
    assert.equal(javaConfig.project.sourcePaths, undefined)
    assert.equal(getJavaServerMode(), ServerMode.standard)
    assert.equal(typeof getJavaEncoding(), 'string')
    assert.deepEqual(plain(getBuildFilePatterns()), [])

    const configuration = workspace.getConfiguration()
    try {
      await configuration.update('java.import.maven.enabled', true, ConfigurationTarget.Global)
      await configuration.update('java.import.gradle.enabled', true, ConfigurationTarget.Global)
      assert.deepEqual(plain(getBuildFilePatterns()), ['**/pom.xml', '**/*.gradle', '**/*.gradle.kts'])
    } finally {
      await configuration.update('java.import.maven.enabled', undefined, ConfigurationTarget.Global)
      await configuration.update('java.import.gradle.enabled', undefined, ConfigurationTarget.Global)
    }
  })

  it('forwards live setting changes to the virtual server', async () => {
    const configuration = workspace.getConfiguration()
    try {
      const expected = { settings: { java: { completion: { maxResults: 50 } } } }
      const [, notification] = await executeAndWaitForNotification(
        'workspace/didChangeConfiguration',
        () => configuration.update('java.completion.maxResults', 50, ConfigurationTarget.Global),
        expected,
      )
      assert.equal(notification.params?.settings?.java?.completion?.maxResults, 50)
    } finally {
      await configuration.update('java.completion.maxResults', undefined, ConfigurationTarget.Global)
    }
  })

  it('registers every contributed command plus the protocol bridge commands', () => {
    const contributed = packageJson.contributes.commands as Array<{ command: string }>
    assert.equal(contributed.length, 31, 'update this contract when public commands are intentionally changed')
    for (const { command } of contributed) {
      assert.equal(commands.has(command), true, `${command} should be registered`)
    }

    for (const command of [
      'java.execute.workspaceCommand',
      'java.open.output',
      'java.open.file',
      'java.runtimeValidation.open',
      'java.apply.workspaceEdit',
      '_java.workspace.path',
      '_java.reloadBundles.command',
      '_java.projectConfiguration.saveAndUpdate',
      'java.action.extendedOutline.open',
    ]) {
      assert.equal(commands.has(command), true, `${command} should be registered`)
    }
    assert.equal(commands.has('java.runtimes.add'), true)
  })

  it('keeps inherited members for both classes and interfaces in the extended outline', () => {
    const range = { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }
    const symbols = [SymbolKind.Class, SymbolKind.Interface, SymbolKind.Enum].map((kind, index) => ({
      name: `Root${index}`,
      detail: `root ${index}`,
      kind,
      range,
      selectionRange: range,
      uri: `file:///Root${index}.java`,
      children: [{
        name: `member${index}`,
        detail: `member ${index}`,
        kind: SymbolKind.Method,
        range,
        selectionRange: range,
        uri: `file:///Inherited${index}.java`,
      }],
    }))
    const nodes = createExtendedOutlineNodes(symbols)
    assert.equal(nodes[0].children.length, 1)
    assert.equal(nodes[1].children.length, 1, 'interface members are the v1.41 upstream regression fix')
    assert.equal(nodes[2].children.length, 0, 'match the upstream class/interface-only layout')

    const provider = new ExtendedOutlineTreeDataProvider(nodes)
    assert.equal(provider.getParent(nodes[1].children[0]), nodes[1])
    const rootItem = provider.getTreeItem(nodes[1])
    assert.equal(rootItem.collapsibleState, TreeItemCollapsibleState.Expanded)
    assert.equal(rootItem.description, 'root 1')
    assert.equal(provider.getTreeItem(nodes[1].children[0]).command?.command, 'java.action.extendedOutline.open')
  })

  it('escapes Java literals without changing snippet placeholders or escaped commas', () => {
    assert.equal(
      escapeSnippetLiterals('$HOME C:\\logs ${1:name}'),
      '\\$HOME C:\\\\logs ${1:name}',
    )
    const choice = '${1|HashMap<Integer\\,Integer>,Map<Integer\\,Integer>|}'
    assert.equal(escapeSnippetLiterals(choice), choice)

    const action = {
      edit: {
        documentChanges: [{
          textDocument: { uri: 'file:///Snippet.java', version: null },
          edits: [{ snippet: { kind: 'snippet', value: '$value ${1:name}' } }],
        }],
      },
    }
    assert.equal(
      (prepareSnippetCodeAction(action).edit.documentChanges[0].edits[0].snippet.value),
      '\\$value ${1:name}',
    )
  })

  it('matches detected JDKs to supported execution environments', () => {
    assert.equal(isCompatibleRuntime({ homedir: '/jdk-8', version: { java_version: '1.8.0', major: 8 } }, 'JavaSE-1.8'), true)
    assert.equal(isCompatibleRuntime({ homedir: '/jdk-8', version: { java_version: '1.8.0', major: 8 } }, 'JavaSE-9'), false)
    assert.equal(isCompatibleRuntime({ homedir: '/jdk-17', version: { java_version: '17.0.0', major: 17 } }, 'JavaSE-17'), true)
    assert.equal(isCompatibleRuntime({ homedir: '/jdk-17', version: { java_version: '17.0.0', major: 17 } }, 'JavaSE-21'), false)
  })

  it('ignores detected JDKs whose versions cannot be determined', () => {
    const unknown = { homedir: '/jdk-unknown' }
    const java17 = { homedir: '/jdk-17', version: { java_version: '17.0.0', major: 17 } }
    const java21 = { homedir: '/jdk-21', version: { java_version: '21.0.0', major: 21 } }

    assert.equal(getRuntimeMajorVersion(unknown), 0)
    assert.equal(isRuntimeVersionInRange(unknown, 17), false)
    assert.equal(isRuntimeVersionInRange(java17, 17, 20), true)
    assert.equal(isRuntimeVersionInRange(java21, 17, 20), false)
    assert.deepEqual(sortJdksByVersion([unknown, java17, java21]), [java21, java17, unknown])
  })

  it('routes API and command requests through the virtual server', async () => {
    const uri = 'file:///virtual/Greeter.java'
    const symbols = await api.getDocumentSymbols({ textDocument: { uri } })
    assert.equal(symbols?.[0]?.name, 'Greeter')

    const definitions = await api.goToDefinition({
      textDocument: { uri },
      position: { line: 1, character: 5 },
    })
    assert.equal(Array.isArray(definitions), true)
    assert.equal((definitions as any[])[0].uri, uri)

    assert.deepEqual(plain(await api.getProjectSettings(uri, ['java.version'])), {})
    assert.deepEqual(plain(await api.getClasspaths(uri, { scope: 'test' })), {
      projectRoot: '',
      classpaths: [],
      modulepaths: [],
    })
    assert.equal(await api.isTestFile(uri), false)
    assert.equal(typeof api.serverRunning, 'function')
    assert.equal(await api.serverRunning?.(), true)
    assert.deepEqual(plain(await commands.executeCommand('java.execute.workspaceCommand', 'java.project.getAll')), [])

    const commandUri = Uri.parse('file:///virtual/src')
    await commands.executeCommand('java.project.import.command')
    await commands.executeCommand('java.project.addToSourcePath.command', commandUri)
    await commands.executeCommand('java.project.removeFromSourcePath.command', commandUri)
    await commands.executeCommand('java.project.listSourcePaths.command')
    await commands.executeCommand('java.server.mode.switch', 'Standard', true)

    const requests = virtualServer.getState().requests
    assert.ok(requests.some(request => request.method === 'textDocument/documentSymbol'))
    assert.ok(requests.some(request => request.method === 'textDocument/definition'))
    for (const command of [
      'java.project.getSettings',
      'java.project.getClasspaths',
      'java.project.isTestFile',
      'java.project.getAll',
      'java.project.import',
      'java.project.addToSourcePath',
      'java.project.removeFromSourcePath',
      'java.project.listSourcePaths',
    ]) {
      assert.ok(requests.some(request => request.method === 'workspace/executeCommand'
        && request.params?.command === command), `${command} should reach the virtual server`)
    }

    const [, notification] = await executeAndWaitForNotification('java/projectConfigurationUpdate', () => {
      return commands.executeCommand('java.projectConfiguration.update', Uri.parse(uri))
    })
    assert.deepEqual(plain(notification.params), { uri })
  })

  it('routes compile, project build, cleanup, and navigation requests', async () => {
    const [compileResult, compileRequest] = await executeAndWaitForRequest('java/buildWorkspace', () => {
      return commands.executeCommand<number>('java.workspace.compile', false)
    })
    assert.equal(compileResult, 1)
    assert.equal(compileRequest.params, false)

    const projectUri = Uri.parse('file:///virtual/project')
    const [buildResult, buildRequest] = await executeAndWaitForRequest('java/buildProjects', () => {
      return commands.executeCommand('java.project.build', projectUri)
    })
    assert.equal(buildResult, 1)
    assert.deepEqual(plain(buildRequest.params), {
      identifiers: [{ uri: projectUri.toString() }],
      isFullBuild: false,
    })

    virtualServer.setBuildStatus(2)
    try {
      const [withErrors] = await executeAndWaitForRequest('java/buildWorkspace', () => {
        return commands.executeCommand<number>('java.workspace.compile', false)
      })
      assert.equal(withErrors, 2, 'language-server build statuses should resolve instead of reject')
    } finally {
      virtualServer.setBuildStatus(1)
    }

    const [, cleanupRequest] = await executeAndWaitForRequest('java/cleanup', () => {
      return commands.executeCommand('java.action.doCleanup')
    })
    assert.equal(cleanupRequest.params?.uri, javaDocumentUri)

    const [, navigationRequest] = await executeAndWaitForRequest('java/findLinks', () => {
      return commands.executeCommand('java.action.navigateToSuperImplementation', Uri.parse(javaDocumentUri))
    })
    assert.equal(navigationRequest.params?.type, 'superImplementation')
    assert.equal(navigationRequest.params?.position?.textDocument?.uri, javaDocumentUri)
  })

  it('copies a fully qualified name through the workspace command bridge', async () => {
    const [, request] = await executeAndWaitForRequest('workspace/executeCommand', () => {
      return commands.executeCommand('java.action.copyFullyQualifiedName')
    })
    assert.equal(request.params?.command, 'java.getFullyQualifiedName')
    const params = JSON.parse(request.params?.arguments?.[0])
    assert.equal(params.textDocument.uri, javaDocumentUri)
    assert.equal(await workspace.nvim.call('getreg', ['+']), 'com.example.Greeter')
  })

  it('renders the extended outline and opens an inherited member from the tree', async () => {
    const sourceWindowId = await workspace.nvim.call('win_getid', []) as number
    const [, request] = await executeAndWaitForRequest('java/extendedDocumentSymbol', () => {
      return commands.executeCommand('java.action.showExtendedOutline')
    })
    assert.equal(request.params?.textDocument?.uri, javaDocumentUri)
    try {
      assert.equal(await workspace.nvim.eval('get(w:, "cocViewId", "")'), 'javaExtendedOutline')
      const lines = await workspace.nvim.call('getline', [1, '$']) as string[]
      assert.ok(lines.some(line => line.includes('ExtendedGreeter')))
      assert.ok(lines.some(line => line.includes('GreeterContract')))
      assert.equal(lines.filter(line => line.includes('greet')).length, 2)

      const [, reopenedRequest] = await executeAndWaitForRequest('java/extendedDocumentSymbol', () => {
        return commands.executeCommand('java.action.showExtendedOutline', Uri.parse(javaDocumentUri))
      })
      assert.equal(reopenedRequest.params?.textDocument?.uri, javaDocumentUri)
      assert.equal(await workspace.nvim.eval('get(w:, "cocViewId", "")'), 'javaExtendedOutline')

      const reopenedLines = await workspace.nvim.call('getline', [1, '$']) as string[]
      const inheritedMemberLine = reopenedLines.findIndex(line => line.includes('greet')) + 1
      assert.ok(inheritedMemberLine > 0, 'expected an inherited member in the rendered tree')
      await workspace.nvim.call('cursor', [inheritedMemberLine, 1])
      await workspace.nvim.input('<cr>')
      await waitForCurrentFile(inheritedJavaFile)
      assert.equal(await workspace.nvim.call('line', ['.']), 4)
      assert.equal(await workspace.nvim.call('win_getid', []), sourceWindowId)
      assert.notEqual(await workspace.nvim.eval('get(w:, "cocViewId", "")'), 'javaExtendedOutline')
    } finally {
      await extendedOutlineTree.close()
      await workspace.jumpTo(javaDocumentUri)
    }
  })

  it('keeps the editor focused when the server returns no extended outline symbols', async () => {
    const sourceWindowId = await workspace.nvim.call('win_getid', []) as number
    const [, request] = await executeAndWaitForRequest('java/extendedDocumentSymbol', () => {
      return commands.executeCommand('java.action.showExtendedOutline', Uri.parse(emptyJavaUri))
    })
    assert.equal(request.params?.textDocument?.uri, emptyJavaUri)
    assert.equal(await workspace.nvim.call('win_getid', []), sourceWindowId)
    const treeWindowId = await workspace.nvim.call('coc#window#find', ['cocViewId', 'javaExtendedOutline']) as number
    assert.ok(treeWindowId <= 0, 'an empty response should not create a TreeView')
  })

  it('applies a resolved code-action SnippetTextEdit with coc.nvim placeholders', async () => {
    const document = await workspace.openTextDocument(Uri.file(snippetJavaFile))
    await workspace.jumpTo(document.uri)
    await workspace.nvim.command('setfiletype java')
    const bufnr = await workspace.nvim.call('bufnr', ['%']) as number
    const requestOffset = virtualServer.getState().requests.length
    const codeActionRequest = virtualServer.waitForRequest('textDocument/codeAction', 5_000, requestOffset)
    const resolveRequest = virtualServer.waitForRequest('codeAction/resolve', 5_000, requestOffset)
    try {
      await withTimeout(
        workspace.nvim.call('CocAction', ['codeAction', null, 'Insert Java snippet']) as Promise<unknown>,
        5_000,
        'snippet code action did not complete',
      )
      assert.equal((await codeActionRequest).params?.textDocument?.uri, document.uri)
      assert.equal((await resolveRequest).params?.data?.uri, document.uri)
      assert.deepEqual(await workspace.nvim.call('getline', [1, '$']), [
        'class SnippetTarget {',
        '  void run() {',
        '    if (ready) {',
        '      HashMap<Integer,Integer> values = null;',
        '      System.out.println("$HOME\\\\logs");',
        '      ',
        '    }',
        '  }',
        '}',
      ])
      assert.equal(snippetManager.isActivated(bufnr), true)
    } finally {
      snippetManager.cancel()
      await workspace.jumpTo(javaDocumentUri)
    }
  })

  it('eagerly resolves only unresolved Java postfix completion items', async () => {
    const ordinary = { label: 'length', insertText: 'length' }
    const resolved = {
      label: 'if',
      insertText: '${inner_expression}.if',
      textEdit: {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        newText: 'if (value) {\n  ${0}\n}',
      },
    }
    const pending = { label: 'var', insertText: '${inner_expression}.var' }
    const calls: string[] = []
    const items = [ordinary, resolved, pending]

    const result = await resolveJavaPostfixCompletionItems(items, async item => {
      calls.push(item.label)
      return {
        ...item,
        textEdit: {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          newText: 'String ${1:value} = expression;${0}',
        },
      }
    })

    assert.equal(result, items)
    assert.deepEqual(calls, ['var'])
    assert.ok(pending.textEdit)
    assert.equal(await resolveJavaPostfixCompletionItems(null, async () => undefined), null)
  })

  it('applies a resolved Java postfix completion across the whole expression', async () => {
    const document = await workspace.openTextDocument(Uri.file(postfixJavaFile))
    await workspace.jumpTo(document.uri)
    await workspace.nvim.command('setfiletype java')
    const requestOffset = virtualServer.getState().requests.length
    try {
      await workspace.nvim.call('cursor', [3, 20])
      await workspace.nvim.command('startinsert!')
      await withTimeout((async () => {
        while (!String(await workspace.nvim.call('mode')).startsWith('i')) {
          await new Promise(resolve => setTimeout(resolve, 25))
        }
      })(), 5_000, 'editor did not enter insert mode')
      await commands.executeCommand('editor.action.triggerSuggest', 'java')
      await withTimeout((async () => {
        while (await workspace.nvim.call('coc#pum#visible') !== 1) {
          await new Promise(resolve => setTimeout(resolve, 25))
        }
      })(), 5_000, 'postfix completion menu did not become visible')

      const pumWinid = await workspace.nvim.call('coc#pum#winid') as number
      const words = await workspace.nvim.call('getwinvar', [pumWinid, 'words', []]) as string[]
      const index = words.findIndex(word => word === 'var')
      assert.notEqual(index, -1, `expected var in the completion menu, received ${JSON.stringify(words)}`)
      await workspace.nvim.call('coc#pum#select', [index, 1, 1])
      await withTimeout((async () => {
        while (await workspace.nvim.call('getline', [3]) !== '    String string = new String();') {
          await new Promise(resolve => setTimeout(resolve, 25))
        }
      })(), 5_000, `postfix completion inserted ${JSON.stringify(await workspace.nvim.call('getline', [3]))}`)

      const requests = virtualServer.getState().requests.slice(requestOffset)
      assert.ok(requests.some(request => request.method === 'textDocument/completion'))
      assert.equal(requests.filter(request => request.method === 'completionItem/resolve').length, 1,
        'postfix completion should be resolved eagerly and only once')
      const selectionRequest = await virtualServer.waitForRequest('workspace/executeCommand', 5_000, requestOffset)
      assert.deepEqual(selectionRequest.params, {
        command: 'java.completion.onDidSelect',
        arguments: ['1', '0'],
      })
      const completionCount = requests.filter(request => request.method === 'textDocument/completion').length
      await commands.executeCommand('editor.action.triggerSuggest', 'java')
      await withTimeout((async () => {
        while (virtualServer.getState().requests
          .slice(requestOffset)
          .filter(request => request.method === 'textDocument/completion').length <= completionCount) {
          await new Promise(resolve => setTimeout(resolve, 25))
        }
      })(), 5_000, 'next completion request did not wait for completion selection')
    } finally {
      await workspace.nvim.command('stopinsert')
      await workspace.nvim.call('coc#pum#close', ['cancel'])
      snippetManager.cancel()
      await workspace.jumpTo(javaDocumentUri)
    }
  })

  it('adapts portable upstream startup and template behavior', async () => {
    assert.deepEqual(plain(getUnicodeLocaleEnv('win32', { LANG: 'C' })), {})
    assert.deepEqual(plain(getUnicodeLocaleEnv('linux', {})), { LC_CTYPE: 'C.UTF-8' })
    assert.deepEqual(plain(getUnicodeLocaleEnv('linux', { LC_ALL: 'POSIX' })), { LC_ALL: 'C.UTF-8' })
    assert.deepEqual(plain(getUnicodeLocaleEnv('linux', { LANG: 'en_US.UTF-8' })), {})
    assert.deepEqual(plain(getUnicodeLocaleEnv('linux', { LANG: 'zh_CN.GBK' })), {})

    const variables = getPredefinedVariablesEnv()
    assert.ok(variables.userHome)
    assert.equal(typeof variables.workspaceFolder, 'string')
    assert.equal(typeof variables.workspaceFolderBasename, 'string')

    assert.deepEqual(plain(createTypeBodySnippet('public class Greeter', '  ', 'end_of_line')), [
      'public class Greeter {', '  ${0}', '}',
    ])
    assert.deepEqual(plain(createTypeBodySnippet('class Greeter', '\t', 'next_line')), [
      'class Greeter', '{', '\t${0}', '}',
    ])
    assert.deepEqual(plain(createTypeBodySnippet('class Greeter', '  ', 'next_line_shifted')), [
      'class Greeter', '  {', '    ${0}', '  }',
    ])

    const sanitized = sanitizeCommandLinksInHover({
      contents: [{ language: 'markdown', value: '[unsafe](command:evil.run) and [JDK](jdt://contents/java.base)' }],
    })
    assert.equal((sanitized.contents[0] as any).value, 'unsafe and [JDK](jdt://contents/java.base)')

    const state = { get: () => undefined, update: async () => undefined }
    const context = {
      extensionPath: path.resolve(process.cwd()),
      storagePath: path.join(fixtureDirectory, 'storage'),
      globalState: state,
      workspaceState: state,
      asAbsolutePath: (relativePath: string) => path.resolve(process.cwd(), relativePath),
    } as any
    const params = prepareParams({
      tooling_jre: '/virtual/jdk',
      tooling_jre_version: 24,
      java_home: '/virtual/jdk',
      java_version: 24,
    }, path.join(fixtureDirectory, 'workspace'), context, false)
    assert.ok(params.includes('-Djdk.xml.maxGeneralEntitySizeLimit=0'))
    assert.ok(params.includes('-Djdk.xml.totalEntitySizeLimit=0'))
    assert.ok(params.includes('-Dm2e.project.cache.size=50'))

    const javacParams: string[] = []
    addJavacParams(javacParams, 'dom')
    for (const flag of [
      'jdk.compiler/com.sun.tools.javac.processing=ALL-UNNAMED',
      'jdk.compiler/com.sun.tools.javac.model=ALL-UNNAMED',
      '-DSourceIndexer.DOM_BASED_INDEXER=true',
      '-DMatchLocator.DOM_BASED_MATCH=true',
      '-DIJavaSearchDelegate=org.eclipse.jdt.internal.core.search.DOMJavaSearchDelegate',
      '-DCompilationUnit.codeComplete.DOM_BASED_OPERATIONS=true',
    ]) {
      assert.ok(javacParams.includes(flag), `${flag} should be forwarded to jdt-javac`)
    }

    const appCDSParams: string[] = []
    addAppCDSParams(appCDSParams, 'on', fixtureDirectory, '1.42.0', 21, '')
    assert.ok(appCDSParams.includes('-XX:+AutoCreateSharedArchive'))
    assert.ok(appCDSParams.some(param => param.startsWith('-XX:SharedArchiveFile=')))
    for (const version of [26, 27]) {
      const unsupported: string[] = []
      addAppCDSParams(unsupported, 'on', fixtureDirectory, '1.56.0', version, '')
      assert.deepEqual(unsupported, [], 'Java 26+ must not receive removed AppCDS VM flags')
    }
    const debugParams = ['-agentlib:jdwp=transport=dt_socket']
    addAppCDSParams(debugParams, 'on', fixtureDirectory, '1.42.0', 21, '')
    assert.equal(debugParams.length, 1, 'AppCDS should stay disabled while debugging')
    const java17Params: string[] = []
    addAppCDSParams(java17Params, 'on', fixtureDirectory, '1.42.0', 17, '')
    assert.equal(java17Params.length, 0, 'AppCDS should stay disabled on the supported Java 17 fallback')
  })

  it('honors Maven cache settings without overriding explicit VM arguments', () => {
    const params: string[] = []
    addMavenProjectCacheParams(params, 100, '')
    assert.deepEqual(params, ['-Dm2e.project.cache.size=100'])
    for (const size of [undefined, null, 0, -1, 1.5, '50', NaN]) {
      const invalid: string[] = []
      addMavenProjectCacheParams(invalid, size, '')
      assert.deepEqual(invalid, [])
    }
    const explicit: string[] = []
    addMavenProjectCacheParams(explicit, 50, '-Xmx1g -Dm2e.project.cache.size=200')
    assert.deepEqual(explicit, [])
  })

  it('forwards classpath variables and exposes Java 27 runtime definitions', async () => {
    const configuration = workspace.getConfiguration()
    try {
      await configuration.update('java.classpath.variables', ['LIB=/tmp/java-library'], ConfigurationTarget.Global)
      assert.deepEqual(plain(getJavaConfig('/virtual/jdk').classpath.variables), ['LIB=/tmp/java-library'])
      assert.ok(packageJson.contributes.configuration.properties['java.configuration.runtimes'].items.properties.name.enum.includes('JavaSE-27'))
      assert.equal(isCompatibleRuntime({ homedir: '/jdk-27', version: { java_version: '27', major: 27 } }, 'JavaSE-27'), true)
    } finally {
      await configuration.update('java.classpath.variables', undefined, ConfigurationTarget.Global)
    }
  })

  it('uses direct Java launches and a windowless executable for Windows pipes', async () => {
    const javaHome = path.join(fixtureDirectory, 'Program Files', 'Java', 'jdk-23')
    const binDirectory = path.join(javaHome, 'bin')
    await fs.mkdir(binDirectory, { recursive: true })
    await fs.writeFile(path.join(binDirectory, 'javaw.exe'), '')

    assert.equal(
      getJavaExecutable(javaHome, TransportKind.pipe, 'win32'),
      path.join(binDirectory, 'javaw.exe'),
    )
    assert.equal(
      getJavaExecutable(javaHome, TransportKind.stdio, 'win32'),
      path.join(binDirectory, 'java.exe'),
    )
    assert.equal(
      getJavaExecutable(path.join(fixtureDirectory, 'jdk-without-javaw'), TransportKind.pipe, 'win32'),
      path.join(fixtureDirectory, 'jdk-without-javaw', 'bin', 'java.exe'),
    )

    const state = { get: () => undefined, update: async () => undefined }
    const context = {
      extensionPath: path.resolve(process.cwd()),
      storagePath: path.join(fixtureDirectory, 'storage'),
      globalState: state,
      workspaceState: state,
      asAbsolutePath: (relativePath: string) => path.resolve(process.cwd(), relativePath),
    } as any
    const executable = prepareExecutable({
      tooling_jre: javaHome,
      tooling_jre_version: 23,
      java_home: javaHome,
      java_version: 23,
    }, path.join(fixtureDirectory, 'workspace'), {}, context, false)
    assert.equal(executable.options?.shell, false)
    assert.equal(executable.command, path.join(binDirectory, 'java'))
  })

  it('parses Lombok versions without crashing on malformed jar names', () => {
    assert.equal(parseLombokVersion(undefined), undefined)
    assert.equal(parseLombokVersion('/tmp/example.jar'), undefined)
    assert.equal(parseLombokVersionNumber('/tmp/lombok.jar'), undefined)
    assert.equal(isCompatibleLombokVersion(undefined), false)
    assert.equal(isCompatibleLombokVersion('not-a-version'), false)

    const jar = '/tmp/lombok-1.18.32.jar'
    assert.equal(parseLombokVersion(jar), 'lombok-1.18.32')
    assert.equal(parseLombokVersionNumber(jar), '1.18.32')
    assert.equal(isCompatibleLombokVersion('1.18.0'), true)
    assert.equal(isCompatibleLombokVersion('1.17.0'), false)
  })

  it('retries move refactoring only after confirmation', async () => {
    const requests: any[] = []
    const client = {
      sendRequest: async (_type: unknown, params: any) => {
        requests.push(plain(params))
        return requests.length === 1
          ? { confirmationToken: 'confirm-move', errorMessage: 'A target method may be shadowed.' }
          : { edit: { changes: {} } }
      },
    } as any
    const moveParams = {
      moveKind: 'moveInstanceMethod',
      sourceUris: [javaDocumentUri],
      params: {
        textDocument: { uri: javaDocumentUri },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        context: { diagnostics: [] },
      },
      destination: { name: 'target' },
    }
    let confirmationMessage = ''
    await requestMoveWithConfirmation(client, moveParams, async message => {
      confirmationMessage = message
      return true
    })
    assert.match(confirmationMessage, /target method may be shadowed/)
    assert.equal(requests.length, 2)
    assert.equal(requests[1].confirmationToken, 'confirm-move')

    requests.length = 0
    await requestMoveWithConfirmation(client, moveParams, async () => false)
    assert.equal(requests.length, 1)
  })

  it('uses the project protocol command for command-palette actions', async () => {
    const [, projectRequest] = await executeAndWaitForRequest('workspace/executeCommand', () => {
      return commands.executeCommand('java.project.createModuleInfo.command')
    })
    assert.equal(projectRequest.params?.command, 'java.project.getAll')
  })

  it('shows workspace-relative paths for projects with duplicate names', async () => {
    const projectPaths = [
      path.join(workspace.root, 'project_1', 'service'),
      path.join(workspace.root, 'project_1', 'client'),
      path.join(workspace.root, 'project_2', 'service'),
      path.join(workspace.root, 'project_2', 'client'),
    ]
    virtualServer.setProjectUris(projectPaths.map(projectPath => Uri.file(projectPath).toString()))
    const originalShowQuickPick = window.showQuickPick
    const workspaceApi = workspace as any
    const hadOwnAsRelativePath = Object.prototype.hasOwnProperty.call(workspaceApi, 'asRelativePath')
    const originalAsRelativePath = workspaceApi.asRelativePath
    workspaceApi.asRelativePath = undefined
    let projectPicks: Array<{ label: string; description?: string; detail: string }> = []
    window.showQuickPick = (async (items: typeof projectPicks) => {
      projectPicks = items
      return undefined
    }) as typeof window.showQuickPick

    try {
      const activeFile = Uri.file(path.join(projectPaths[0], 'src', 'Main.java'))
      assert.equal((await askForProjects(activeFile, 'Select projects')).length, 0)
      assert.deepEqual(projectPicks.map(item => item.label), ['service', 'client', 'service', 'client'])
      assert.deepEqual(projectPicks.map(item => item.description), [
        path.join('project_1', 'service'),
        path.join('project_1', 'client'),
        path.join('project_2', 'service'),
        path.join('project_2', 'client'),
      ])
      assert.equal(projectPicks[0].picked, true)
      assert.deepEqual(projectPicks.map(item => item.detail), projectPaths)
    } finally {
      window.showQuickPick = originalShowQuickPick
      if (hadOwnAsRelativePath) {
        workspaceApi.asRelativePath = originalAsRelativePath
      } else {
        delete workspaceApi.asRelativePath
      }
      virtualServer.setProjectUris([])
    }
  })

  it('opens each hierarchy direction directly from the current Java cursor', async () => {
    for (const [command, direction] of [
      ['java.action.showSupertypeHierarchy', 1],
      ['java.action.showSubtypeHierarchy', 0],
      ['java.action.showClassHierarchy', 2],
      ['java.action.showTypeHierarchy', 2],
    ] as const) {
      const [, request] = await executeAndWaitForRequest('workspace/executeCommand', () => {
        return commands.executeCommand(command)
      })
      assert.equal(request.params?.command, 'java.navigate.openTypeHierarchy')
      assert.equal(JSON.parse(request.params?.arguments?.[0]).textDocument.uri, javaDocumentUri)
      assert.equal(JSON.parse(request.params?.arguments?.[1]), direction)
    }
  })

  it('sends one notification for every selected project', async () => {
    const uris = [Uri.parse('file:///virtual/one'), Uri.parse('file:///virtual/two')]
    const [, notification] = await executeAndWaitForNotification('java/projectConfigurationsUpdate', () => {
      return commands.executeCommand('java.projectConfiguration.update', uris)
    })
    assert.deepEqual(plain(notification.params), {
      identifiers: uris.map(uri => ({ uri: uri.toString() })),
    })
  })
})

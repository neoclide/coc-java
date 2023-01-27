'use strict'

import { commands, Emitter, Uri } from 'coc.nvim'
import { Commands } from './commands'
import { GetDocumentSymbolsCommand, getDocumentSymbolsProvider } from './documentSymbols'
import { ClasspathQueryOptions, ClasspathResult, ClientStatus, ExtensionAPI, extensionApiVersion } from './extension.api'
import { GoToDefinitionCommand, goToDefinitionProvider } from './goToDefinition'
import { registerHoverCommand } from './hoverAction'
import { RequirementsData } from './requirements'
import { ServerMode } from './settings'

class ApiManager {

  private api: ExtensionAPI
  private onDidClasspathUpdateEmitter: Emitter<Uri> = new Emitter<Uri>();
  private onDidServerModeChangeEmitter: Emitter<ServerMode> = new Emitter<ServerMode>();
  private onDidProjectsImportEmitter: Emitter<Uri[]> = new Emitter<Uri[]>();
  private serverReadyPromiseResolve: (result: boolean) => void

  public initialize(requirements: RequirementsData, serverMode: ServerMode): void {
    const getDocumentSymbols: GetDocumentSymbolsCommand = getDocumentSymbolsProvider()
    const goToDefinition: GoToDefinitionCommand = goToDefinitionProvider()

    const getProjectSettings = async (uri: string, settingKeys: string[]) => {
      return await commands.executeCommand<Object>(Commands.EXECUTE_WORKSPACE_COMMAND, Commands.GET_PROJECT_SETTINGS, uri, settingKeys)
    }

    const getClasspaths = async (uri: string, options: ClasspathQueryOptions) => {
      return await commands.executeCommand<ClasspathResult>(Commands.EXECUTE_WORKSPACE_COMMAND, Commands.GET_CLASSPATHS, uri, JSON.stringify(options))
    }

    const isTestFile = async (uri: string) => {
      return await commands.executeCommand<boolean>(Commands.EXECUTE_WORKSPACE_COMMAND, Commands.IS_TEST_FILE, uri)
    }

    const onDidClasspathUpdate = this.onDidClasspathUpdateEmitter.event
    const onDidServerModeChange = this.onDidServerModeChangeEmitter.event
    const onDidProjectsImport = this.onDidProjectsImportEmitter.event

    const serverReadyPromise: Promise<boolean> = new Promise<boolean>((resolve) => {
      this.serverReadyPromiseResolve = resolve
    })
    const serverReady = async () => {
      return serverReadyPromise
    }

    this.api = {
      apiVersion: extensionApiVersion,
      javaRequirement: requirements,
      status: ClientStatus.starting,
      registerHoverCommand: registerHoverCommand,
      getDocumentSymbols,
      goToDefinition,
      getProjectSettings,
      getClasspaths,
      isTestFile,
      onDidClasspathUpdate,
      serverMode,
      onDidServerModeChange,
      onDidProjectsImport,
      serverReady,
    }
  }

  public getApiInstance(): ExtensionAPI {
    if (!this.api) {
      throw new Error("API instance is not initialized")
    }

    return this.api
  }

  public fireDidClasspathUpdate(event: Uri): void {
    this.onDidClasspathUpdateEmitter.fire(event)
  }

  public fireDidServerModeChange(event: ServerMode): void {
    this.onDidServerModeChangeEmitter.fire(event)
  }

  public fireDidProjectsImport(event: Uri[]): void {
    this.onDidProjectsImportEmitter.fire(event)
  }

  public updateServerMode(mode: ServerMode): void {
    this.api.serverMode = mode
  }

  public updateStatus(status: ClientStatus): void {
    this.api.status = status
  }

  public resolveServerReadyPromise(): void {
    this.serverReadyPromiseResolve(true)
  }
}

export const apiManager: ApiManager = new ApiManager()

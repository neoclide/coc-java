'use strict'

import { commands, workspace, ConfigurationTarget, ExtensionContext, Uri, window } from 'coc.nvim'
import { Commands } from './commands'
import { getJavaConfiguration } from './utils'

interface Result {
  status: boolean
  message: string
}

interface SourcePath {
  path: string
  displayPath: string
  projectName: string
  projectType: string
}

export interface ListCommandResult extends Result {
  data?: SourcePath[]
}

async function requestFolder(defaultValue: string): Promise<Uri | undefined> {
  const folder = await workspace.nvim.callAsync('coc#util#with_callback', ['input', ['Select Folder: ', defaultValue ?? '', 'dir']]) as string
  if (folder) return Uri.file(folder)
  return undefined
}

// const sourcePath = await workspace.nvim.callAsync('coc#util#with_callback', ['input', ['Source File: ', defaultPath ?? '', 'file']]) as string
export function registerCommands(context: ExtensionContext) {
  context.subscriptions.push(commands.registerCommand(Commands.ADD_TO_SOURCEPATH_CMD, async (uri?: Uri) => {
    if (!uri) uri = await requestFolder(workspace.cwd)
    if (!uri) return
    const result = await <any>commands.executeCommand(Commands.EXECUTE_WORKSPACE_COMMAND, Commands.ADD_TO_SOURCEPATH, uri.toString())
    if (result.status) {
      if (result.sourcePaths) {
        getJavaConfiguration().update('project.sourcePaths', result.sourcePaths, ConfigurationTarget.WorkspaceFolder)
      }
      window.showInformationMessage(result.message ? result.message : 'Successfully added the folder to the source path.')
    } else {
      window.showErrorMessage(result.message)
    }
  }))

  context.subscriptions.push(commands.registerCommand(Commands.REMOVE_FROM_SOURCEPATH_CMD, async (uri?: Uri) => {
    if (!uri) uri = await requestFolder(workspace.cwd)
    if (!uri) return
    const result = await <any>commands.executeCommand(Commands.EXECUTE_WORKSPACE_COMMAND, Commands.REMOVE_FROM_SOURCEPATH, uri.toString())
    if (result.status) {
      if (result.sourcePaths) {
        getJavaConfiguration().update('project.sourcePaths', result.sourcePaths, ConfigurationTarget.WorkspaceFolder)
      }
      window.showInformationMessage(result.message ? result.message : 'Successfully removed the folder from the source path.')
    } else {
      window.showErrorMessage(result.message)
    }
  }))

  context.subscriptions.push(commands.registerCommand(Commands.LIST_SOURCEPATHS_CMD, async () => {
    const result: ListCommandResult = await commands.executeCommand<ListCommandResult>(Commands.EXECUTE_WORKSPACE_COMMAND, Commands.LIST_SOURCEPATHS)
    if (result.status) {
      if (!result.data || !result.data.length) {
        window.showInformationMessage("No Java source directories found in the workspace, please use the command 'Add Folder to Java Source Path' first.")
      } else {
        window.showQuickPick(result.data.map(sourcePath => {
          return {
            label: sourcePath.displayPath,
            detail: `$(file-directory) ${sourcePath.projectType} Project: ${sourcePath.projectName}`,
          }
        }), { placeholder: 'All Java source directories recognized by the workspace.' })
      }
    } else {
      window.showErrorMessage(result.message)
    }
  }))
}

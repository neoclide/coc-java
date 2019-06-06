'use strict'

import { commands, Uri, ExtensionContext, workspace } from 'coc.nvim'
import { Commands } from './commands'

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

interface ListCommandResult extends Result {
  data?: SourcePath[]
}

export function registerCommands(context: ExtensionContext): void {
  context.subscriptions.push(commands.registerCommand(Commands.ADD_TO_SOURCEPATH, async (uri: Uri) => {
    const result = await Promise.resolve(commands.executeCommand(Commands.EXECUTE_WORKSPACE_COMMAND, Commands.ADD_TO_SOURCEPATH, uri.toString())) as any
    if (!result) return
    if (result.status) {
      workspace.showMessage(result.message ? result.message : 'Successfully added the folder to the source path.', 'more')
    } else {
      workspace.showMessage(result.message, 'error')
    }
  }, null, true))

  context.subscriptions.push(commands.registerCommand(Commands.REMOVE_FROM_SOURCEPATH, async (uri: Uri) => {
    const result = await Promise.resolve(commands.executeCommand(Commands.EXECUTE_WORKSPACE_COMMAND, Commands.REMOVE_FROM_SOURCEPATH, uri.toString())) as any
    if (!result) return
    if (result.status) {
      workspace.showMessage(result.message ? result.message : 'Successfully remove the folder from the source path.', 'more')
    } else {
      workspace.showMessage(result.message, 'error')
    }
  }, null, true))

  context.subscriptions.push(commands.registerCommand(Commands.LIST_SOURCEPATHS, async () => {
    const result = await Promise.resolve(commands.executeCommand(Commands.EXECUTE_WORKSPACE_COMMAND, Commands.LIST_SOURCEPATHS)) as any
    if (!result) return
    if (result.status) {
      if (!result.data || !result.data.length) {
        workspace.showMessage("No Java source directories found in the workspace, please use the command 'Add Folder to Java Source Path' first.", 'warning')
      } else {
        let res = await workspace.showQuickpick(result.data.map(sourcePath => {
          return sourcePath.displayPath
        }), 'All Java source directories recognized by the workspace.')
      }
    } else {
      workspace.showMessage(result.message, 'error')
    }
  }))
}

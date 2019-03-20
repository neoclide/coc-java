'use strict'

import { commands, workspace, ExtensionContext, LanguageClient } from 'coc.nvim'
import { CodeActionParams } from 'vscode-languageserver-protocol'
import { Commands } from './commands'
import { applyWorkspaceEdit } from './index'
import { ListOverridableMethodsRequest, AddOverridableMethodsRequest, CheckHashCodeEqualsStatusRequest, GenerateHashCodeEqualsRequest } from './protocol'

export function registerCommands(languageClient: LanguageClient, context: ExtensionContext): void {
  registerOverrideMethodsCommand(languageClient, context)
  registerHashCodeEqualsCommand(languageClient, context)
}

function registerOverrideMethodsCommand(languageClient: LanguageClient, context: ExtensionContext): void {
  context.subscriptions.push(commands.registerCommand(Commands.OVERRIDE_METHODS_PROMPT, async (params: CodeActionParams) => {
    const result = await Promise.resolve(languageClient.sendRequest(ListOverridableMethodsRequest.type, params))
    if (!result || !result.methods || !result.methods.length) {
      workspace.showMessage('No overridable methods found in the super type.', 'warning')
      return
    }

    result.methods.sort((a, b) => {
      const declaringClass = a.declaringClass.localeCompare(b.declaringClass)
      if (declaringClass !== 0) {
        return declaringClass
      }

      const methodName = a.name.localeCompare(b.name)
      if (methodName !== 0) {
        return methodName
      }

      return a.parameters.length - b.parameters.length
    })

    const quickPickItems: string[] = result.methods.map(method => {
      return `${method.name}(${method.parameters.join(',')})`
    })

    const res = await workspace.showQuickpick(quickPickItems, `Select methods to override or implement in ${result.type}`)
    if (res == -1) return
    let item = result.methods[res]

    const workspaceEdit = await Promise.resolve(languageClient.sendRequest(AddOverridableMethodsRequest.type, {
      context: params,
      overridableMethods: [item]
    }))
    await applyWorkspaceEdit(workspaceEdit)
  }))
}

function registerHashCodeEqualsCommand(languageClient: LanguageClient, context: ExtensionContext): void {
  context.subscriptions.push(commands.registerCommand(Commands.HASHCODE_EQUALS_PROMPT, async (params: CodeActionParams) => {
    const result = await Promise.resolve(languageClient.sendRequest(CheckHashCodeEqualsStatusRequest.type, params))
    if (!result || !result.fields || !result.fields.length) {
      workspace.showMessage(`The operation is not applicable to the type ${result.type}.`, 'error')
      return
    }

    let regenerate = false
    if (result.existingMethods && result.existingMethods.length) {
      const ans = await workspace.showPrompt(`Methods ${result.existingMethods.join(' and ')} already ${result.existingMethods.length === 1 ? 'exists' : 'exist'} in the Class '${result.type}'. `
        + 'Do you want to regenerate the implementation?')
      if (!ans) return

      regenerate = true
    }

    const fieldItems = result.fields.map(field => {
      return `${field.name}: ${field.type}`
      // return {
      //   label:
      //   picked: true,
      //   originalField: field
      // }
    })

    const idx = await workspace.showQuickpick(fieldItems, 'Select the fields to include in the hashCode() and equals() methods.')
    if (idx == -1) return
    let item = result.fields[idx]

    const workspaceEdit = await Promise.resolve(languageClient.sendRequest(GenerateHashCodeEqualsRequest.type, {
      context: params,
      fields: [item],
      regenerate
    }))
    await applyWorkspaceEdit(workspaceEdit)
  }))
}

'use strict'

import { commands, ExtensionContext, LanguageClient, workspace } from 'coc.nvim'
import { CodeActionParams, Range } from 'vscode-languageserver-protocol'
import { Commands } from './commands'
import { applyWorkspaceEdit } from './index'
import { AddOverridableMethodsRequest, CheckConstructorsResponse, CheckConstructorStatusRequest, CheckDelegateMethodsStatusRequest, CheckHashCodeEqualsStatusRequest, CheckToStringStatusRequest, GenerateAccessorsRequest, GenerateConstructorsRequest, GenerateDelegateMethodsRequest, GenerateHashCodeEqualsRequest, GenerateToStringRequest, ImportCandidate, ImportSelection, ListOverridableMethodsRequest, OrganizeImportsRequest, ResolveUnimplementedAccessorsRequest, VariableBinding } from './protocol'

export function registerCommands(languageClient: LanguageClient, context: ExtensionContext): void {
  registerOverrideMethodsCommand(languageClient, context)
  registerHashCodeEqualsCommand(languageClient, context)
  registerOrganizeImportsCommand(languageClient, context)
  registerChooseImportCommand(context)
  registerGenerateToStringCommand(languageClient, context)
  registerGenerateAccessorsCommand(languageClient, context)
  registerGenerateConstructorsCommand(languageClient, context)
  registerGenerateDelegateMethodsCommand(languageClient, context)
}

async function multiselectItems<T>(items: T[], labelGenerator: (_: T) => string, text: string): Promise<T[]> {
  let result = []
  let itemsCopy = [...items]
  let options = ["Select all", "Cancel", ...items.map(labelGenerator)]

  while (itemsCopy.length > 0) {
    let idx = await workspace.showQuickpick(options, text)

    if (idx == -1) {
      break
    }

    if(idx >= options.length){
      continue
    }

    switch (idx) {
      case 0: return items
      case 1: return undefined
    }

    let translatedIdx = idx - 2

    result.push(itemsCopy[translatedIdx])
    itemsCopy.splice(translatedIdx, 1)
    options.splice(idx, 1)
  }

  return result
}

function registerOverrideMethodsCommand(languageClient: any, context: ExtensionContext): void {
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

    const methods: Array<{ name: string; parameters: Array<any> }> = result.methods

    const selection = await multiselectItems(methods,
      m => `${m.name}(${m.parameters.join(',')})`,
      `Select methods to override or implement in ${result.type}`)

    if (selection === undefined) {
      return
    }

    const workspaceEdit = await Promise.resolve(languageClient.sendRequest(AddOverridableMethodsRequest.type, {
      context: params,
      overridableMethods: selection
    }))
    await applyWorkspaceEdit(workspaceEdit)
  }))
}

function registerHashCodeEqualsCommand(languageClient: any, context: ExtensionContext): void {
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
    let fields: Array<{ name: string, type: any }> = result.fields

    const selection = await multiselectItems(fields, f => `${f.name}: ${f.type}`, 'Select the fields to include in the hashCode() and equals() methods.')

    if (selection === undefined) {
      return
    }

    const workspaceEdit = await Promise.resolve(languageClient.sendRequest(GenerateHashCodeEqualsRequest.type, {
      context: params,
      fields: selection,
      regenerate
    }))
    await applyWorkspaceEdit(workspaceEdit)
  }))
}

function registerOrganizeImportsCommand(languageClient: any, context: ExtensionContext): void {
  context.subscriptions.push(commands.registerCommand(Commands.ORGANIZE_IMPORTS, async () => {
    let doc = workspace.getDocument(workspace.bufnr)
    let params: CodeActionParams = {
      textDocument: {
        uri: doc.uri
      },
      range: Range.create(0, 0, doc.lineCount, 0),
      context: { diagnostics: [] },
    }
    const workspaceEdit = await Promise.resolve(languageClient.sendRequest(OrganizeImportsRequest.type, params))
    await applyWorkspaceEdit(workspaceEdit)
  }, null, true))
}

function registerChooseImportCommand(context: ExtensionContext): void {
  context.subscriptions.push(commands.registerCommand(Commands.CHOOSE_IMPORTS, async (_uri: string, selections: ImportSelection[]) => {
    const chosen: ImportCandidate[] = []
    // tslint:disable-next-line: prefer-for-of
    for (let i = 0; i < selections.length; i++) {
      const selection: ImportSelection = selections[i]
      // Move the cursor to the code line with ambiguous import choices.
      await workspace.moveTo(selection.range.start)
      const candidates: ImportCandidate[] = selection.candidates
      const fullyQualifiedName = candidates[0].fullyQualifiedName
      const typeName = fullyQualifiedName.substring(fullyQualifiedName.lastIndexOf(".") + 1)
      try {
        let res = await workspace.showQuickpick(candidates.map(o => o.fullyQualifiedName), `Choose type '${typeName}' to import`)
        if (res == -1) {
          chosen.push(null)
          continue
        }
        chosen.push(candidates[res])
      } catch (err) {
        break
      }
    }

    return chosen
  }, null, true))
}

function registerGenerateAccessorsCommand(languageClient: any, context: ExtensionContext): void {
  // selector: DocumentSelector, provider: CodeActionProvider, clientId: string, codeActionKinds?: CodeActionKind[]
  context.subscriptions.push(commands.registerCommand(Commands.GENERATE_ACCESSORS_PROMPT, async (params: CodeActionParams) => {
    const accessors = await Promise.resolve(languageClient.sendRequest(ResolveUnimplementedAccessorsRequest.type, params))
    if (!accessors || !accessors.length) {
      return
    }

    const accessorItems: Array<{ label: string; description: string; originalField: VariableBinding }> =
      accessors.map(accessor => {
        const description = []
        if (accessor.generateGetter) {
          description.push('getter')
        }
        if (accessor.generateSetter) {
          description.push('setter')
        }
        return {
          label: accessor.fieldName,
          description: (accessor.isStatic ? 'static ' : '') + description.join(', '),
          originalField: accessor,
        }
      })

    let selection = await multiselectItems(accessorItems, o => o.label, 'Select the fields to generate getters and setters.')

    if (selection === undefined) {
      return
    }

    const selectedAccessors = selection.map(item => item.originalField)

    const workspaceEdit = await Promise.resolve(languageClient.sendRequest(GenerateAccessorsRequest.type, {
      context: params,
      accessors: selectedAccessors,
    }))
    await applyWorkspaceEdit(workspaceEdit)
  }, null, true))
}

function registerGenerateToStringCommand(languageClient: any, context: ExtensionContext): void {
  context.subscriptions.push(commands.registerCommand(Commands.GENERATE_TOSTRING_PROMPT, async (params: CodeActionParams) => {
    const result = await Promise.resolve(languageClient.sendRequest(CheckToStringStatusRequest.type, params))
    if (!result) {
      return
    }

    if (result.exists) {
      const ans = await workspace.showPrompt(`Method 'toString()' already exists in the Class '${result.type}'. `
        + 'Do you want to replace the implementation?')
      if (!ans) {
        return
      }
    }

    let fields: VariableBinding[] = []
    if (result.fields && result.fields.length) {
      const fieldItems: Array<{ label: string; originalField: VariableBinding }> =
        result.fields.map(field => {
          return {
            label: `${field.name}: ${field.type}`,
            originalField: field
          }
        })

      let selection = await multiselectItems(fieldItems, o => o.label, 'Select the fields to include in the toString() method.')

      if (selection === undefined) {
        return
      }

      fields = selection.map(i => i.originalField)
    }

    const workspaceEdit = await Promise.resolve(languageClient.sendRequest(GenerateToStringRequest.type, {
      context: params,
      fields,
    }))
    await applyWorkspaceEdit(workspaceEdit)
  }, null, true))
}


function registerGenerateConstructorsCommand(languageClient: LanguageClient, context: ExtensionContext): void {
  context.subscriptions.push(commands.registerCommand(Commands.GENERATE_CONSTRUCTORS_PROMPT, async (params: CodeActionParams) => {
    const status = await Promise.resolve(languageClient.sendRequest(CheckConstructorStatusRequest.type as any, params)) as CheckConstructorsResponse
    if (!status || !status.constructors || !status.constructors.length) {
      return
    }

    let selectedConstructors = status.constructors
    let selectedFields = []

    if (status.constructors.length > 1) {
      const constructorItems = status.constructors.map(constructor => {
        return {
          label: `${constructor.name}(${constructor.parameters.join(',')})`,
          originalConstructor: constructor,
        }
      })
      let idx = await workspace.showQuickpick(constructorItems.map(o => o.label), 'Select super class constructor(s).')
      if (idx == -1) return

      selectedConstructors = [constructorItems[idx]].map(item => item.originalConstructor)
    }

    if (status.fields.length) {
      const fieldItems = status.fields.map(field => {
        return {
          label: `${field.name}: ${field.type}`,
          originalField: field,
        }
      })

      let selectionResult = await multiselectItems(fieldItems, o => o.label, 'Select fields to initialize by constructor(s).')

      if (selectionResult === undefined) {
        return;
      }

      selectedFields = selectionResult.map(i => i.originalField)
    }

    const workspaceEdit = await Promise.resolve(languageClient.sendRequest(GenerateConstructorsRequest.type as any, {
      context: params,
      constructors: selectedConstructors,
      fields: selectedFields,
    })) as any
    await applyWorkspaceEdit(workspaceEdit)
  }))
}

function registerGenerateDelegateMethodsCommand(languageClient: LanguageClient, context: ExtensionContext): void {
  context.subscriptions.push(commands.registerCommand(Commands.GENERATE_DELEGATE_METHODS_PROMPT, async (params: CodeActionParams) => {
    const status = await Promise.resolve(languageClient.sendRequest(CheckDelegateMethodsStatusRequest.type as any, params)) as any
    if (!status || !status.delegateFields || !status.delegateFields.length) {
      workspace.showMessage("All delegatable methods are already implemented.", 'warning')
      return
    }

    let selectedDelegateField = status.delegateFields[0]
    if (status.delegateFields.length > 1) {
      const fieldItems = status.delegateFields.map(delegateField => {
        return {
          label: `${delegateField.field.name}: ${delegateField.field.type}`,
          originalField: delegateField,
        }
      })
      let idx = await workspace.showQuickpick(fieldItems.map(o => o.label), 'Select target to generate delegates for.')
      if (idx == -1) {
        return
      }

      selectedDelegateField = fieldItems[idx].originalField
    }

    let delegateEntryItems: Array<{ label: string; originalField: any; originalMethod: any }> =
      selectedDelegateField.delegateMethods.map(delegateMethod => {
        return {
          label: `${selectedDelegateField.field.name}.${delegateMethod.name}(${delegateMethod.parameters.join(',')})`,
          originalField: selectedDelegateField.field,
          originalMethod: delegateMethod,
        }
      })

    if (!delegateEntryItems.length) {
      workspace.showMessage("All delegatable methods are already implemented.", 'warning')
      return
    }

    let selection = await multiselectItems(delegateEntryItems, o => o.label, 'Select methods to generate delegates for.')

    if (selection === undefined) {
      return
    }

    const delegateEntries = selection.map(item => {
      return {
        field: item.originalField,
        delegateMethod: item.originalMethod,
      }
    })
    const workspaceEdit = await Promise.resolve(languageClient.sendRequest(GenerateDelegateMethodsRequest.type as any, {
      context: params,
      delegateEntries,
    }))
    await applyWorkspaceEdit(workspaceEdit)
  }))
}

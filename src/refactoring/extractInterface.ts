'use strict'

import { LanguageClient, window, Uri, workspace, QuickPickItem } from "coc.nvim"
import { CheckExtractInterfaceStatusRequest, CheckExtractInterfaceStatusResponse, RefactorWorkspaceEdit } from "../protocol"

enum Step {
  selectMember,
  specifyInterfaceName,
  selectPackage,
}

export async function getExtractInterfaceArguments(languageClient: LanguageClient, params: any): Promise<any[]> {
  if (!params || !params.range) {
    return []
  }
  const extractInterfaceResponse: CheckExtractInterfaceStatusResponse = await languageClient.sendRequest(CheckExtractInterfaceStatusRequest.type, params)
  if (!extractInterfaceResponse) {
    return []
  }
  let step: Step = Step.selectMember
  // step results, initialized as undefined
  let resultHandleIdentifiers: any[] | undefined
  let interfaceName: string | undefined
  let selectPackageNodeItem: SelectPackageQuickPickItem | undefined
  while (step !== undefined) {
    switch (step) {
      case Step.selectMember:
        const items = extractInterfaceResponse.members.map((item) => {
          return {
            label: item.parameters ? `${item.name}(${item.parameters.join(", ")})` : item.name,
            description: item.typeName,
            handleIdentifier: item.handleIdentifier,
            picked: resultHandleIdentifiers === undefined ? false : resultHandleIdentifiers.includes(item.handleIdentifier),
          }
        })
        const members = await window.showQuickPick(items, {
          title: "Extract Interface (1/3): Select members",
          placeholder: "Please select members to declare in the interface: ",
          // ignoreFocusOut: true,
          matchOnDescription: true,
          canPickMany: true,
        })
        if (!members) {
          return []
        }
        resultHandleIdentifiers = members.map((item) => item.handleIdentifier)
        if (!resultHandleIdentifiers) {
          return []
        }
        step = Step.specifyInterfaceName
        break
      case Step.specifyInterfaceName:
        const specifyInterfaceNameDisposables = []
        const specifyInterfaceNamePromise = new Promise<string | boolean | undefined>(async (resolve, _reject) => {
          const inputBox = await window.createInputBox('Extract Interface (2/3): Specify interface name',
            interfaceName === undefined ? extractInterfaceResponse.subTypeName : interfaceName,
            {
              placeholder: "Please specify the new interface name: ",
            })
          // inputBox.ignoreFocusOut = true
          // inputBox.buttons = [(vscode.QuickInputButtons.Back)]
          specifyInterfaceNameDisposables.push(
            inputBox,
            // inputBox.onDidTriggerButton((button) => {
            //   if (button === vscode.QuickInputButtons.Back) {
            //     step = Step.selectMember
            //     resolve(false)
            //   }
            // }),
            inputBox.onDidFinish(value => {
              if (!value) return resolve(undefined)
              resolve(value)
            })
          )
          // inputBox.show()
        })
        try {
          const result = await specifyInterfaceNamePromise
          if (result === false) {
            // go back
            step = Step.selectMember
          } else if (result === undefined) {
            // cancelled
            return []
          } else {
            interfaceName = result as string
            step = Step.selectPackage
          }
        } finally {
          specifyInterfaceNameDisposables.forEach(d => d.dispose())
        }
        break
      case Step.selectPackage:
        const selectPackageDisposables = []
        const packageNodeItems = extractInterfaceResponse.destinationResponse.destinations.sort((node1, node2) => {
          return node1.isParentOfSelectedFile ? -1 : 0
        }).map((packageNode) => {
          const packageUri: Uri = packageNode.uri ? Uri.parse(packageNode.uri) : null
          const displayPath: string = packageUri ? workspace.asRelativePath(packageUri, true) : packageNode.path
          return {
            label: (packageNode.isParentOfSelectedFile ? '* ' : '') + packageNode.displayName,
            description: displayPath,
            packageNode,
          }
        })
        const selectPackagePromise = new Promise<SelectPackageQuickPickItem | boolean | undefined>(async (resolve, _reject) => {
          const quickPick = await window.createQuickPick<SelectPackageQuickPickItem>()
          quickPick.items = packageNodeItems
          quickPick.title = "Extract Interface (3/3): Specify package"
          // quickPick.width = "Please select the target package for extracted interface."
          // quickPick.buttons = [(vscode.QuickInputButtons.Back)]
          selectPackageDisposables.push(
            quickPick,
            quickPick.onDidFinish(items => {
              if (items.length > 0) {
                return resolve(items[0])
              }
              resolve(undefined)
            }),
          )
          quickPick.show()
        })
        try {
          const result = await selectPackagePromise
          if (result === false) {
            // go back
            step = Step.specifyInterfaceName
          } else if (result === undefined) {
            // cancelled
            return []
          } else {
            selectPackageNodeItem = result as SelectPackageQuickPickItem
            step = undefined
          }
        } finally {
          selectPackageDisposables.forEach(d => d.dispose())
        }
        break
      default:
        return []
    }
  }
  return [resultHandleIdentifiers, interfaceName, selectPackageNodeItem.packageNode]
}

export async function revealExtractedInterface(refactorEdit: RefactorWorkspaceEdit) {
  if (refactorEdit?.edit?.documentChanges) {
    for (const change of refactorEdit.edit.documentChanges) {
      if ("kind" in change && change.kind === "create") {
        for (const document of workspace.textDocuments) {
          if (document.uri.toString() === Uri.parse(change.uri).toString()) {
            await workspace.jumpTo(document.uri)
            // await window.showTextDocument(document)
            return
          }
        }
      }
    }
  }
}

interface SelectPackageQuickPickItem extends QuickPickItem {
  packageNode: any
}

'use strict'

import { Buffer, FormattingOptions, LanguageClient, Window, nvim, workspace } from "coc.nvim"
import { CodeActionParams } from 'vscode-languageserver-protocol'
import { GetRefactorEditRequest, RefactorWorkspaceEdit } from "../protocol"
import { applyRefactorEdit } from '../standardLanguageClientUtils'

function computeParamValue(type: string, value: any) {
  if (value === null || value.length === 0) {
    switch (type) {
      case "int":
      case "byte":
      case "long":
      case "float":
      case "double":
        value = "0"
        break
      case "boolean":
        value = "false"
        break
      default:
        value = "null"
        break
    }
  }
  return value
}

function readLineUserValue(line: string) {
  const separator = line.lastIndexOf(":")
  const whitespace = line.lastIndexOf(" ")
  const index = Math.max(separator, whitespace)
  return line.substring(index + 1)
}

export async function renderChangeSignaturePanel(languageClient: LanguageClient, command: string, params: CodeActionParams, formattingOptions: FormattingOptions, signature: any): Promise<void> {
  const highlightsNamespace: number = await nvim.createNamespace("changeSignatureNamespace")
  const buffer: Buffer = await nvim.createNewBuffer(false, true)

  const data: string[] = [
    `Access type: ${signature.modifier}`,
    `Method name: ${signature.methodName}`,
    `Return type: ${signature.returnType}`,
    `Parameters:`,
  ]
  for (const param of signature.parameters ?? []) {
    data.push(`- ${param.originalIndex}: ${param.type} ${param.name}`)
  }

  const cols: number = parseInt(await nvim.exec("echo &columns", true), 10)
  const rows: number = parseInt(await nvim.exec("echo &lines", true), 10)

  const width = Math.floor(cols * 0.65)
  const height = Math.floor(rows * 0.50)
  const header = "-".repeat(Math.max(width, 3))

  const hint: string[] = [
    header,
    "Labels are used to parse the values. Keep them!",
    "Accept the change & close the window: [n]<cr>",
    "Abort the change & close the window: [n]<q>",
    "Parameters:",
    " - Definition is order sensitive",
    " - New param format: `- <type> <name> [value]`",
    " - Existing param format: `- <n>: <type> <name>`",
    "   * [value] default value for new paramters",
    "   * `-` keep dash prefix for all paramters",
    "   * <n> marks the original paramter index",
    "   * don't change index for moved params",
    "   * don't add index for new entries",
  ]

  const lines = data.concat(hint)
  buffer.setLines(lines)

  buffer.setOption('bufhidden', "wipe")
  buffer.setOption('buftype', "nofile")
  buffer.setOption('filetype', "refactor")

  buffer.setOption('modified', false)
  buffer.setOption('modifiable', true)

  const close = async () => {
    nvim.command('close', true)
  }

  const refactor = async () => {
    const lines: string[] = await buffer.getLines()
    let isDelegate = false
    let accessType = signature.modifier
    let methodName = signature.methodName
    let returnType = signature.returnType
    let preview = false
    let expectNextParam = false
    let parameters: any[] = []
    let newParamIndex = signature.parameters.length
    for (const line of lines ?? []) {
      if (line.startsWith("---")) {
        break
      } else if (expectNextParam && line.startsWith("- ")) {
        let match = RegExp(/- (\d+:) ([^ ]+) (\w+)/).exec(line)
        if (match) {
          let [_, index, type, name] = match
          parameters.push({
            name: name,
            type: type,
            originalIndex: parseInt(index),
          })
        } else {
          let match = RegExp(/- ([^ ]+) (\w+) ?(.*)/).exec(line)
          if (match) {
            let [_, type, name, value] = match
            value = computeParamValue(type, value)
            parameters.push({
              type: type,
              name: name,
              defaultValue: value,
              originalIndex: newParamIndex
            })
            newParamIndex++
          }
        }
      } else if (line.startsWith("Access type:")) {
        accessType = readLineUserValue(line)
      } else if (line.startsWith("Method name:")) {
        methodName = readLineUserValue(line)
      } else if (line.startsWith("Parameters:")) {
        expectNextParam = true
      } else if (line.startsWith("Return type:")) {
        returnType = readLineUserValue(line)
      }
    }

    const clientWorkspaceEdit: RefactorWorkspaceEdit = await languageClient.sendRequest(GetRefactorEditRequest.type, {
      command: command,
      context: params,
      options: formattingOptions,
      commandArguments: [signature.methodIdentifier, isDelegate, methodName, accessType, returnType, parameters, signature.exceptions, preview]
    })

    if (clientWorkspaceEdit?.edit) {
      await applyRefactorEdit(languageClient, clientWorkspaceEdit)
    }
    close()
  }

  workspace.registerLocalKeymap(buffer.id, "n", "<cr>", refactor, true)
  workspace.registerLocalKeymap(buffer.id, "n", "q", close, true)

  const highlights: any[][] = [
    [0, "Access type:", "Identifier", signature.modifier, "Keyword"],
    [1, "Method name:", "Identifier", signature.methodName, "Title"],
    [2, "Return type:", "Identifier", signature.returnType, "Type"],
    [3, "Parameters:", "Identifier", "", "Type"],
  ]

  for (const hl of highlights ?? []) {
    buffer.setExtMark(highlightsNamespace, hl[0], 0, {
      end_col: hl[1].length,
      end_line: hl[0],
      hl_group: hl[2],
    })

    buffer.setExtMark(highlightsNamespace, hl[0], hl[1].length, {
      end_col: hl[1].length + hl[3].length + 1,
      end_line: hl[0],
      hl_group: hl[4],
    })
  }

  buffer.setExtMark(highlightsNamespace, data.length, 0, {
    hl_group: "Comment",
    end_line: lines.length
  })

  const win: Window = await nvim.openFloatWindow(buffer, true, {
    style: 'minimal',
    border: 'single',
    relative: 'editor',
    focusable: true,
    height: height,
    width: width,
    row: Math.floor((rows - height) * 0.5),
    col: Math.floor((cols - width) * 0.5),
  })

  win.setOption('list', false)
  win.setOption('number', false)
  win.setOption('fillchars', "eob: ")
  win.setOption('relativenumber', false)
}

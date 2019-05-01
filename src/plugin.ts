'use strict'

import { extensions, workspace } from 'coc.nvim'
import * as path from 'path'

const exists: Set<string> = new Set()

export function collectionJavaExtensions(): string[] {
  let result = []
  extensions.all.forEach(extension => {
    let contributesSection = extension.packageJSON['contributes']
    if (contributesSection) {
      let javaExtensions = contributesSection['javaExtensions']
      if (Array.isArray(javaExtensions) && javaExtensions.length) {
        for (let javaExtensionPath of javaExtensions) {
          exists.add(extension.id)
          result.push(path.resolve(extension.extensionPath, javaExtensionPath))
        }
      }
    }
  })
  return result
}

export function onExtensionChange(): void {
  let changed = false
  let ids = extensions.all.filter(ext => {
    let contributesSection = ext.packageJSON['contributes']
    return contributesSection && Array.isArray(contributesSection['javaExtensions'])
  }).map(ext => ext.id)
  if (ids.length != exists.size) {
    changed = true
  }
  for (let id of ids) {
    if (!exists.has(id)) {
      changed = true
    }
  }
  if (changed) {
    workspace.showMessage(`Extensions to the Java Language Server changed, reloading coc.nvim required.`)
    workspace.nvim.command(`CocRestart`, true)
  }
}

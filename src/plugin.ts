'use strict'

import { extensions } from 'coc.nvim'
import * as path from 'path'

export function collectionJavaExtensions(): string[] {
  let result = []
  extensions.all.forEach(extension => {
    let contributesSection = extension.packageJSON['contributes']
    if (contributesSection) {
      let javaExtensions = contributesSection['javaExtensions']
      if (Array.isArray(javaExtensions) && javaExtensions.length) {
        for (let javaExtensionPath of javaExtensions) {
          result.push(path.resolve(extension.extensionPath, javaExtensionPath))
        }
      }
    }
  })
  return result
}

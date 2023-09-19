'use strict'

import { commands, Extension, extensions, window } from 'coc.nvim'
import * as path from 'path'
import { Commands } from './commands'
import { getJavaConfiguration } from './utils'

export let existingExtensions: Array<string> = []
export let buildFilePatterns: Array<string> = []

export function collectJavaExtensions(extensions: readonly Extension<any>[]): string[] {
  const result = []
  if (extensions && extensions.length) {
    for (const extension of extensions) {
      const contributesSection = extension.packageJSON['contributes']
      if (contributesSection) {
        const javaExtensions = contributesSection['javaExtensions']
        if (Array.isArray(javaExtensions) && javaExtensions.length) {
          for (const javaExtensionPath of javaExtensions) {
            result.push(path.resolve(extension.extensionPath, javaExtensionPath))
          }
        }
      }
    }
  }
  const userBundles = getJavaConfiguration().get<string[]>("jdt.ls.bundles")
  for (const bundle of userBundles) {
    result.push(bundle)
  }
  // Make a copy of extensions:
  existingExtensions = result.slice()
  return result
}

export function collectBuildFilePattern(extensions: readonly Extension<any>[]) {
  const result = []
  if (extensions && extensions.length) {
    for (const extension of extensions) {
      const contributesSection = extension.packageJSON['contributes']
      if (contributesSection) {
        const buildFilePatterns = contributesSection['javaBuildFilePatterns']
        if (Array.isArray(buildFilePatterns) && buildFilePatterns.length) {
          result.push(...buildFilePatterns)
        }
      }
    }
  }
  buildFilePatterns = result.slice()
  return result
}

export function getBundlesToReload(): string[] {
  const previousContributions: string[] = [...existingExtensions]
  const currentContributions = collectJavaExtensions(extensions.all)
  if (isContributedPartUpdated(previousContributions, currentContributions)) {
    return currentContributions
  }

  return []
}

export async function onExtensionChange(extensions: readonly Extension<any>[]): Promise<void> {
  if (isContributedPartUpdated(buildFilePatterns, collectBuildFilePattern(extensions))) {
    return promptToReload()
  }

  const bundlesToRefresh: string[] = getBundlesToReload()
  if (bundlesToRefresh.length) {
    const success = await commands.executeCommand(Commands.EXECUTE_WORKSPACE_COMMAND, Commands.REFRESH_BUNDLES, bundlesToRefresh)
    if (!success) {
      // if hot refreshing bundle fails, fallback to reload window.
      return promptToReload()
    }
  }
}

function promptToReload() {
  const msg = `Java Extension Contributions changed, reloading coc.nvim is required for the changes to take effect.`
  const action = 'Reload'
  const restartId = Commands.RELOAD_WINDOW
  window.showWarningMessage(msg, action).then((selection) => {
    if (action === selection) {
      commands.executeCommand(restartId)
    }
  })
}

export function isContributedPartUpdated(oldContributedPart: Array<string>, newContributedPart: Array<string>) {
  if (!oldContributedPart) {
    return false
  }
  const oldContribution = new Set(oldContributedPart.slice())
  const newContribution = newContributedPart
  const hasChanged = (oldContribution.size !== newContribution.length)
  if (!hasChanged) {
    for (const newExtension of newContribution) {
      if (!oldContribution.has(newExtension)) {
        return true
      }
    }
  }
  return hasChanged
}

'use strict'

import { commands, ConfigurationTarget, LanguageClient, Position, QuickPickItem, Range, Uri, window, workspace } from 'coc.nvim'
import * as fse from 'fs-extra'
import * as path from 'path'
import { TextDocumentIdentifier } from 'vscode-languageserver-protocol'
import { Commands } from './commands'
import { buildFilePatterns } from './plugin'
import { ProjectConfigurationUpdateRequest } from './protocol'
import { getAllJavaProjects } from './utils'

interface QuickPickItemWithDetail extends QuickPickItem {
  detail: string
}

export async function projectConfigurationUpdate(languageClient: LanguageClient, uris?: TextDocumentIdentifier | Uri | Uri[]) {
  let resources: Uri[] = []
  if (!uris) {
    const uri: string | undefined = window.activeTextEditor?.document.uri
    const activeFileUri: Uri | undefined = uri ? Uri.parse(uri) : undefined

    if (activeFileUri && isJavaConfigFile(activeFileUri.fsPath)) {
      resources = [activeFileUri]
    } else {
      resources = await askForProjects(activeFileUri, "Please select the project(s) to update.")
    }
  } else if (uris instanceof Uri) {
    resources.push(uris)
  } else if (Array.isArray(uris)) {
    for (const uri of uris) {
      if (uri instanceof Uri) {
        resources.push(uri)
      }
    }
  } else if ("uri" in uris) {
    resources.push(Uri.parse(uris.uri))
  }

  if (resources.length === 1) {
    languageClient.sendNotification(ProjectConfigurationUpdateRequest.type, {
      uri: resources[0].toString(),
    })
  } else if (resources.length > 1) {
    languageClient.sendNotification(ProjectConfigurationUpdateRequest.typeV2, {
      identifiers: resources.map(r => {
        return { uri: r.toString() }
      }),
    })
  }
}

function isJavaConfigFile(filePath: string): boolean {
  const fileName = path.basename(filePath)
  if (buildFilePatterns.length == 0) return false
  const regEx = new RegExp(buildFilePatterns.map(r => `(${r})`).join('|'), 'i')
  return regEx.test(fileName)
}

/**
 * Ask user to select projects and return the selected projects' uris.
 * @param activeFileUri the uri of the active file.
 * @param placeHolder message to be shown in quick pick.
 */
export async function askForProjects(activeFileUri: Uri | undefined, placeHolder: string, canPickMany: boolean = true): Promise<Uri[]> {
  const projectPicks = await generateProjectPicks(activeFileUri)
  if (!projectPicks?.length) {
    return []
  } else if (projectPicks.length === 1) {
    return [Uri.file(projectPicks[0].detail)]
  }

  const choices = await window.showQuickPick(projectPicks, {
    matchOnDescription: true,
    placeholder: placeHolder,
    canPickMany: canPickMany,
  })

  if (!choices) {
    return []
  }

  if (Array.isArray(choices)) {
    return choices.map(c => Uri.file(c.detail))
  }

  return [Uri.file(choices.detail)]
}

/**
 * Generate the quick picks for projects selection. An `undefined` value will be return if
 * it's failed to generate picks.
 * @param activeFileUri the uri of the active document.
 */
async function generateProjectPicks(activeFileUri: Uri | undefined): Promise<QuickPickItemWithDetail[] | undefined> {
  let projectUriStrings: string[]
  try {
    projectUriStrings = await getAllJavaProjects()
  } catch (e) {
    return undefined
  }

  const projectPicks: QuickPickItemWithDetail[] = projectUriStrings.map(uriString => {
    const projectPath = Uri.parse(uriString).fsPath
    return {
      label: path.basename(projectPath),
      detail: projectPath,
    }
  }).filter(Boolean)

  // pre-select an active project based on the uri candidate.
  if (activeFileUri?.scheme === "file") {
    const candidatePath = activeFileUri.fsPath
    let belongingIndex = -1
    for (let i = 0; i < projectPicks.length; i++) {
      if (candidatePath.startsWith(projectPicks[i].detail)) {
        if (belongingIndex < 0
          || projectPicks[i].detail.length > projectPicks[belongingIndex].detail.length) {
          belongingIndex = i
        }
      }
    }
    if (belongingIndex >= 0) {
      projectPicks[belongingIndex].picked = true
    }
  }

  return projectPicks
}

export async function upgradeGradle(projectUri: string, version?: string): Promise<void> {
  const useWrapper = workspace.getConfiguration().get<boolean>("java.import.gradle.wrapper.enabled")
  if (!useWrapper) {
    await workspace.getConfiguration().update("java.import.gradle.wrapper.enabled", true, ConfigurationTarget.Workspace)
  }
  const result = await window.withProgress({
    title: "Upgrading Gradle wrapper...",
    cancellable: true,
  }, (_progress, token) => {
    return commands.executeCommand(Commands.EXECUTE_WORKSPACE_COMMAND, "java.project.upgradeGradle", projectUri, version, token)
  })
  if (result) {
    const propertiesFile = path.join(Uri.parse(projectUri).fsPath, "gradle", "wrapper", "gradle-wrapper.properties")
    if (fse.pathExists(propertiesFile)) {
      const content = await fse.readFile(propertiesFile)
      const offset = content.toString().indexOf("distributionUrl")
      if (offset >= 0) {
        const document = await workspace.openTextDocument(propertiesFile)
        const position = document.textDocument.positionAt(offset)
        const distributionUrlRange = document.getWordRangeAtPosition(position)
        await workspace.jumpTo(document.uri)
        await window.selectRange(Range.create(distributionUrlRange.start, Position.create(distributionUrlRange.start.line + 1, 0)))
      }
    }
    commands.executeCommand(Commands.IMPORT_PROJECTS_CMD)
  }
}

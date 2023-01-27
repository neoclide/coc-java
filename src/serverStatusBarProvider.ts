'use strict'

import { Disposable, ExtensionContext, StatusBarItem, window, workspace } from 'coc.nvim'
import { Commands } from './commands'
import { languageServerDocumentSelector, ServerStatusItemFactory, StatusCommands, supportsLanguageStatus } from './languageStatusItemFactory'
import { getJavaConfiguration } from './utils'

class ServerStatusBarProvider implements Disposable {
  private statusBarItem: StatusBarItem & { [key: string]: any }
  private languageStatusItem: any
  // Adopt new API for status bar item, meanwhile keep the compatibility with Theia.
  // See: https://github.com/redhat-developer/vscode-java/issues/1982
  private isAdvancedStatusBarItem: boolean
  private statusIcons: { [key: string]: string }

  constructor() {
    const icons = getJavaConfiguration().get('jdt.ls.statusIcons', {})
    this.statusIcons = icons ?? {}
    this.isAdvancedStatusBarItem = false
  }

  private getIcon(key: 'ready' | 'warning' | 'error'): string {
    let text = this.statusIcons[key]
    if (text) return text
    return StatusIcon[key] ?? ''
  }

  public initialize(context: ExtensionContext): void {
    if (supportsLanguageStatus()) {
      this.languageStatusItem = ServerStatusItemFactory.create()
    } else {
      this.statusBarItem = window.createStatusBarItem(Number.MAX_VALUE)
      window.onDidChangeActiveTextEditor(editor => {
        let doc = editor?.document
        if (doc && workspace.match(languageServerDocumentSelector, doc) > 0) {
          this.statusBarItem?.show()
        } else {
          this.statusBarItem?.hide()
        }
      }, null, context.subscriptions)
    }
  }

  private shouldShow(): boolean {
    let doc = window.activeTextEditor?.document
    return doc && workspace.match(languageServerDocumentSelector, doc) > 0
  }

  public showLightWeightStatus(): void {
    if (supportsLanguageStatus()) {
      ServerStatusItemFactory.showLightWeightStatus(this.languageStatusItem)
    } else {
      if (this.isAdvancedStatusBarItem) {
        (this.statusBarItem as any).name = "Java Server Mode"
      }
      this.statusBarItem.text = StatusIcon.lightWeight
      this.statusBarItem.command = StatusCommands.switchToStandardCommand
      this.statusBarItem.tooltip = "Java language server is running in LightWeight mode, click to switch to Standard mode"
      if (this.shouldShow()) {
        this.statusBarItem.show()
      }
    }
  }

  public showStandardStatus(): void {
    if (supportsLanguageStatus()) {
      ServerStatusItemFactory.showStandardStatus(this.languageStatusItem)
      ServerStatusItemFactory.setBusy(this.languageStatusItem)
    } else {
      if (this.isAdvancedStatusBarItem) {
        (this.statusBarItem as any).name = "Java Server Status"
      }
      this.statusBarItem.isProgress = true
      this.statusBarItem.text = ''
      this.statusBarItem.command = Commands.SHOW_SERVER_TASK_STATUS
      this.statusBarItem.tooltip = ""
      if (this.shouldShow()) {
        this.statusBarItem.show()
      }
    }
  }

  public setBusy(): void {
    if (supportsLanguageStatus()) {
      ServerStatusItemFactory.setBusy(this.languageStatusItem)
    } else {
      this.statusBarItem.isProgress = true
      // this.statusBarItem.text = this.getIcon('busy')
    }
  }

  public setError(): void {
    if (supportsLanguageStatus()) {
      ServerStatusItemFactory.setError(this.languageStatusItem)
    } else {
      this.statusBarItem.isProgress = false
      this.statusBarItem.text = this.getIcon('error')
      this.statusBarItem.command = Commands.OPEN_LOGS
    }
  }

  public setWarning(): void {
    if (supportsLanguageStatus()) {
      ServerStatusItemFactory.setWarning(this.languageStatusItem)
    } else {
      this.statusBarItem.isProgress = false
      this.statusBarItem.text = this.getIcon('warning')
      this.statusBarItem.command = "workbench.panel.markers.view.focus"
      this.statusBarItem.tooltip = "Errors occurred in project configurations, click to show the PROBLEMS panel"
    }
  }

  public setReady(): void {
    if (supportsLanguageStatus()) {
      ServerStatusItemFactory.setReady(this.languageStatusItem)
    } else {
      this.statusBarItem.text = this.getIcon('ready')
      this.statusBarItem.isProgress = false
      this.statusBarItem.command = Commands.SHOW_SERVER_TASK_STATUS
      this.statusBarItem.tooltip = "ServiceReady"
    }
  }

  public updateTooltip(tooltip: string): void {
    if (!supportsLanguageStatus()) {
      this.statusBarItem.tooltip = tooltip
    }
  }

  public dispose(): void {
    this.statusBarItem?.dispose()
    this.languageStatusItem?.dispose()
  }
}

export enum StatusIcon {
  lightWeight = "",
  busy = "Busy",
  ready = "OK",
  warning = "Warning",
  error = "Error"
}

export const serverStatusBarProvider: ServerStatusBarProvider = new ServerStatusBarProvider()

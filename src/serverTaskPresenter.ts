'use strict'
import { Disposable, Emitter, Progress, window, workspace } from 'coc.nvim'
import { Commands } from './commands'
import { ProgressReport } from './protocol'
import { serverTasks } from './serverTasks'
import { getJavaConfiguration } from './utils'

export interface TerminalDimensions {
  readonly columns: number
  readonly rows: number
}
const JAVA_SERVER_TASK_PRESENTER_TASK_NAME = "Java Build Status"
let bufnr: number | undefined

export namespace serverTaskPresenter {
  export async function presentServerTaskView() {
    let { nvim } = workspace
    let winid = -1
    if (bufnr) {
      let loaded = await nvim.call('bufloaded', [bufnr])
      if (!loaded) bufnr = undefined
      if (bufnr) {
        winid = await nvim.call('bufwinid', [bufnr])
      }
    }
    if (!bufnr) {
      let buf = await nvim.createNewBuffer(false, true)
      bufnr = buf.id
      await buf.setOption('bufhidden', 'wipe')
    }
    if (!bufnr) return
    if (winid == -1) {
      nvim.command(`belowright 10sp +b\\ ${bufnr}`, true)
    }
    await refreshLines(serverTasks.getHistory())
    activationProgressNotification.hide()
  }
}

async function refreshLines(tasks: ProgressReport[]) {
  if (!bufnr) return
  let loaded = await workspace.nvim.call('bufloaded', [bufnr])
  if (!loaded) return
  let lines = [JAVA_SERVER_TASK_PRESENTER_TASK_NAME]
  for (let task of tasks) {
    lines.push(printTask(task))
  }
  let buf = workspace.nvim.createBuffer(bufnr)
  await buf.setLines(lines, { start: 0, end: -1, strictIndexing: false })
}

serverTasks.onDidUpdateServerTask(async tasks => {
  await refreshLines(tasks)
})

function printTask(report: ProgressReport): string {
  if (report.complete) {
    return `${report.id.slice(0, 8)} ${report.task} [Done]`
  }
  return `${report.id.slice(0, 8)} ${report.task}: ${report.status} [${report.workDone}/${report.totalWork}]`
}

export class ActivationProgressNotification {
  private hideEmitter = new Emitter<void>();
  private onHide = this.hideEmitter.event;
  private disposables: Disposable[] = [];

  public showProgress() {
    if (!workspace.workspaceFolders) {
      return
    }
    const showBuildStatusEnabled = getJavaConfiguration().get('showBuildStatusOnStart.enabled')
    if (typeof showBuildStatusEnabled === 'string' || showBuildStatusEnabled instanceof String) {
      if (showBuildStatusEnabled !== 'notification') {
        return
      }
    } else if (!showBuildStatusEnabled) {
      return
    }
    const isProgressReportEnabled: boolean = getJavaConfiguration().get('progressReports.enabled')
    const title = isProgressReportEnabled ? 'Opening Java Projects' : 'Opening Java Projects...'
    window.withProgress({
      title,
      cancellable: false,
    }, (progress: Progress<{ message?: string; increment?: number }>, _token) => {
      return new Promise<void>((resolve) => {
        let interval: NodeJS.Timer
        if (isProgressReportEnabled) {
          interval = setInterval(() => {
            const tasks = serverTasks.getHistory()
            if (tasks.length == 0) {
              progress.report({ message: '' })
            } else {
              const msg = printTask(tasks[tasks.length - 1])
              progress.report({ message: msg })
            }
          })
        }
        this.onHide(() => {
          clearInterval(interval)
          for (const disposable of this.disposables) {
            disposable.dispose()
          }
          return resolve()
        })
      })
    })
  }

  public hide() {
    this.hideEmitter.fire()
  }
}

export const activationProgressNotification = new ActivationProgressNotification()

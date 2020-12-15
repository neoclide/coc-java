import { commands, events, window, workspace, Disposable } from 'coc.nvim'

export function fixComment(disposables: Disposable[]): void {
  let lastChar = ''
  let lastTs = null
  events.on('InsertCharPre', ch => {
    lastChar = ch
    lastTs = Date.now()
  }, null, disposables)
  events.on('TextChangedI', async bufnr => {
    let doc = workspace.getDocument(bufnr)
    if (!doc) return
    if (Date.now() - lastTs < 40 && lastChar == '*') {
      await wait(20)
      let pos = await window.getCursorPosition()
      let line = doc.getline(pos.line)
      let pre = line.slice(0, pos.character)
      let end = line.slice(pos.character)
      if (!end && pre.endsWith('/**')) {
        await workspace.nvim.call('coc#util#setline', [pos.line + 1, `${pre} */`])
      }
      await wait(20)
      commands.executeCommand('editor.action.triggerSuggest')
    }
    lastChar = null
  }, null, disposables)
}

function wait(ms: number): Promise<any> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(undefined)
    }, ms)
  })
}


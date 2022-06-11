import { window, workspace } from 'coc.nvim'
import compressing from 'compressing'
import got from 'got'
import tunnel from 'tunnel'

export async function downloadServer(root: string): Promise<void> {
  let statusItem = window.createStatusBarItem(0, { progress: true })
  statusItem.text = 'Downloading jdt.ls from eclipse.org'
  statusItem.show()
  let config = workspace.getConfiguration('http')
  let proxy = config.get<string>('proxy', '')
  let options: any = { encoding: null }
  if (proxy) {
    let parts = proxy.replace(/^https?:\/\//, '').split(':', 2)
    options.agent = tunnel.httpOverHttp({
      proxy: {
        headers: {},
        host: parts[0],
        port: Number(parts[1])
      }
    })
  }

  // need to find the url of the latest **milestone** instead of the latest snapshot


  return new Promise<void>((resolve, reject) => {
    let stream = got.stream('http://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz', options)
      .on('downloadProgress', progress => {
        let p = (progress.percent * 100).toFixed(0)
        statusItem.text = `${p}% Downloading jdt.ls from eclipse.org`
      })
    compressing.tgz.uncompress(stream as any, root)
      .then(() => {
        statusItem.dispose()
        resolve()
      })
      .catch(e => {
        // tslint:disable-next-line: no-console
        console.error(e)
        statusItem.dispose()
        reject(e)
      })
  })
}

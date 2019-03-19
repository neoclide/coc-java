import got from 'got'
import tunnel from 'tunnel'
import compressing from 'compressing'
import { workspace } from 'coc.nvim'

export async function downloadServer(root: string): Promise<void> {
  let statusItem = workspace.createStatusBarItem(0, { progress: true })
  statusItem.text = 'Downloading jdt.ls from eclipse.org: 0%'
  statusItem.show()
  let config = workspace.getConfiguration('http')
  let proxy = config.get<string>('proxy', '')
  let options: any = { encoding: null }
  if (proxy) {
    let parts = proxy.split(':', 2)
    options.agent = tunnel.httpOverHttp({
      proxy: {
        headers: {},
        host: parts[0],
        port: Number(parts[1])
      }
    })
  }

  return new Promise<void>((resolve, reject) => {
    let stream = got.stream('http://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz', options)
      .on('downloadProgress', progress => {
        let p = (progress.percent * 100).toFixed(0)
        statusItem.text = `Downloading jdt.ls from eclipse.org: ${p}%`
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

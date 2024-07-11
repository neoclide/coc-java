import { ExtensionContext, download, window } from 'coc.nvim'
import { getRuntime, JAVAC_FILENAME } from 'jdk-utils'
import * as fse from 'fs-extra'
import * as path from 'path'
import * as os from 'os'

const JRE_VERSION = '17.0.8'

export function getPlatform(): string | undefined {
  let { platform } = process
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'darwin'
  if (platform === 'linux') return 'linux'
  return undefined
}

function registryUrl(home = os.homedir()): URL {
  let res: URL
  let filepath = path.join(home, '.npmrc')
  if (fse.existsSync(filepath)) {
    try {
      let content = fse.readFileSync(filepath, 'utf8')
      let uri: string
      for (let line of content.split(/\r?\n/)) {
        if (line.startsWith('#')) continue
        let ms = line.match(/^(.*?)=(.*)$/)
        if (ms && ms[1] === 'coc.nvim:registry') {
          uri = ms[2]
        }
      }
      if (uri) res = new URL(uri)
    } catch (e) {
      // ignore
    }
  }
  return res ?? new URL('https://registry.npmjs.org')
}


function getPackageName(): string | undefined {
  let platform = getPlatform()
  if (!platform) return undefined
  if (platform === 'windows') return 'javajre-windows-64'
  let isArm = process.arch.indexOf('arm') === 0
  return `javajre-${platform}-${isArm ? 'arm' : ''}64`
}

export function checkJavac(javaHome: string): boolean {
  let file = path.join(javaHome, 'bin', JAVAC_FILENAME)
  if (fse.existsSync(file)) return true
  return false
}

export async function checkAndDownloadJRE(context: ExtensionContext): Promise<string | undefined> {
  let packageName = getPackageName()
  if (!packageName) return undefined
  let javaHome = path.join(context.storagePath, `jdk-${JRE_VERSION}`, packageName, 'jre')
  if (checkJavac(javaHome)) return javaHome
  let folder = path.resolve(javaHome, '..')
  if (fse.existsSync(folder)) {
    await fse.remove(folder)
  }
  // download and extract to data folder
  let registry = registryUrl()
  const tmpfolder = path.join(os.tmpdir(), `jdk-${JRE_VERSION}`)
  await window.withProgress({ title: `Installing jre from ${registry}` }, (progress, token) => {
    return download(new URL(`${packageName}/-/${packageName}-${JRE_VERSION}.tgz`, registry), {
      dest: tmpfolder,
      extract: 'untar',
      onProgress: percent => {
        progress.report({ message: `Downloaded ${percent}%` })
      }
    }, token)
  })
  fse.moveSync(tmpfolder, folder, { overwrite: true })
  if (checkJavac(javaHome)) {
    const runtime = await getRuntime(javaHome, { withVersion: true })
    if (runtime?.version?.major >= 17) {
      return javaHome
    }
  }
  return javaHome
  return undefined
}

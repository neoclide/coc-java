import { ExtensionContext, download, window } from 'coc.nvim'
import { getRuntime, JAVAC_FILENAME } from 'jdk-utils'
import fs from 'fs'
import * as fse from 'fs-extra'
import * as path from 'path'
import * as os from 'os'

const JRE_VERSION = '23.0.2'
const OLD_JRE_VERSION = '17.0.8'

const supported_platforms = [
  'linux-aarch64',
  'linux-ppc64le',
  'linux-riscv64',
  'linux-x86_64',
  'macosx-aarch64',
  'macosx-x86_64',
  'win32-aarch64',
  'win32-x86_64',
]
const baseURL = 'https://download.eclipse.org'

export function getDownloadUrl(): string {
  let prefix = ''
  switch (process.platform) {
    case 'darwin':
      prefix = 'macosx'
      break
    case 'win32':
      prefix = 'win32'
      break
    case 'linux':
      prefix = 'linux'
      break
    default:
      throw new Error('Unsupported platform: ' + process.platform)
  }
  let arch = ''
  switch (process.arch) {
    case 'arm':
    case 'arm64':
      arch = 'aarch64'
      break
    case 'ppc64':
      arch = 'ppc64le'
      break
    case 'riscv64':
      arch = 'riscv64'
      break
    case 'x64':
      arch = 'x86_64'
      break
    default:
      throw new Error('Unsupported  CPU architecture: ' + process.arch)
  }
  let platform = prefix + '-' + arch
  if (!supported_platforms.includes(platform)) throw new Error('Unsupported platform: ' + process.platform)
  return `${baseURL}/justj/jres/23/downloads/20250130_2304/org.eclipse.justj.openjdk.hotspot.jre.full.stripped-${JRE_VERSION}-${platform}.tar.gz`
}

export function getPlatform(): string | undefined {
  let { platform } = process
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'darwin'
  if (platform === 'linux') return 'linux'
  return undefined
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
  if (fs.existsSync(javaHome)) fs.rmSync(javaHome, { recursive: true, force: true })
  return false
}

export async function checkAndDownloadJRE(context: ExtensionContext): Promise<string | undefined> {
  let javaHome: string = undefined
  let packageName = getPackageName()
  if (packageName) {
    // use old jdk 17 when exists
    javaHome = path.join(context.storagePath, `jdk-${OLD_JRE_VERSION}`, packageName, 'jre')
    if (checkJavac(javaHome)) return javaHome
  }

  // use new path for jdk 23
  javaHome = path.join(context.storagePath, `jdk-${JRE_VERSION}-${process.platform}-${process.arch}`)
  if (checkJavac(javaHome)) return javaHome
  let url: string
  try {
    url = getDownloadUrl()
  } catch (e) {
    context.logger.error(`Unable to download JRE:`, e.message)
    return undefined
  }

  const tmpfolder = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-java-'))
  await window.withProgress({ title: `Installing jre from ${baseURL}` }, (progress, token) => {
    return download(
      url,
      {
        dest: tmpfolder,
        extract: 'untar',
        strip: 0,
        onProgress: (percent) => {
          progress.report({ message: `Downloaded ${percent}%` })
        },
      },
      token,
    )
  })
  fse.moveSync(tmpfolder, javaHome, { overwrite: true })
  if (checkJavac(javaHome)) {
    const runtime = await getRuntime(javaHome, { withVersion: true })
    if (runtime?.version?.major >= 23) {
      return javaHome
    }
  }
  return undefined
}

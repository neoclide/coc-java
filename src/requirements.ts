import { workspace, Uri } from 'coc.nvim'
import cp from 'child_process'
import fs from 'fs'
import path from 'path'
import pathExists from 'path-exists'
import expandHomeDir from 'expand-home-dir'
import findJavaHome from 'find-java-home'

const isWindows = process.platform.indexOf('win') === 0
const JAVAC_FILENAME = 'javac' + (isWindows ? '.exe' : '')
const JAVA_FILENAME = 'java' + (isWindows ? '.exe' : '')

export interface ServerConfiguration {
  root: string
  encoding: string
  vmargs: string
}

export interface RequirementsData {
  java_home: string
  java_version: number
}

export interface ErrorData {
  message: string
  label: string
  openUrl: Uri
  replaceClose: boolean
}

/**
 * Resolves the requirements needed to run the extension.
 * Returns a promise that will resolve to a RequirementsData if
 * all requirements are resolved, it will reject with ErrorData if
 * if any of the requirements fails to resolve.
 *
 */
export async function resolveRequirements(): Promise<RequirementsData> {
  let java_home = await checkJavaRuntime()
  let javaVersion = await checkJavaVersion(java_home)
  return Promise.resolve({ java_home, java_version: javaVersion })
}

function checkJavaRuntime(): Promise<string> {
  return new Promise((resolve, reject) => {
    let source: string
    let javaHome: string = readJavaConfig()
    if (javaHome) {
      source = 'The java.home variable defined in VS Code settings'
    } else {
      javaHome = process.env['JDK_HOME']
      if (javaHome) {
        source = 'The JDK_HOME environment variable'
      } else {
        javaHome = process.env['JAVA_HOME']
        source = 'The JAVA_HOME environment variable'
      }
    }
    if (javaHome) {
      javaHome = expandHomeDir(javaHome)
      let stat = fs.lstatSync(javaHome)
      if (stat.isSymbolicLink()) {
        javaHome = fs.realpathSync(javaHome)
      }
      if (!pathExists.sync(javaHome)) {
        openJDKDownload(reject, source + ' points to a missing folder')
      }
      if (!pathExists.sync(path.resolve(javaHome, 'bin', JAVAC_FILENAME))) {
        openJDKDownload(reject, source + ' does not point to a JDK.')
      }
      return resolve(javaHome)
    }
    // No settings, let's try to detect as last resort.
    findJavaHome((err, home) => {
      if (err) {
        openJDKDownload(reject, 'Java runtime could not be located')
      }
      else {
        resolve(home)
      }
    })
  })
}

function readJavaConfig(): string {
  const config = workspace.getConfiguration('java')
  return config.get<string>('home', null)
}

function checkJavaVersion(java_home: string): Promise<number> {
  return new Promise((resolve, reject) => {
    cp.execFile(java_home + '/bin/' + JAVA_FILENAME, ['-version'], {}, (_error, _stdout, stderr) => {
      let javaVersion = parseMajorVersion(stderr)
      if (javaVersion < 8) {
        openJDKDownload(reject, 'Java 8 or more recent is required to run. Please download and install a recent JDK')
      } else {
        resolve(javaVersion)
      }
    })
  })
}

export function parseMajorVersion(content: string): number {
  let regexp = /version "(.*)"/g
  let match = regexp.exec(content)
  if (!match) {
    return 0
  }
  let version = match[1]
  // Ignore '1.' prefix for legacy Java versions
  if (version.startsWith('1.')) {
    version = version.substring(2)
  }

  // look into the interesting bits now
  regexp = /\d+/g
  match = regexp.exec(version)
  let javaVersion = 0
  if (match) {
    javaVersion = parseInt(match[0], 10)
  }
  return javaVersion
}

function openJDKDownload(reject, cause): void {
  let jdkUrl = 'https://developers.redhat.com/products/openjdk/download/?sc_cid=701f2000000RWTnAAO'
  if (process.platform === 'darwin') {
    jdkUrl = 'http://www.oracle.com/technetwork/java/javase/downloads/index.html'
  }
  reject({
    message: cause,
    label: 'Get the Java Development Kit',
    openUrl: Uri.parse(jdkUrl),
    replaceClose: false
  } as ErrorData)
}

"use strict";

import { ExtensionContext, Uri, window, workspace } from "coc.nvim";
import expandHomeDir from "expand-home-dir";
import * as fse from "fs-extra";
import { findRuntimes, getRuntime, getSources, IJavaRuntime, JAVAC_FILENAME } from "jdk-utils";
import * as path from "path";
import { Commands } from "./commands";
import { checkAndDownloadJRE } from "./jre";
import { createLogger } from "./log";
import { checkJavaPreferences } from "./settings";
import { existsSync } from "fs";
import { getJavaConfiguration } from "./utils";

let cachedJdks: IJavaRuntime[];
let cachedJreNames: string[];

export interface RequirementsData {
  tooling_jre: string;
  tooling_jre_version: number;
  java_home: string;
  java_version: number;
}

/**
 * Resolves the requirements needed to run the extension.
 * Returns a promise that will resolve to a RequirementsData if
 * all requirements are resolved, it will reject with ErrorData if
 * if any of the requirements fails to resolve.
 *
 */
export async function resolveRequirements(context: ExtensionContext): Promise<RequirementsData> {
  return new Promise(async (resolve, reject) => {
    let javaHome: string = undefined;
    let javaVersion: number = 0;

    let toolingJre: string = undefined;
    let toolingJreVersion: number = 0;

    // search valid JDKs from env.JAVA_HOME, env.PATH, SDKMAN, jEnv, jabba, Common directories
    const requiredJdkVersion = "on" === getJavaConfiguration().get("jdt.ls.javac.enabled") ? 23 : 21;
    const javaPreferences = await checkJavaPreferences(context);

    let javaSettingsRuntimes = await getRuntimeFromSettings();
    let javaSystemRuntimes = await findRuntimes({ checkJavac: true, withVersion: true, withTags: true });

    // sort in ascending order the versions from both system & settings
    javaSystemRuntimes = sortJdksByVersion(javaSystemRuntimes || []);
    javaSettingsRuntimes = sortJdksByVersion(javaSettingsRuntimes || []);

    createLogger().info(`Resolving from system runtimes: ${JSON.stringify(javaSystemRuntimes, null, 2)}`);
    createLogger().info(`Resolving from configured runtimes: ${JSON.stringify(javaSettingsRuntimes, null, 2)}`);

    if (javaPreferences?.javaHome) {
      toolingJre = javaHome;
      toolingJreVersion = javaVersion;
      if (toolingJreVersion < requiredJdkVersion) {
        const neverShow: boolean | undefined = context.workspaceState.get<boolean>(
          "java.home.failsMinRequiredFirstTime"
        );
        if (!neverShow) {
          context.workspaceState.update("java.home.failsMinRequiredFirstTime", true);
          window.showInformationMessage(
            `The Java runtime set with 'java.jdt.ls.java.home' does not meet the minimum required version of '${requiredJdkVersion}' and will not be used.`
          );
        }
        toolingJre = undefined;
        toolingJreVersion = 0;
      }
    }

    if (!toolingJre || toolingJreVersion < requiredJdkVersion) {
      let filtered = javaSettingsRuntimes.filter((r) => r.version.major >= requiredJdkVersion);
      if (filtered.length) {
        // using the closest to the requiredJdkVersion entry
        toolingJre = filtered[filtered.length - 1].homedir;
        toolingJreVersion = filtered[filtered.length - 1].version?.major;
      }

      filtered = javaSystemRuntimes.filter((r) => r.version.major >= requiredJdkVersion);
      if (filtered.length && toolingJreVersion < requiredJdkVersion) {
        // using the closest to the requiredJdkVersion entry
        toolingJre = filtered[filtered.length - 1].homedir;
        toolingJreVersion = filtered[filtered.length - 1].version?.major;
      }

      if (toolingJreVersion < requiredJdkVersion) {
        toolingJre = await checkAndDownloadJRE(context);
        toolingJreVersion = await getMajorVersion(toolingJre);
      }
    }

    if (toolingJre && toolingJreVersion >= requiredJdkVersion) {
      createLogger().info(`Using the JDK from '${toolingJre}' as the primary server tooling & startup JDK.`);
    } else {
      openJDKDownload(
        reject,
        `Java ${requiredJdkVersion} or more recent is required to run the Java extension. Please download and install a recent JDK. You can still compile your projects with older JDKs by configuring ['java.configuration.runtimes'](https://github.com/redhat-developer/vscode-java/wiki/JDK-Requirements#java.configuration.runtimes)`
      );
    }

    let defaultRuntimes = javaSettingsRuntimes.filter((r) => {
      return r.homedir && r.default === true;
    });
    if (defaultRuntimes.length > 0) {
      javaHome = defaultRuntimes[0].homedir;
      javaVersion = defaultRuntimes[0].version.major;
      createLogger().info(
        `Using the default JDK from java.configuration.runtimes - '${javaHome}' as the initial default project JDK.`
      );
    } else if (javaPreferences.javaHome) {
      createLogger().info(
        `Using the JDK from user preferences ${javaPreferences.preference} - '${javaPreferences.javaHome}' as the initial default project JDK.`
      );
      javaHome = javaPreferences.javaHome;
    } else if (toolingJre) {
      javaHome = toolingJre;
      javaVersion = toolingJreVersion;
      createLogger().info(`Using the resolved tooling JDK from '${javaHome}' as the default project JDK.`);
    } else {
      openJDKDownload(
        reject,
        "Please download and install a JDK to compile your project. You can configure your projects with different JDKs by the setting ['java.configuration.runtimes'](https://github.com/redhat-developer/vscode-java/wiki/JDK-Requirements#java.configuration.runtimes)"
      );
    }

    if (javaHome) {
      javaHome = expandHomeDir(javaHome);
      if (!(await fse.pathExists(javaHome))) {
        invalidJavaHome(reject, `The ${javaHome} points to a missing or inaccessible folder (${javaHome})`);
      } else if (!(await fse.pathExists(path.resolve(javaHome, "bin", JAVAC_FILENAME)))) {
        let msg: string;
        if (await fse.pathExists(path.resolve(javaHome, JAVAC_FILENAME))) {
          msg = `'bin' should be removed from ${javaHome}`;
        } else {
          msg = `The ${javaHome} does not point to a JDK.`;
        }
        invalidJavaHome(reject, msg);
      }
    }

    /* eslint-disable @typescript-eslint/naming-convention */
    resolve({
      tooling_jre: toolingJre,
      tooling_jre_version: toolingJreVersion,
      java_home: javaHome,
      java_version: javaVersion,
    });
    /* eslint-enable @typescript-eslint/naming-convention */
  });
}

function expand(input: string): string | undefined {
  return input.replace(/\$\{(.*?)\}/g, (match: string, name: string) => {
    if (name.startsWith("env:")) {
      let key = name.split(":")[1];
      return process.env[key] ?? match;
    }
    return undefined;
  });
}

async function getRuntimeFromSettings(): Promise<any[] | undefined> {
  const runtimes = workspace.getConfiguration().get("java.configuration.runtimes");
  if (Array.isArray(runtimes) && runtimes.length) {
    let candidates: any[] = [];
    const options: any = {
      withVersion: true,
      checkJavac: true,
      withTags: true,
    };
    for (const runtime of runtimes) {
      if (!runtime || typeof runtime !== "object" || !runtime.path) {
        continue;
      }
      const path = runtime && runtime.path && expand(runtime.path);
      const jr: IJavaRuntime = await getRuntime(path, options);
      if (jr !== undefined) {
        candidates.push({
          homedir: jr.homedir,
          version: jr.version,
          isHome: jr.isJdkHomeEnv,
          default: runtime.default,
        });
      }
    }
    return candidates;
  }

  return undefined;
}

export function getSupportedJreNames(): string[] {
  return cachedJreNames;
}

export async function listJdks(force?: boolean): Promise<IJavaRuntime[]> {
  if (force || !cachedJdks) {
    cachedJdks = await findRuntimes({ checkJavac: true, withVersion: true, withTags: true }).then((jdks) =>
      jdks.filter((jdk) => {
        return (
          existsSync(path.join(jdk.homedir, "lib", "rt.jar")) ||
          existsSync(path.join(jdk.homedir, "jre", "lib", "rt.jar")) || // Java 8
          existsSync(path.join(jdk.homedir, "lib", "jrt-fs.jar"))
        ); // Java 9+
      })
    );
  }

  return [].concat(cachedJdks);
}

export function sortJdksBySource(jdks: IJavaRuntime[]) {
  const rankedJdks = jdks as Array<IJavaRuntime & { rank: number }>;
  const sources = ["JDK_HOME", "JAVA_HOME", "PATH"];
  for (const [index, source] of sources.entries()) {
    for (const jdk of rankedJdks) {
      if (jdk.rank === undefined && getSources(jdk).includes(source)) {
        jdk.rank = index;
      }
    }
  }
  rankedJdks.filter((jdk) => jdk.rank === undefined).forEach((jdk) => (jdk.rank = sources.length));
  rankedJdks.sort((a, b) => a.rank - b.rank);
}

/**
 * Sort by major version in descend order.
 */
export function sortJdksByVersion(jdks: IJavaRuntime[]): IJavaRuntime[] {
  jdks.sort((a, b) => (b.version?.major ?? 0) - (a.version?.major ?? 0));
  return jdks;
}

export function parseMajorVersion(version: string): number {
  if (!version) {
    return 0;
  }
  // Ignore '1.' prefix for legacy Java versions
  if (version.startsWith("1.")) {
    version = version.substring(2);
  }
  // look into the interesting bits now
  const regexp = /\d+/g;
  const match = regexp.exec(version);
  let javaVersion = 0;
  if (match) {
    javaVersion = parseInt(match[0]);
  }
  return javaVersion;
}

function openJDKDownload(reject, cause) {
  const jdkUrl = getJdkUrl();
  reject({
    message: cause,
    label: "Get the Java Development Kit",
    command: Commands.OPEN_BROWSER,
    commandParam: Uri.parse(jdkUrl),
  });
}

export function getJdkUrl() {
  let jdkUrl = "https://developers.redhat.com/products/openjdk/download/?sc_cid=701f2000000RWTnAAO";
  if (process.platform === "darwin") {
    jdkUrl = "https://adoptopenjdk.net/";
  }
  return jdkUrl;
}

function invalidJavaHome(reject, cause: string) {
  if (cause.indexOf("java.home") > -1) {
    reject({
      message: cause,
      label: "Open settings",
      command: Commands.OPEN_JSON_SETTINGS,
    });
  } else {
    reject({
      message: cause,
    });
  }
}

async function getMajorVersion(javaHome: string): Promise<number> {
  if (!javaHome) {
    return 0;
  }
  const runtime = await getRuntime(javaHome, { withVersion: true });
  return runtime?.version?.major || 0;
}

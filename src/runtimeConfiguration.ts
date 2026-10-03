import type { LanguageClient } from 'coc.nvim'
import { DidChangeConfigurationNotification } from 'vscode-languageserver-protocol'
import { createLogger } from './log'
import { addAutoDetectedJdks, getJavaConfig, getJavaConfiguration } from './utils'

let detectedRuntimes: Promise<any[]> | undefined

function discoverRuntimes(): Promise<any[]> {
  // Standard and syntax clients share a scan, including while it is in flight.
  if (!detectedRuntimes) {
    detectedRuntimes = addAutoDetectedJdks([]).catch(error => {
      detectedRuntimes = undefined
      throw error
    })
  }
  return detectedRuntimes
}

/** Add discovered project JDKs after initialization without delaying server startup. */
export async function updateAutoDetectedJdks(
  client: Pick<LanguageClient, 'onReady' | 'isRunning' | 'sendNotification'>,
  javaHome: string,
  options: { discover?: () => Promise<any[]>; activeBuildTool?: string } = {},
): Promise<void> {
  try {
    await client.onReady()
    if (!client.isRunning() || !getJavaConfiguration().get<boolean>('configuration.detectJdks')) return

    const runtimes = await (options.discover ?? discoverRuntimes)()
    // Settings can change while discovery is running. Use the latest values,
    // and never replace an explicitly configured execution environment.
    const javaConfig = getJavaConfig(javaHome)
    if (!client.isRunning() || !javaConfig.configuration.detectJdks) return
    // Keep the selected importer when startup resolved a Maven/Gradle conflict.
    if (javaConfig.import.maven.enabled && javaConfig.import.gradle.enabled) {
      if (options.activeBuildTool === 'maven') javaConfig.import.gradle.enabled = false
      if (options.activeBuildTool === 'gradle') javaConfig.import.maven.enabled = false
    }
    const configuredNames = new Set(javaConfig.configuration.runtimes.map(runtime => runtime.name))
    javaConfig.configuration.runtimes.push(...runtimes.filter(runtime => !configuredNames.has(runtime.name)))
    await client.sendNotification(DidChangeConfigurationNotification.type.method, {
      settings: { java: javaConfig },
    })
    createLogger().info(`Server configured with the following runtimes: ${JSON.stringify(javaConfig.configuration.runtimes, null, 2)}`)
  } catch (error) {
    createLogger().warn(`Failed to update auto-detected Java runtimes: ${String(error)}`)
  }
}

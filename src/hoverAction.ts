'use strict'

import {CancellationToken, Command, Hover, HoverProvider, LanguageClient, Position, TextDocument} from 'coc.nvim'
import {HoverRequest, MarkedString, TextDocumentPositionParams} from 'vscode-languageserver-protocol'
import {Commands as javaCommands} from './commands'
import {ProvideHoverCommandFn} from './extension.api'
import {createLogger} from './log'
import {FindLinks, LinkLocation} from './protocol'

export function createClientHoverProvider(languageClient: LanguageClient): JavaHoverProvider {
    const hoverProvider: JavaHoverProvider = new JavaHoverProvider(languageClient)
    registerHoverCommand(async (params: TextDocumentPositionParams, token: CancellationToken) => {
        return await provideHoverCommand(languageClient, params, token)
    })

    return hoverProvider
}

async function provideHoverCommand(languageClient: LanguageClient, params: TextDocumentPositionParams, token: CancellationToken): Promise<Command[] | undefined> {
    const response: LinkLocation[] = await languageClient.sendRequest(FindLinks.type, {
        type: 'superImplementation',
        position: params,
    }, token)
    if (response && response.length) {
        const location = response[0]
        let tooltip
        if (location.kind === 'method') {
            tooltip = `Go to super method '${location.displayName}'`
        } else {
            tooltip = `Go to super implementation '${location.displayName}'`
        }

        return [{
            title: 'Go to Super Implementation',
            command: javaCommands.NAVIGATE_TO_SUPER_IMPLEMENTATION_COMMAND,
            // tooltip,
            arguments: [{
                uri: encodeBase64(location.uri),
                range: location.range,
            }],
        }]
    }
}

function encodeBase64(text: string): string {
    return Buffer.from(text).toString('base64')
}

const hoverCommandRegistry: ProvideHoverCommandFn[] = []
export function registerHoverCommand(callback: ProvideHoverCommandFn): void {
    hoverCommandRegistry.push(callback)
}

class JavaHoverProvider implements HoverProvider {

    constructor(readonly languageClient: LanguageClient) {
    }

    async provideHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover> {
        const params = {
            textDocument: document,
            position: position,
        }

        // Fetch the javadoc from Java language server.
        const hoverResponse = await this.languageClient.sendRequest(HoverRequest.type as any, params, token)
        const serverHover = hoverResponse as Hover

        // Fetch the contributed hover commands from third party extensions.
        const contributedCommands: Command[] = await this.getContributedHoverCommands(params, token)
        if (!contributedCommands.length) {
            return serverHover
        }

        const contributed: MarkedString = {language: 'markdown', value: contributedCommands.map((command) => this.convertCommandToMarkdown(command)).join(' | ')}
        let contents: MarkedString[] = [contributed]
        let range
        if (serverHover && serverHover.contents) {
            contents = contents.concat(serverHover.contents as MarkedString[])
            range = serverHover.range
        }
        return {contents, range}
    }

    private async getContributedHoverCommands(params: TextDocumentPositionParams, token: CancellationToken): Promise<Command[]> {
        const contributedCommands: Command[] = []
        for (const provideFn of hoverCommandRegistry) {
            try {
                if (token.isCancellationRequested) {
                    break
                }

                const commands = (await provideFn(params, token)) || []
                commands.forEach((command) => {
                    contributedCommands.push(command)
                })
            } catch (error) {
                createLogger().error(`Failed to provide hover command ${String(error)}`)
            }
        }

        return contributedCommands
    }

    private convertCommandToMarkdown(command: Command): string {
        return `[${command.title}](command:${command.command}?${encodeURIComponent(JSON.stringify(command.arguments || []))} "${command.command}")`
    }
}

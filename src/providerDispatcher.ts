'use strict'

import { CancellationToken, commands, DocumentSymbol, DocumentSymbolProvider, Event, ExtensionContext, Hover, HoverProvider, LanguageClient, languages, MarkedString, Position, Range, SymbolInformation, SymbolKind, TextDocument, TextDocumentContentProvider, Uri, workspace, WorkspaceSymbolProvider } from 'coc.nvim'
import { DocumentSymbolRequest, HoverRequest, SymbolInformation as clientSymbolInformation, WorkspaceSymbolRequest } from 'vscode-languageserver-protocol'
import { apiManager } from './apiManager'
import { Commands } from './commands'
import { getActiveLanguageClient } from './extension'
import { createClientHoverProvider } from './hoverAction'
import { ClassFileContentsRequest } from './protocol'
import { ServerMode } from "./settings"
import { equals } from './utils'

export interface ProviderOptions {
  contentProviderEvent: Event<Uri>
}

export interface ProviderHandle {
  handles: any[]
}

export function registerClientProviders(context: ExtensionContext, options: ProviderOptions): ProviderHandle {
  const hoverProvider = new ClientHoverProvider()
  context.subscriptions.push(languages.registerHoverProvider(['java'], hoverProvider))

  const symbolProvider = createDocumentSymbolProvider()
  context.subscriptions.push(languages.registerDocumentSymbolProvider(['java'], symbolProvider))

  const jdtProvider = createJDTContentProvider(options)
  context.subscriptions.push(workspace.registerTextDocumentContentProvider('jdt', jdtProvider))

  overwriteWorkspaceSymbolProvider(context)

  return {
    handles: [hoverProvider, symbolProvider, jdtProvider]
  }
}

export class ClientHoverProvider implements HoverProvider {
  private delegateProvider

  async provideHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover> {
    const languageClient: LanguageClient | undefined = await getActiveLanguageClient()

    if (!languageClient) {
      return undefined
    }

    const serverMode: ServerMode = apiManager.getApiInstance().serverMode
    if (serverMode === ServerMode.standard) {
      if (!this.delegateProvider) {
        this.delegateProvider = createClientHoverProvider(languageClient)
      }
      const hover = await this.delegateProvider.provideHover(document, position, token)
      return fixJdtSchemeHoverLinks(hover)
    } else {
      const params = {
        textDocument: { uri: document.uri },
        position: position
      }
      const hoverResponse = await languageClient.sendRequest(HoverRequest.type as any, params, token)
      const hover = hoverResponse as Hover
      return fixJdtSchemeHoverLinks(hover)
    }
  }
}

function createJDTContentProvider(options: ProviderOptions): TextDocumentContentProvider {
  return <TextDocumentContentProvider>{
    onDidChange: options.contentProviderEvent,
    provideTextDocumentContent: async (uri: Uri, token: CancellationToken): Promise<string> => {
      const languageClient: LanguageClient | undefined = await getActiveLanguageClient()
      if (!languageClient) {
        return ''
      }
      const content = await languageClient.sendRequest(ClassFileContentsRequest.type, { uri: uri.toString() }, token)
      workspace.nvim.command('setfiletype java', true)
      return content ?? ''
    }
  }
}

function createDocumentSymbolProvider(): DocumentSymbolProvider {
  return <DocumentSymbolProvider>{
    provideDocumentSymbols: async (document: TextDocument, token: CancellationToken): Promise<SymbolInformation[] | DocumentSymbol[]> => {
      const languageClient: LanguageClient | undefined = await getActiveLanguageClient()

      if (!languageClient) {
        return []
      }

      const params = {
        textDocument: { uri: document.uri }
      }
      const symbolResponse: SymbolInformation[] = await languageClient.sendRequest(DocumentSymbolRequest.type as any, params, token)
      if (!symbolResponse || !symbolResponse.length) {
        return []
      }
      return symbolResponse
    }
  }
}

const START_OF_DOCUMENT = Range.create(0, 0, 0, 0)

function createWorkspaceSymbolProvider(existingWorkspaceSymbolProvider: WorkspaceSymbolProvider): WorkspaceSymbolProvider {
  return {
    provideWorkspaceSymbols: async (query: string, token: CancellationToken) => {
      // This is a workaround until vscode add support for qualified symbol search which is tracked by
      // https://github.com/microsoft/vscode/issues/98125
      const result = existingWorkspaceSymbolProvider.provideWorkspaceSymbols(query, token)
      if (query.indexOf('.') > -1) { // seems like a qualified name
        return new Promise<SymbolInformation[]>((resolve) => {
          ((result as Promise<SymbolInformation[]>)).then((symbols) => {
            if (symbols === null) {
              resolve(null)
            } else {
              resolve(symbols?.map((s) => {
                s.name = `${s.containerName}.${s.name}`
                return s
              }))
            }
          })
        })
      }
      return result
    },
    resolveWorkspaceSymbol: async (symbol: SymbolInformation, token: CancellationToken): Promise<SymbolInformation> => {
      const range = symbol.location.range
      if (range && equals(range, START_OF_DOCUMENT)) {
        return symbol
      }

      await getActiveLanguageClient()
      const serializableSymbol = {
        name: symbol.name,
        // Cannot serialize SymbolKind as number, because GSON + lsp4j.SymbolKind expect a name.
        kind: getSymbolKind(symbol.kind),
        location: {
          uri: symbol.location.uri,
          range: symbol.location.range
        },
        containerName: symbol.containerName
      }

      const response = await commands.executeCommand(Commands.EXECUTE_WORKSPACE_COMMAND, Commands.RESOLVE_WORKSPACE_SYMBOL, JSON.stringify(serializableSymbol))
      if (token.isCancellationRequested) {
        return undefined
      }
      return response as clientSymbolInformation
    }
  }
}

function overwriteWorkspaceSymbolProvider(context: ExtensionContext): void {
  const disposable = apiManager.getApiInstance().onDidServerModeChange(async (mode) => {
    if (mode === ServerMode.standard) {
      const feature = (await getActiveLanguageClient())['getFeature'](WorkspaceSymbolRequest.method)
      const providers = feature.getProviders()
      if (providers && providers.length > 0) {
        feature.dispose()
        const workspaceSymbolProvider = createWorkspaceSymbolProvider(providers[0])
        context.subscriptions.push(languages.registerWorkspaceSymbolProvider(workspaceSymbolProvider))
        disposable.dispose()
      }
    }
  })
}

const REPLACE_JDT_LINKS_PATTERN: RegExp = /(\[(?:[^\]])+\]\()(jdt:\/\/(?:(?:(?:\\\))|([^)]))+))\)/g

/**
 * Returns the hover with all jdt:// links replaced with a command:// link that opens the jdt URI.
 *
 * VS Code doesn't render links with the `jdt` scheme in hover popups.
 * To get around this, you can create a command:// link that invokes a command that opens the corresponding URI.
 * VS Code will render command:// links in hover pop ups if they are marked as trusted.
 *
 * @param hover The hover to fix the jdt:// links for
 * @returns the hover with all jdt:// links replaced with a command:// link that opens the jdt URI
 */
function fixJdtSchemeHoverLinks(hover: Hover): Hover {
  const newContents: MarkedString[] = []
  if (Array.isArray(hover.contents)) {
    for (const content of hover.contents) {
      if (typeof content['value'] === 'string') {
        const newContent: string = (content as any).value.replace(REPLACE_JDT_LINKS_PATTERN, (_substring, group1, group2) => {
          const uri = `command:${Commands.OPEN_FILE}?${encodeURI(JSON.stringify([encodeURIComponent(group2)]))}`
          return `${group1}${uri})`
        })
        const mdString = { language: 'markdown', value: newContent }
        newContents.push(mdString)
      } else {
        newContents.push(content)
      }
    }
    hover.contents = newContents
  }
  return hover
}

export function getSymbolKind(kind: SymbolKind): string {
  switch (kind) {
    case SymbolKind.File:
      return 'File'
    case SymbolKind.Module:
      return 'Module'
    case SymbolKind.Namespace:
      return 'Namespace'
    case SymbolKind.Package:
      return 'Package'
    case SymbolKind.Class:
      return 'Class'
    case SymbolKind.Method:
      return 'Method'
    case SymbolKind.Property:
      return 'Property'
    case SymbolKind.Field:
      return 'Field'
    case SymbolKind.Constructor:
      return 'Constructor'
    case SymbolKind.Enum:
      return 'Enum'
    case SymbolKind.Interface:
      return 'Interface'
    case SymbolKind.Function:
      return 'Function'
    case SymbolKind.Variable:
      return 'Variable'
    case SymbolKind.Constant:
      return 'Constant'
    case SymbolKind.String:
      return 'String'
    case SymbolKind.Number:
      return 'Number'
    case SymbolKind.Boolean:
      return 'Boolean'
    case SymbolKind.Array:
      return 'Array'
    case SymbolKind.Object:
      return 'Object'
    case SymbolKind.Key:
      return 'Key'
    case SymbolKind.Null:
      return 'Null'
    case SymbolKind.EnumMember:
      return 'EnumMember'
    case SymbolKind.Struct:
      return 'Struct'
    case SymbolKind.Event:
      return 'Event'
    case SymbolKind.Operator:
      return 'Operator'
    case SymbolKind.TypeParameter:
      return 'TypeParameter'
    default:
      return 'Unknown'
  }
}

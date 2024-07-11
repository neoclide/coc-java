'use strict'

import { CancellationToken, DocumentSymbol, LanguageClient, SymbolInformation } from 'coc.nvim'
import { DocumentSymbolParams, DocumentSymbolRequest } from 'vscode-languageserver-protocol'
import { getActiveLanguageClient } from './extension'

type DocumentSymbolsResponse = DocumentSymbol[] | SymbolInformation[] | null

export type GetDocumentSymbolsCommand = (params: DocumentSymbolParams, token?: CancellationToken) => Promise<DocumentSymbolsResponse>

export function getDocumentSymbolsProvider(): GetDocumentSymbolsCommand {
  return async (params: DocumentSymbolParams, token?: CancellationToken): Promise<DocumentSymbolsResponse> => {
    const languageClient: LanguageClient | undefined = await getActiveLanguageClient()
    if (!languageClient) {
      return []
    }

    if (token !== undefined) {
      return languageClient.sendRequest(DocumentSymbolRequest.type as any, params, token)
    }
    return languageClient.sendRequest(DocumentSymbolRequest.type as any, params)
  }
}

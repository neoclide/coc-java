'use strict'

import {
    CancellationToken, LanguageClient, Location,
    LocationLink
} from 'coc.nvim'
import {DefinitionParams, DefinitionRequest} from 'vscode-languageserver-protocol'
import {getActiveLanguageClient} from './extension'

type GoToDefinitionResponse = Location | Location[] | LocationLink[] | null

export type GoToDefinitionCommand = (params: DefinitionParams, token?: CancellationToken) => Promise<GoToDefinitionResponse>

export function goToDefinitionProvider(): GoToDefinitionCommand {
    return async (params: DefinitionParams, token?: CancellationToken): Promise<GoToDefinitionResponse> => {
        const languageClient: LanguageClient | undefined = await getActiveLanguageClient()
        if (!languageClient) {
            return null
        }

        if (token !== undefined) {
            return languageClient.sendRequest(DefinitionRequest.type as any, params, token)
        }
        return languageClient.sendRequest(DefinitionRequest.type as any, params)
    }
}

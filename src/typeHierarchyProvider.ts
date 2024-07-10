import {CancellationToken, commands, LanguageClient, LinesTextDocument, Position, SymbolTag, TextDocumentIdentifier, TextDocumentPositionParams, TypeHierarchyItem, TypeHierarchyProvider} from 'coc.nvim'
import {Commands} from './commands'
import {getActiveLanguageClient} from './extension'

export enum TypeHierarchyDirection {
    children,
    parents,
    both
}

export class HierarchyProvider implements TypeHierarchyProvider {
    private client: LanguageClient
    public initialized: boolean

    constructor() {
        this.initialized = false
    }
    public async initialize() {
        this.client = await getActiveLanguageClient()
        this.initialized = true
    }

    async prepareTypeHierarchy(document: LinesTextDocument, position: Position, token: CancellationToken): Promise<TypeHierarchyItem[]> {
        if (!this.initialized) {
            await this.initialize()
        }
        if (!this.client) return
        const textDocument: TextDocumentIdentifier = TextDocumentIdentifier.create(document.uri)
        const params: TextDocumentPositionParams = {
            textDocument: textDocument,
            position: position,
        }
        const direction = TypeHierarchyDirection.both
        let lspItem: TypeHierarchyItem
        try {
            lspItem = await commands.executeCommand(Commands.EXECUTE_WORKSPACE_COMMAND, Commands.OPEN_TYPE_HIERARCHY, JSON.stringify(params), JSON.stringify(direction), JSON.stringify(0), token)
        } catch (e) {
            // operation cancelled
            return
        }
        if (lspItem['deprecated']) {
            lspItem.tags = [SymbolTag.Deprecated]
        }
        return [lspItem]
    }

    async provideTypeHierarchySupertypes(item: TypeHierarchyItem, token: CancellationToken): Promise<TypeHierarchyItem[]> {
        throw new Error('Method not implemented.')
    }

    async provideTypeHierarchySubtypes(item: TypeHierarchyItem, token: CancellationToken): Promise<TypeHierarchyItem[]> {
        throw new Error('Method not implemented.')
    }
}

import {CancellationTokenSource, commands, LanguageClient, Location, Position, SymbolKind, TextDocumentIdentifier, TextDocumentPositionParams, Uri, window, workspace} from 'coc.nvim'
import {Commands} from "../commands"
import {getActiveLanguageClient} from "../extension"
import {showNoLocationFound} from "../standardLanguageClient"
import {TypeHierarchyTreeInput} from "./model"
import {LSPTypeHierarchyItem, TypeHierarchyDirection, TypeHierarchyItem} from "./protocol"
import {SymbolTree} from "./references-view"
import {toTypeHierarchyItem} from "./util"

export class TypeHierarchyTree {
    private api: SymbolTree
    private direction: TypeHierarchyDirection
    private client: LanguageClient
    private cancelTokenSource: CancellationTokenSource
    private location: Location
    private baseItem: TypeHierarchyItem
    public initialized: boolean

    constructor() {
        this.initialized = false
    }

    public async initialize() {
        let winid: number | undefined
        let splitCommand = workspace.getConfiguration('typeHierarchy', null).get<string>('splitCommand', 'botright 30vs')
        let nvim = workspace.nvim
        commands.registerCommand(Commands.OPEN_TYPE_HIERARCHY_LOCATION, async (uri: string, position: Position) => {
            if (winid) {
                let win = nvim.createWindow(winid)
                let valid = await win.valid
                if (valid) {
                    await nvim.call('win_gotoid', [winid])
                }
                await workspace.jumpTo(uri, position, 'edit')
            } else {
                await workspace.jumpTo(uri, position, 'edit')
            }
        })

        this.api = {
            setInput: async input => {
                let id = await nvim.eval('get(w:,"cocViewId",v:null)')
                if (!id) winid = await nvim.call('win_getid', [])
                let symbol = await Promise.resolve(input.resolve())
                if (!symbol) return
                let treeView = window.createTreeView('types', {
                    treeDataProvider: symbol.provider,
                    enableFilter: true
                })
                treeView.title = input.title
                treeView.onDidChangeVisibility(e => {
                    if (!e.visible) {
                        symbol.dispose()
                        treeView.dispose()
                    }
                })
                await treeView.show(splitCommand)
            }
        }
        this.client = await getActiveLanguageClient()
        this.initialized = true
    }

    public async setTypeHierarchy(location: Location, direction: TypeHierarchyDirection): Promise<void> {
        if (!this.initialized) {
            await this.initialize()
        }
        if (!this.api) {
            return
        }
        if (this.cancelTokenSource) {
            this.cancelTokenSource.cancel()
        }
        this.cancelTokenSource = new CancellationTokenSource()
        const textDocument: TextDocumentIdentifier = TextDocumentIdentifier.create(location.uri.toString())
        const position: Position = Position.create(location.range.start.line, location.range.start.character)
        const params: TextDocumentPositionParams = {
            textDocument: textDocument,
            position: position,
        }
        let lspItem: LSPTypeHierarchyItem
        try {
            lspItem = await commands.executeCommand(Commands.EXECUTE_WORKSPACE_COMMAND, Commands.OPEN_TYPE_HIERARCHY, JSON.stringify(params), JSON.stringify(direction), JSON.stringify(0), this.cancelTokenSource.token)
        } catch (e) {
            // operation cancelled
            return
        }
        if (!lspItem) {
            showNoLocationFound('No Type Hierarchy found')
            return
        }
        const symbolKind = lspItem.kind
        // this.client.protocol2CodeConverter.asSymbolKind()
        if (direction === TypeHierarchyDirection.both && symbolKind === SymbolKind.Interface) {
            direction = TypeHierarchyDirection.children
        }
        const item: TypeHierarchyItem = toTypeHierarchyItem(this.client, lspItem, direction)
        const input: TypeHierarchyTreeInput = new TypeHierarchyTreeInput(location, direction, this.cancelTokenSource.token, item)
        item.expand = true
        this.location = location
        this.direction = direction
        this.baseItem = item
        this.api.setInput(input)
    }

    public changeDirection(direction: TypeHierarchyDirection): void {
        if (!this.api) {
            return
        }
        if (this.cancelTokenSource) {
            this.cancelTokenSource.cancel()
        }
        this.cancelTokenSource = new CancellationTokenSource()
        this.baseItem.children = undefined
        this.baseItem.parents = undefined
        const input: TypeHierarchyTreeInput = new TypeHierarchyTreeInput(this.location, direction, this.cancelTokenSource.token, this.baseItem)
        this.direction = direction
        this.api.setInput(input)
    }

    public async changeBaseItem(item: TypeHierarchyItem): Promise<void> {
        if (!this.api) {
            return
        }
        if (this.cancelTokenSource) {
            this.cancelTokenSource.cancel()
        }
        this.cancelTokenSource = new CancellationTokenSource()
        item.parents = undefined
        item.children = undefined
        const location: Location = Location.create(item.uri, item.selectionRange)
        const newLocation: Location = (await this.isValidRequestPosition(Uri.parse(location.uri), location.range.start)) ? location : this.location
        const input: TypeHierarchyTreeInput = new TypeHierarchyTreeInput(newLocation, this.direction, this.cancelTokenSource.token, item)
        this.location = newLocation
        this.baseItem = item
        item.expand = true
        this.api.setInput(input)
    }

    private async isValidRequestPosition(uri: Uri, position: Position) {
        const doc = await workspace.openTextDocument(uri)
        let range = doc.getWordRangeAtPosition(position)
        if (!range) {
            range = doc.getWordRangeAtPosition(position, '.*$<>{}?[]()')
        }
        return Boolean(range)
    }
}

export const typeHierarchyTree: TypeHierarchyTree = new TypeHierarchyTree()

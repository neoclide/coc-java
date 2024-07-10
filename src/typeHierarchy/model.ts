import {CancellationToken, commands, Disposable, Emitter, Event, LanguageClient, Location, Position, SymbolKind, TreeDataProvider, TreeItem, TreeItemAction, TreeItemCollapsibleState, Uri, workspace} from 'coc.nvim'
import {Commands} from '../commands'
import {getActiveLanguageClient} from '../extension'
import {TypeHierarchyDirection, TypeHierarchyItem} from './protocol'
import {SymbolItemNavigation, SymbolTreeInput, SymbolTreeModel} from './references-view'
import {getRootItem, getSymbolKind, resolveTypeHierarchy} from './util'

export class TypeHierarchyTreeInput implements SymbolTreeInput<TypeHierarchyItem> {
    readonly contextValue: string = "javaTypeHierarchy";
    readonly title: string
    readonly baseItem: TypeHierarchyItem
    private client: LanguageClient
    private rootItem: TypeHierarchyItem

    constructor(readonly location: Location, public readonly direction: TypeHierarchyDirection, readonly token: CancellationToken, item: TypeHierarchyItem) {
        this.baseItem = item
        switch (direction) {
            case TypeHierarchyDirection.both:
                this.title = "Class Hierarchy"
                break
            case TypeHierarchyDirection.parents:
                this.title = "Supertype Hierarchy"
                break
            case TypeHierarchyDirection.children:
                this.title = "Subtype Hierarchy"
                break
            default:
                return
        }
    }

    async resolve(): Promise<SymbolTreeModel<TypeHierarchyItem>> {
        if (!this.client) {
            this.client = await getActiveLanguageClient()
        }
        // workaround: await a second to make sure the success of reveal operation on baseItem, see: https://github.com/microsoft/vscode/issues/114989
        await new Promise<void>((resolve) => setTimeout(() => {
            resolve()
        }, 500))

        this.rootItem = (this.direction === TypeHierarchyDirection.both) ? await getRootItem(this.client, this.baseItem, this.token) : this.baseItem
        const model: TypeHierarchyModel = new TypeHierarchyModel(this.rootItem, this.direction, this.baseItem)
        const provider = new TypeHierarchyTreeDataProvider(model, this.client, this.token)
        const treeModel: SymbolTreeModel<TypeHierarchyItem> = {
            provider: provider,
            message: undefined,
            navigation: model,
            dispose() {
                provider.dispose()
            }
        }
        // commands.executeCommand('setContext', 'typeHierarchyDirection', typeHierarchyDirectionToContextString(this.direction))
        // commands.executeCommand('setContext', 'typeHierarchySymbolKind', this.baseItem.kind)
        return treeModel
    }

    with(location: Location): TypeHierarchyTreeInput {
        return new TypeHierarchyTreeInput(location, this.direction, this.token, this.baseItem)
    }
}

export class TypeHierarchyModel implements SymbolItemNavigation<TypeHierarchyItem> {
    public readonly onDidChange = new Emitter<TypeHierarchyModel>();
    public readonly onDidChangeEvent = this.onDidChange.event;

    constructor(private rootItem: TypeHierarchyItem, private direction: TypeHierarchyDirection, private baseItem: TypeHierarchyItem) {}

    public getBaseItem(): TypeHierarchyItem {
        return this.baseItem
    }

    public getDirection(): TypeHierarchyDirection {
        return this.direction
    }

    public getRootItem(): TypeHierarchyItem {
        return this.rootItem
    }

    location(item: TypeHierarchyItem) {
        return Location.create(item.uri, item.range)
    }

    nearest(uri: Uri, _position: Position): TypeHierarchyItem | undefined {
        return this.baseItem
    }

    next(from: TypeHierarchyItem): TypeHierarchyItem {
        return from
    }

    previous(from: TypeHierarchyItem): TypeHierarchyItem {
        return from
    }
}

class TypeHierarchyTreeDataProvider implements TreeDataProvider<TypeHierarchyItem> {
    private readonly emitter: Emitter<TypeHierarchyItem> = new Emitter<TypeHierarchyItem>()
    private readonly modelListener: Disposable
    private lazyLoad: boolean
    private labels: {[key: string]: string}
    public winid: number
    public readonly onDidChangeTreeData: Event<TypeHierarchyItem> = this.emitter.event

    constructor(readonly model: TypeHierarchyModel, readonly client: LanguageClient, readonly token: CancellationToken) {
        this.modelListener = model.onDidChangeEvent(e => this.emitter.fire(e instanceof TypeHierarchyItem ? e : undefined))
        this.lazyLoad = workspace.getConfiguration().get("java.typeHierarchy.lazyLoad")
        this.labels = workspace.getConfiguration().get('suggest.completionItemKindLabels', {})
    }

    dispose(): void {
        this.emitter.dispose()
        this.modelListener.dispose()
    }

    async getTreeItem(element: TypeHierarchyItem): Promise<TreeItem> {
        if (!element) {
            return undefined
        }
        const treeItem: TreeItem = (element === this.model.getBaseItem()) ? new TreeItem({label: element.name, highlights: [[0, element.name.length]]}) : new TreeItem(element.name)
        // treeItem.contextValue = (element === this.model.getBaseItem() || !element.uri) ? "false" : "true"
        treeItem.description = element.detail
        treeItem.icon = this.getIcon(element.kind)
        if (!element.selectionRange) return undefined
        let start = element.selectionRange.start
        treeItem.command = (element.uri) ? {
            command: Commands.OPEN_TYPE_HIERARCHY_LOCATION,
            title: 'Open Type Definition Location',
            arguments: [element.uri, start]
        } : undefined
        // workaround: set a specific id to refresh the collapsible state for treeItems, see: https://github.com/microsoft/vscode/issues/114614#issuecomment-763428052
        treeItem.id = `${element.data}${Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)}`
        if (element.expand) {
            treeItem.collapsibleState = TreeItemCollapsibleState.Expanded
        } else if (this.model.getDirection() === TypeHierarchyDirection.children || this.model.getDirection() === TypeHierarchyDirection.both) {
            // For an unresolved baseItem, will make it collapsed to show it early. It will be automatically expanded by model.nearest()
            if (element === this.model.getBaseItem()) {
                if (!element.children) {
                    treeItem.collapsibleState = TreeItemCollapsibleState.Collapsed
                } else if (element.children.length === 0) {
                    treeItem.collapsibleState = TreeItemCollapsibleState.None
                } else {
                    treeItem.collapsibleState = TreeItemCollapsibleState.Expanded
                }
            } else {
                if (!element.children) {
                    if (this.lazyLoad) {
                        treeItem.collapsibleState = TreeItemCollapsibleState.Collapsed
                        return treeItem
                    }
                    const resolvedItem = await resolveTypeHierarchy(this.client, element, this.model.getDirection(), this.token)
                    if (!resolvedItem) {
                        return undefined
                    }
                    element.children = resolvedItem.children
                }
                treeItem.collapsibleState = (element.children.length === 0) ? TreeItemCollapsibleState.None : TreeItemCollapsibleState.Collapsed
            }
        } else if (this.model.getDirection() === TypeHierarchyDirection.parents) {
            if (element === this.model.getBaseItem()) {
                if (!element.parents) {
                    treeItem.collapsibleState = TreeItemCollapsibleState.Collapsed
                } else if (element.parents.length === 0) {
                    treeItem.collapsibleState = TreeItemCollapsibleState.None
                } else {
                    treeItem.collapsibleState = TreeItemCollapsibleState.Expanded
                }
            } else {
                if (!element.parents) {
                    if (this.lazyLoad) {
                        treeItem.collapsibleState = TreeItemCollapsibleState.Collapsed
                        return treeItem
                    }
                    const resolvedItem = await resolveTypeHierarchy(this.client, element, this.model.getDirection(), this.token)
                    if (!resolvedItem) {
                        return undefined
                    }
                    element.parents = resolvedItem.parents
                }
                treeItem.collapsibleState = (element.parents.length === 0) ? TreeItemCollapsibleState.None : TreeItemCollapsibleState.Collapsed
            }
        }
        return treeItem
    }

    public async resolveActions(item: TreeItem, typeHierarchyItem: TypeHierarchyItem): Promise<TreeItemAction<TypeHierarchyItem>[]> {
        let actions: TreeItemAction<TypeHierarchyItem>[] = []
        // always exists
        actions.push({
            title: 'Base on this Type',
            handler: async (item) => {
                await commands.executeCommand(Commands.CHANGE_BASE_TYPE, item)
            }
        })
        if (this.model.getDirection() != TypeHierarchyDirection.both && this.model.getBaseItem().kind != SymbolKind.Enum) {
            actions.push({
                title: 'Show Class Hierarchy',
                handler: async item => {
                    await commands.executeCommand(Commands.SHOW_CLASS_HIERARCHY)
                }
            })
        }
        if (this.model.getDirection() != TypeHierarchyDirection.parents) {
            actions.push({
                title: 'Show Supertype Hierarchy',
                handler: async item => {
                    await commands.executeCommand(Commands.SHOW_SUPERTYPE_HIERARCHY)
                }
            })
        }
        if (this.model.getDirection() != TypeHierarchyDirection.children) {
            actions.push({
                title: 'Show Subtype Hierarchy',
                handler: async item => {
                    await commands.executeCommand(Commands.SHOW_SUBTYPE_HIERARCHY)
                }
            })
        }
        return actions
    }

    async getChildren(element?: TypeHierarchyItem | undefined): Promise<TypeHierarchyItem[]> {
        if (!element) {
            return [this.model.getRootItem()]
        }
        if (this.model.getDirection() === TypeHierarchyDirection.children || this.model.getDirection() === TypeHierarchyDirection.both) {
            if (!element.children) {
                if (TypeHierarchyTreeDataProvider.isWhiteListType(element)) {
                    return [TypeHierarchyTreeDataProvider.getFakeItem(element)]
                }
                const resolvedItem = await resolveTypeHierarchy(this.client, element, this.model.getDirection(), this.token)
                if (!resolvedItem) {
                    return undefined
                }
                element.children = resolvedItem.children
                if (element.children.length === 0) {
                    this.emitter.fire(element)
                }
            }
            return element.children
        } else if (this.model.getDirection() === TypeHierarchyDirection.parents) {
            if (!element.parents) {
                const resolvedItem = await resolveTypeHierarchy(this.client, element, this.model.getDirection(), this.token)
                if (!resolvedItem) {
                    return undefined
                }
                element.parents = resolvedItem.parents
                if (element.parents.length === 0) {
                    this.emitter.fire(element)
                }
            }
            return element.parents
        }
        return undefined
    }

    private getIcon(kind: SymbolKind): {text: string, hlGroup: string} {
        let {labels} = this
        let kindText = getSymbolKind(kind)
        let defaultIcon = typeof labels['default'] === 'string' ? labels['default'] : kindText[0].toLowerCase()
        let text = kindText == 'Unknown' ? '' : labels[kindText[0].toLowerCase() + kindText.slice(1)]
        if (!text) text = defaultIcon
        return {
            text,
            hlGroup: kindText == 'Unknown' ? 'CocSymbolDefault' : `CocSymbol${kindText}`
        }
    }

    private static isWhiteListType(item: TypeHierarchyItem): boolean {
        if (item.name === "Object" && item.detail === "java.lang") {
            return true
        }
        return false
    }

    private static getFakeItem(item: TypeHierarchyItem): TypeHierarchyItem {
        let message: string
        if (item.name === "Object" && item.detail === "java.lang") {
            message = "All classes are subtypes of java.lang.Object."
        }
        return {
            name: message,
            kind: undefined,
            children: [],
            parents: [],
            detail: undefined,
            uri: undefined,
            range: undefined,
            selectionRange: undefined,
            data: undefined,
            deprecated: false,
            expand: false,
        }
    }

    private static themeIconIds = [
        'symbol-file', 'symbol-module', 'symbol-namespace', 'symbol-package', 'symbol-class', 'symbol-method',
        'symbol-property', 'symbol-field', 'symbol-constructor', 'symbol-enum', 'symbol-interface',
        'symbol-function', 'symbol-variable', 'symbol-constant', 'symbol-string', 'symbol-number', 'symbol-boolean',
        'symbol-array', 'symbol-object', 'symbol-key', 'symbol-null', 'symbol-enum-member', 'symbol-struct',
        'symbol-event', 'symbol-operator', 'symbol-type-parameter'
    ]
}

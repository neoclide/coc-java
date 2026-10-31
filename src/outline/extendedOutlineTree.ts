import {
  commands,
  Disposable,
  ExtensionContext,
  LanguageClient,
  Position,
  SymbolKind,
  TextDocumentIdentifier,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  TreeView,
  Uri,
  window,
  workspace,
} from 'coc.nvim'
import { DocumentSymbolParams } from 'vscode-languageserver-protocol'
import { Commands } from '../commands'
import { getSymbolKind } from '../typeHierarchy/util'
import { ExtendedDocumentSymbol, ExtendedDocumentSymbolRequest } from './protocol'

export interface ExtendedOutlineNode extends ExtendedDocumentSymbol {
  children: ExtendedOutlineNode[]
  parent?: ExtendedOutlineNode
  treeId: string
}

function isExtendedOutlineContainer(kind: SymbolKind): boolean {
  return kind === SymbolKind.Class || kind === SymbolKind.Interface
}

/**
 * Preserve the upstream layout: every top-level symbol is shown, while the
 * direct members of classes and interfaces are expanded beneath their owner.
 */
export function createExtendedOutlineNodes(symbols: ExtendedDocumentSymbol[]): ExtendedOutlineNode[] {
  return (symbols || []).map((symbol, rootIndex) => {
    const root = createNode(symbol, `root:${rootIndex}`)
    if (isExtendedOutlineContainer(root.kind)) {
      root.children = (symbol.children || []).map((child, childIndex) => {
        return createNode(child, `${root.treeId}:child:${childIndex}`, root)
      })
    }
    return root
  })
}

function createNode(symbol: ExtendedDocumentSymbol, treeId: string, parent?: ExtendedOutlineNode): ExtendedOutlineNode {
  return {
    ...symbol,
    children: [],
    parent,
    treeId,
  }
}

export class ExtendedOutlineTreeDataProvider implements TreeDataProvider<ExtendedOutlineNode> {
  private readonly labels: Record<string, string>

  constructor(private readonly roots: ExtendedOutlineNode[]) {
    this.labels = workspace.getConfiguration().get<Record<string, string>>('suggest.completionItemKindLabels', {})
  }

  public getChildren(element?: ExtendedOutlineNode): ExtendedOutlineNode[] {
    return element ? element.children : this.roots
  }

  public getParent(element: ExtendedOutlineNode): ExtendedOutlineNode | undefined {
    return element.parent
  }

  public getTreeItem(element: ExtendedOutlineNode): TreeItem {
    const collapsibleState = element.children.length
      ? TreeItemCollapsibleState.Expanded
      : TreeItemCollapsibleState.None
    const item = new TreeItem(element.name, collapsibleState)
    item.id = element.treeId
    item.description = element.detail?.trim()
    item.icon = this.getIcon(element.kind)
    if (element.uri && element.range) {
      item.command = {
        command: Commands.OPEN_EXTENDED_OUTLINE_LOCATION,
        title: 'Open Extended Outline Symbol',
        arguments: [element.uri, element.range.start],
      }
    }
    return item
  }

  private getIcon(kind: SymbolKind): { text: string, hlGroup: string } {
    const kindText = getSymbolKind(kind)
    const key = kindText[0].toLowerCase() + kindText.slice(1)
    const fallback = typeof this.labels.default === 'string' ? this.labels.default : key[0]
    return {
      text: this.labels[key] || fallback,
      hlGroup: kindText === 'Unknown' ? 'CocSymbolDefault' : `CocSymbol${kindText}`,
    }
  }
}

export class ExtendedOutlineTree implements Disposable {
  private client: LanguageClient
  private sourceWindowId: number | undefined
  private treeView: TreeView<ExtendedOutlineNode> | undefined

  public initialize(context: ExtensionContext, client: LanguageClient): void {
    this.client = client
    context.subscriptions.push(
      commands.registerCommand(Commands.SHOW_EXTENDED_OUTLINE, async (location?: Uri | string) => {
        await this.open(location)
      }),
      commands.registerCommand(Commands.OPEN_EXTENDED_OUTLINE_LOCATION, async (uri: string, position: Position) => {
        await this.openLocation(uri, position)
      }, undefined, true),
      this,
    )
  }

  public async open(location?: Uri | string): Promise<void> {
    let uri: Uri | undefined
    if (location instanceof Uri) {
      uri = location
    } else if (typeof location === 'string') {
      uri = Uri.parse(location)
    } else {
      const document = window.activeTextEditor?.document
      if (!document || document.languageId !== 'java') return
      uri = Uri.parse(document.uri)
    }

    const currentWindowId = await workspace.nvim.call('win_getid', []) as number
    const sourceWindowId = currentWindowId === this.treeView?.windowId
      ? this.sourceWindowId || currentWindowId
      : currentWindowId

    const params: DocumentSymbolParams = {
      textDocument: TextDocumentIdentifier.create(uri.toString()),
    }
    const symbols = await this.client.sendRequest(
      ExtendedDocumentSymbolRequest.type,
      params,
    ) as ExtendedDocumentSymbol[] | null
    const nodes = createExtendedOutlineNodes(symbols || [])
    if (!nodes.length) {
      window.showInformationMessage('No Java symbols found for the extended outline.')
      return
    }

    await this.close()
    this.sourceWindowId = sourceWindowId
    const treeView = window.createTreeView('javaExtendedOutline', {
      treeDataProvider: new ExtendedOutlineTreeDataProvider(nodes),
      enableFilter: true,
      bufhidden: 'wipe',
    })
    treeView.title = 'Java Extended Outline'
    this.treeView = treeView
    treeView.onDidChangeVisibility(event => {
      if (!event.visible && this.treeView === treeView) {
        this.treeView = undefined
      }
    })
    const splitCommand = workspace.getConfiguration('outline').get<string>('splitCommand', 'botright 30vs')
    await treeView.show(splitCommand)
  }

  public dispose(): void {
    const treeView = this.treeView
    this.treeView = undefined
    if (treeView?.windowId) {
      workspace.nvim.call('coc#window#close', [treeView.windowId], true)
    } else {
      treeView?.dispose()
    }
    this.client = undefined
    this.sourceWindowId = undefined
  }

  public async close(): Promise<void> {
    const treeView = this.treeView
    this.treeView = undefined
    if (!treeView) return
    if (treeView.windowId) {
      await workspace.nvim.call('coc#window#close', [treeView.windowId])
    } else {
      treeView.dispose()
    }
  }

  private async openLocation(uri: string, position: Position): Promise<void> {
    if (this.sourceWindowId) {
      const sourceWindow = workspace.nvim.createWindow(this.sourceWindowId)
      if (await sourceWindow.valid) {
        await workspace.nvim.call('win_gotoid', [this.sourceWindowId])
      }
    }
    await workspace.jumpTo(uri, position, 'edit')
  }
}

export const extendedOutlineTree = new ExtendedOutlineTree()

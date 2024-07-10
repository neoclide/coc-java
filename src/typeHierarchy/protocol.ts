import {Range, SymbolKind} from 'coc.nvim'

export enum TypeHierarchyDirection {
    children,
    parents,
    both
}

export class LSPTypeHierarchyItem {
    name: string
    detail: string
    kind: SymbolKind
    deprecated: boolean
    uri: string
    range: Range
    selectionRange: Range
    parents: LSPTypeHierarchyItem[]
    children: LSPTypeHierarchyItem[]
    data: any
}

export class TypeHierarchyItem {
    name: string
    detail: string
    kind: SymbolKind
    deprecated: boolean
    uri: string
    range: Range
    selectionRange: Range
    parents: TypeHierarchyItem[]
    children: TypeHierarchyItem[]
    data: any
    expand: boolean
}

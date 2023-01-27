import { CancellationToken, commands, LanguageClient, SymbolKind } from 'coc.nvim'
import { Commands } from '../commands'
import { LSPTypeHierarchyItem, TypeHierarchyDirection, TypeHierarchyItem } from './protocol'

export function toSingleLSPTypeHierarchyItem(client: LanguageClient, typeHierarchyItem: TypeHierarchyItem): LSPTypeHierarchyItem {
  if (!typeHierarchyItem) {
    return undefined
  }
  return {
    name: typeHierarchyItem.name,
    detail: typeHierarchyItem.detail,
    kind: typeHierarchyItem.kind,
    deprecated: typeHierarchyItem.deprecated,
    uri: typeHierarchyItem.uri,
    range: typeHierarchyItem.range,
    selectionRange: typeHierarchyItem.selectionRange,
    parents: undefined,
    children: undefined,
    data: typeHierarchyItem.data,
  }
}

export function toTypeHierarchyItem(client: LanguageClient, lspTypeHierarchyItem: LSPTypeHierarchyItem, direction: TypeHierarchyDirection): TypeHierarchyItem {
  if (!lspTypeHierarchyItem) {
    return undefined
  }
  let parents: TypeHierarchyItem[]
  let children: TypeHierarchyItem[]
  if (direction === TypeHierarchyDirection.parents || direction === TypeHierarchyDirection.both) {
    if (lspTypeHierarchyItem.parents) {
      parents = []
      for (const parent of lspTypeHierarchyItem.parents) {
        parents.push(toTypeHierarchyItem(client, parent, TypeHierarchyDirection.parents))
      }
      parents = parents.sort((a, b) => {
        return (a.kind.toString() === b.kind.toString()) ? a.name.localeCompare(b.name) : b.kind.toString().localeCompare(a.kind.toString())
      })
    }
  }
  if (direction === TypeHierarchyDirection.children || direction === TypeHierarchyDirection.both) {
    if (lspTypeHierarchyItem.children) {
      children = []
      for (const child of lspTypeHierarchyItem.children) {
        children.push(toTypeHierarchyItem(client, child, TypeHierarchyDirection.children))
      }
      children = children.sort((a, b) => {
        return (a.kind.toString() === b.kind.toString()) ? a.name.localeCompare(b.name) : b.kind.toString().localeCompare(a.kind.toString())
      })
    }
  }
  return {
    name: lspTypeHierarchyItem.name,
    detail: lspTypeHierarchyItem.detail,
    kind: lspTypeHierarchyItem.kind,
    deprecated: lspTypeHierarchyItem.deprecated,
    uri: lspTypeHierarchyItem.uri,
    range: lspTypeHierarchyItem.range,
    selectionRange: lspTypeHierarchyItem.selectionRange,
    parents: parents,
    children: children,
    data: lspTypeHierarchyItem.data,
    expand: false,
  }
}

export function typeHierarchyDirectionToContextString(direction: TypeHierarchyDirection): string {
  switch (direction) {
    case TypeHierarchyDirection.children:
      return "children"
    case TypeHierarchyDirection.parents:
      return "parents"
    case TypeHierarchyDirection.both:
      return "both"
    default:
      return undefined
  }
}

export async function resolveTypeHierarchy(client: LanguageClient, typeHierarchyItem: TypeHierarchyItem, direction: TypeHierarchyDirection, token: CancellationToken): Promise<TypeHierarchyItem> {
  const lspTypeHierarchyItem = toSingleLSPTypeHierarchyItem(client, typeHierarchyItem)
  let resolvedLSPItem: LSPTypeHierarchyItem
  try {
    resolvedLSPItem = await commands.executeCommand<LSPTypeHierarchyItem>(Commands.EXECUTE_WORKSPACE_COMMAND, Commands.RESOLVE_TYPE_HIERARCHY, JSON.stringify(lspTypeHierarchyItem), JSON.stringify(direction), JSON.stringify(1), token)
  } catch (e) {
    // operation cancelled
    return undefined
  }
  const resolvedItem = toTypeHierarchyItem(client, resolvedLSPItem, direction)
  if (!resolvedItem) {
    return undefined
  }
  resolvedItem.expand = typeHierarchyItem.expand
  return resolvedItem
}

export async function getRootItem(client: LanguageClient, typeHierarchyItem: TypeHierarchyItem, token: CancellationToken): Promise<TypeHierarchyItem> {
  if (!typeHierarchyItem) {
    return undefined
  }
  if (!typeHierarchyItem.parents) {
    const resolvedItem = await resolveTypeHierarchy(client, typeHierarchyItem, TypeHierarchyDirection.parents, token)
    if (!resolvedItem || !resolvedItem.parents) {
      return typeHierarchyItem
    } else {
      typeHierarchyItem.parents = resolvedItem.parents
    }
  }
  if (typeHierarchyItem.parents.length === 0) {
    return typeHierarchyItem
  } else {
    for (const parent of typeHierarchyItem.parents) {
      if (parent.kind === SymbolKind.Class) {
        parent.children = [typeHierarchyItem]
        parent.expand = true
        return getRootItem(client, parent, token)
      }
    }
    return typeHierarchyItem
  }
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

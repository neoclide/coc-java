import { CodeActionKind, CodeActionProvider, CodeActionProviderMetadata } from 'coc.nvim'

/**
 * Mapping the refactoring kind to its section id in the document
 */
export const javaRefactorKinds: Map<CodeActionKind, string> = new Map([
  [CodeActionKind.Refactor, 'java-refactoring'],
  [CodeActionKind.RefactorExtract, 'extract-to-constant'],
  [CodeActionKind.RefactorExtract + '.function', 'extract-to-method'],
  [CodeActionKind.RefactorExtract + '.constant', 'extract-to-constant'],
  [CodeActionKind.RefactorExtract + '.variable', 'extract-to-local-variable'],
  [CodeActionKind.RefactorExtract + '.field', 'extract-to-field'],
  [CodeActionKind.RefactorInline, 'inline-constant'],
  [CodeActionKind.Refactor + '.move', 'move'],
  [CodeActionKind.Refactor + '.assign', 'assign-to-variable'],
  [CodeActionKind.Refactor + '.introduce' + '.parameter', 'introduce-parameter']
])

export class RefactorDocumentProvider implements CodeActionProvider {
  provideCodeActions() {
    return []
  }

  public static readonly metadata: CodeActionProviderMetadata = {
    providedCodeActionKinds: [
      CodeActionKind.Refactor
    ]
  }
}

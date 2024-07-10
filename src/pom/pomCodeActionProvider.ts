'use strict'

import {CancellationToken, CodeAction, CodeActionContext, CodeActionKind, CodeActionProvider, CodeActionProviderMetadata, Command, commands, Diagnostic, ExtensionContext, LinesTextDocument, ProviderResult, Range, TextEditor, Uri, window, workspace, WorkspaceEdit} from 'coc.nvim'
import {TextDocumentEdit, TextEdit} from 'vscode-languageserver-protocol'
import {Commands} from '../commands'

export class PomCodeActionProvider implements CodeActionProvider<CodeAction> {
    constructor(context: ExtensionContext) {
        context.subscriptions.push(commands.registerCommand("_java.projectConfiguration.saveAndUpdate", async (uri: Uri) => {
            await workspace.openTextDocument(uri)
            await workspace.nvim.command('noa w')
            commands.executeCommand(Commands.CONFIGURATION_UPDATE, uri)
        }))
    }

    provideCodeActions(document: LinesTextDocument, range: Range, context: CodeActionContext, token: CancellationToken): ProviderResult<(Command | CodeAction)[]> {
        if (context?.diagnostics?.length && context.diagnostics[0].source === "Java") {
            return this.collectCodeActions(document, context.diagnostics)
        }

        return undefined
    }

    collectCodeActions(document: LinesTextDocument, diagnostics: readonly Diagnostic[]): CodeAction[] {
        const codeActions: CodeAction[] = []
        for (const diagnostic of diagnostics) {
            if (diagnostic.message?.startsWith("Plugin execution not covered by lifecycle configuration")) {
                const indentation = this.getNewTextIndentation(document, diagnostic)
                const saveAndUpdateConfigCommand: Command = {
                    title: "Save and reload project",
                    command: "_java.projectConfiguration.saveAndUpdate",
                    arguments: [document.uri],
                }

                const action1 = CodeAction.create("Enable this execution in project configuration phase", CodeActionKind.QuickFix + ".pom")
                let edit: WorkspaceEdit = {documentChanges: []}
                action1.edit = edit
                edit.documentChanges.push(
                    TextDocumentEdit.create({uri: document.uri, version: document.version}, [
                        TextEdit.insert(diagnostic.range.end, `${indentation}<?m2e execute onConfiguration?>`)
                    ]
                    ))
                action1.command = saveAndUpdateConfigCommand
                codeActions.push(action1)

                const action2 = CodeAction.create("Enable this execution in project build phase", CodeActionKind.QuickFix + ".pom")
                action2.edit = {documentChanges: []}
                action2.edit.documentChanges.push(
                    TextDocumentEdit.create({uri: document.uri, version: document.version}, [
                        TextEdit.insert(diagnostic.range.end, `${indentation}<?m2e execute onConfiguration,onIncremental?>`)
                    ]
                    ))
                action2.command = saveAndUpdateConfigCommand
                codeActions.push(action2)

                const action3 = CodeAction.create("Mark this execution as ignored in pom.xml", CodeActionKind.QuickFix + ".pom")
                action3.edit = {documentChanges: []}
                action2.edit.documentChanges.push(
                    TextDocumentEdit.create({uri: document.uri, version: document.version}, [
                        TextEdit.insert(diagnostic.range.end, `${indentation}<?m2e ignore?>`)
                    ]
                    ))
                action3.command = saveAndUpdateConfigCommand
                codeActions.push(action3)
            } else if (diagnostic.message?.startsWith("The build file has been changed")) {
                const reloadProjectAction = CodeAction.create("Reload project", CodeActionKind.QuickFix)
                reloadProjectAction.command = {
                    title: "Reload Project",
                    command: Commands.CONFIGURATION_UPDATE,
                    arguments: [document.uri],
                }
                codeActions.push(reloadProjectAction)
            }
        }

        return codeActions
    }

    getNewTextIndentation(document: LinesTextDocument, diagnostic: Diagnostic): string {
        const textline = document.lineAt(diagnostic.range.end.line)
        if (textline.text.lastIndexOf("</execution>") > diagnostic.range.end.character) {
            return ""
        }

        let tabSize: number = 2 // default value
        let insertSpaces: boolean = true // default value
        const activeEditor: TextEditor | undefined = window.activeTextEditor
        if (activeEditor && activeEditor.document.uri.toString() === document.uri.toString()) {
            tabSize = Number(activeEditor.options.tabSize)
            insertSpaces = Boolean(activeEditor.options.insertSpaces)
        }

        const lineSeparator = '\n'
        let newIndentation = lineSeparator + textline.text.substring(0, textline.firstNonWhitespaceCharacterIndex)
        if (insertSpaces) {
            for (let i = 0; i < tabSize; i++) {
                newIndentation += ' ' // insert a space char.
            }
        } else {
            newIndentation += '	' // insert a tab char.
        }

        return newIndentation
    }
}

export const pomCodeActionMetadata: CodeActionProviderMetadata = {
    providedCodeActionKinds: [
        CodeActionKind.QuickFix + '.pom'
    ],
}

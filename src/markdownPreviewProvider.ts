import {Disposable, ExtensionContext, Uri, workspace} from 'coc.nvim'
import * as fse from 'fs-extra'
import {marked} from 'marked'
import os from 'os'
import * as path from 'path'
import {v4 as uuid} from 'uuid'

class MarkdownPreviewProvider implements Disposable {
    // a cache maps document path to rendered html
    private documentCache: Map<string, string> = new Map<string, string>();
    private disposables: Disposable[] = [];

    public async show(markdownFilePath: string, title: string, section: string, context: ExtensionContext): Promise<void> {
        const html = await this.getHtmlContent(markdownFilePath, section, context)
        let filepath = path.join(os.tmpdir(), `${uuid()}.html`)
        await fse.writeFile(filepath, html)
        await workspace.nvim.call('coc#ui#open_url', [Uri.file(filepath).toString()])
        // this.panel.iconPath = Uri.file(path.join(context.extensionPath, 'icons', 'icon128.png'))
        // this.panel.webview.html = await this.getHtmlContent(this.panel.webview, markdownFilePath, section, context)
        // this.panel.title = title
        // this.panel.reveal(this.panel.viewColumn)
    }

    public dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose()
        }
    }

    protected async getHtmlContent(markdownFilePath: string, section: string, context: ExtensionContext): Promise<string> {
        const nonce: string = this.getNonce()
        const styles: string = this.getStyles(context)
        let body: string | undefined = this.documentCache.get(markdownFilePath)
        if (!body) {
            let markdownString: string = await fse.readFile(markdownFilePath, 'utf8')
            markdownString = markdownString.replace(/__VSCODE_ENV_APPNAME_PLACEHOLDER__/, 'coc.nvim')
            marked.setOptions({
                gfm: true,
                breaks: true
            })
            body = marked(markdownString)
            this.documentCache.set(markdownFilePath, body)
        }
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src file:; img-src 'self' file: https: data:; script-src 'nonce-${nonce}';"/>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                ${styles}
                <base href="${Uri.file(markdownFilePath).toString()}">
            </head>
            <body class="vscode-body scrollBeyondLastLine wordWrap showEditorSelection">
                ${body}
                <button class="btn floating-bottom-right" id="back-to-top-btn">
                    <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                        <path fill-rule="evenodd" clip-rule="evenodd" d="M8 6.04042L3.02022 11.0202L2.31311 10.3131L7.64644 4.97976L8.35355 4.97976L13.6869 10.3131L12.9798 11.0202L8 6.04042Z"/>
                    </svg>
                </button>
                <script nonce="${nonce}">
                    (function() {
                        var element = document.querySelector('[id^="${section}"]');
                        if (element) {
                            element.scrollIntoView(true);
                        }
                        var backToTopBtn = document.getElementById('back-to-top-btn');
                        if (backToTopBtn) {
                            backToTopBtn.onclick = () => document.documentElement.scrollTop = 0;
                        }
                    })();
                </script>
            </body>
            </html>
        `
    }

    protected getStyles(context: ExtensionContext): string {
        const styles: Uri[] = [
            Uri.file(path.join(context.extensionPath, 'webview-resources', 'highlight.css')),
            Uri.file(path.join(context.extensionPath, 'webview-resources', 'markdown.css')),
            Uri.file(path.join(context.extensionPath, 'webview-resources', 'document.css')),
        ]
        return styles.map((styleUri: Uri) => `<link rel="stylesheet" type="text/css" href="${styleUri.toString()}">`).join('\n')
    }

    private getNonce(): string {
        let text = ""
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length))
        }
        return text
    }
}

export const markdownPreviewProvider: MarkdownPreviewProvider = new MarkdownPreviewProvider()

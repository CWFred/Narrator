import * as vscode from "vscode";
import { getNonce } from "./messageHandler";

export class NarratorPanel {
  public static currentPanel: NarratorPanel | undefined;
  private static readonly viewType = "narratorPanel";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri): NarratorPanel {
    if (NarratorPanel.currentPanel) {
      NarratorPanel.currentPanel._panel.reveal(vscode.ViewColumn.Beside);
      return NarratorPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      NarratorPanel.viewType,
      "Narrator",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "webview-ui", "dist"),
        ],
      }
    );

    NarratorPanel.currentPanel = new NarratorPanel(panel, extensionUri);
    return NarratorPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.webview.html = this._getHtmlForWebview();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public postMessage(message: unknown) {
    this._panel.webview.postMessage(message);
  }

  public get webview(): vscode.Webview {
    return this._panel.webview;
  }

  public dispose() {
    NarratorPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      d?.dispose();
    }
  }

  private _getHtmlForWebview(): string {
    const webview = this._panel.webview;
    const nonce = getNonce();

    // Try to load the built React app
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "webview-ui", "dist", "index.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "webview-ui",
        "dist",
        "index.css"
      )
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-eval'; media-src blob: data: *; connect-src blob: data:;">
  <link rel="stylesheet" href="${styleUri}">
  <title>Narrator</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

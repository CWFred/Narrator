import * as vscode from "vscode";
import { NarratorPanel } from "../webview/panel";

export function registerFollowUpCommand(
  context: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.commands.registerCommand("narrator.followUp", async () => {
    if (!NarratorPanel.currentPanel) {
      vscode.window.showWarningMessage(
        "Narrator: No active explanation. Use 'Explain with Narrator' first."
      );
      return;
    }

    const question = await vscode.window.showInputBox({
      prompt: "Ask a follow-up question about this code",
      placeHolder: "e.g., What does the error handling do here?",
    });

    if (question) {
      // Route through the webview so the explain command handler picks it up
      NarratorPanel.currentPanel.postMessage({
        type: "triggerFollowUp",
        payload: { question },
      });
    }
  });
}

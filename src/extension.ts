import * as vscode from "vscode";
import { registerExplainCommand } from "./commands/explain";
import { registerFollowUpCommand } from "./commands/followUp";
import { registerSetupCommand } from "./commands/setup";
import { registerExplainRepoCommand } from "./commands/explainRepo";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(registerExplainCommand(context));
  context.subscriptions.push(registerFollowUpCommand(context));
  context.subscriptions.push(registerSetupCommand(context));
  context.subscriptions.push(registerExplainRepoCommand(context));
}

export function deactivate() {}

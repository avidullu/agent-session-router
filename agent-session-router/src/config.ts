/**
 * Extension configuration — mirrors the contributes.configuration schema.
 */

import * as vscode from 'vscode';

export interface SourceConfig {
    enabled: boolean;
}

export interface WatchConfig {
    enabled: boolean;
    debounceMs: number;
}

export interface Config {
    enabled: boolean;
    outputDir: string;
    sources: {
        copilotChat: SourceConfig;
        deepseek: SourceConfig;
    };
    watch: WatchConfig;
    maxSessionAge: string;
}

export function getConfig(): Config {
    const cfg = vscode.workspace.getConfiguration('agentSessionRouter');
    return {
        enabled: cfg.get<boolean>('enabled', true),
        outputDir: cfg.get<string>('outputDir', ''),
        sources: {
            copilotChat: {
                enabled: cfg.get<boolean>('sources.copilotChat.enabled', true),
            },
            deepseek: {
                enabled: cfg.get<boolean>('sources.deepseek.enabled', true),
            },
        },
        watch: {
            enabled: cfg.get<boolean>('watch.enabled', false),
            debounceMs: cfg.get<number>('watch.debounceMs', 5000),
        },
        maxSessionAge: cfg.get<string>('maxSessionAge', '90d'),
    };
}

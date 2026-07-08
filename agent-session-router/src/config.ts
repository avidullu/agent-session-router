/**
 * Extension configuration — mirrors the contributes.configuration schema.
 */

// vscode may not be available when running outside VS Code (e.g., tests)
let vscodeApi: any;
try {
    vscodeApi = require('vscode');
} catch {
    vscodeApi = undefined;
}

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

/** Default config used when running outside VS Code (tests, CLI). */
const DEFAULT_CONFIG: Config = {
    enabled: true,
    outputDir: '',
    sources: {
        copilotChat: { enabled: true },
        deepseek: { enabled: true },
    },
    watch: {
        enabled: false,
        debounceMs: 5000,
    },
    maxSessionAge: '90d',
};

export function getConfig(): Config {
    if (!vscodeApi) {
        return { ...DEFAULT_CONFIG };
    }
    const cfg = vscodeApi.workspace.getConfiguration('agentSessionRouter');
    return {
        enabled: cfg.get('enabled', true),
        outputDir: cfg.get('outputDir', ''),
        sources: {
            copilotChat: {
                enabled: cfg.get('sources.copilotChat.enabled', true),
            },
            deepseek: {
                enabled: cfg.get('sources.deepseek.enabled', true),
            },
        },
        watch: {
            enabled: cfg.get('watch.enabled', false),
            debounceMs: cfg.get('watch.debounceMs', 5000),
        },
        maxSessionAge: cfg.get('maxSessionAge', '90d'),
    };
}

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
    /** Source kinds → config. Key is the discoverer kind (e.g. 'copilot_chat', 'deepseek_request_dump').
     *  New agents register with a kind and are automatically picked up — no core edits needed. */
    sources: Record<string, SourceConfig>;
    watch: WatchConfig;
    maxSessionAge: string;
}

/** Default config used when running outside VS Code (tests, CLI). */
const DEFAULT_CONFIG: Config = {
    enabled: true,
    outputDir: '',
    sources: {
        copilot_chat: { enabled: true },
        deepseek_request_dump: { enabled: true },
        // Backward-compat aliases (v0.1.x key names)
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
    const cfg: any = vscodeApi.workspace.getConfiguration('agentSessionRouter');

    // Read sources as a generic object — any key works (pluggable)
    const sourcesConfig: Record<string, any> = cfg.get('sources', {}) || {};
    const sources: Record<string, SourceConfig> = {};

    // Backward-compat: map old config keys (v0.1.x) to new discoverer-kind keys.
    // Users upgrading from the hardcoded-key era won't lose their preferences.
    const OLD_KEY_MAP: Record<string, string> = {
        copilotChat: 'copilot_chat',
        deepseek: 'deepseek_request_dump',
    };

    for (const [key, val] of Object.entries(sourcesConfig)) {
        if (val && typeof val === 'object' && 'enabled' in val) {
            sources[key] = { enabled: (val as any).enabled !== false };
        } else if (val && typeof val === 'object') {
            sources[key] = { enabled: true };
        }
    }

    // Also check old per-key paths: sources.copilotChat.enabled, sources.deepseek.enabled
    for (const [oldKey, newKey] of Object.entries(OLD_KEY_MAP)) {
        if (!(newKey in sources)) {
            const oldEnabled = cfg.get(`sources.${oldKey}.enabled`);
            if (typeof oldEnabled === 'boolean') {
                sources[newKey] = { enabled: oldEnabled };
            }
        }
    }
    return {
        enabled: cfg.get('enabled', true),
        outputDir: cfg.get('outputDir', ''),
        sources,
        watch: {
            enabled: cfg.get('watch.enabled', false),
            debounceMs: cfg.get('watch.debounceMs', 5000),
        },
        maxSessionAge: cfg.get('maxSessionAge', '90d'),
    };
}

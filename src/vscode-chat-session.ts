/**
 * Read VS Code's shared workspaceStorage chat-session mutation log.
 *
 * Language-model providers such as Z.AI participate in VS Code's native chat
 * surface, so their durable conversation is owned by VS Code rather than the
 * provider extension's globalStorage directory. The on-disk format is an
 * append-only object mutation log: an initial snapshot followed by set, push,
 * and delete records.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ExtractedSession, SessionMessage } from './types';

type JsonObject = Record<string, unknown>;
type ObjectPath = Array<string | number>;

interface MutationEntry {
    kind: number;
    k?: ObjectPath;
    v?: unknown;
    i?: number;
}

export interface VSCodeChatSessionSummary {
    sessionId: string;
    messageCount: number;
    modelProvider?: string;
    revision: string;
}

const MAX_CHAT_SESSION_BYTES = 128 * 1024 * 1024;

function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safePath(pathValue: unknown): ObjectPath {
    if (!Array.isArray(pathValue) || pathValue.length === 0) {
        throw new Error('VS Code chat mutation is missing a non-empty path');
    }
    for (const segment of pathValue) {
        if (typeof segment !== 'string' && typeof segment !== 'number') {
            throw new Error('VS Code chat mutation path contains an invalid segment');
        }
        if (segment === '__proto__' || segment === 'prototype' || segment === 'constructor') {
            throw new Error('VS Code chat mutation path contains an unsafe segment');
        }
    }
    return pathValue;
}

function parentAtPath(state: JsonObject, mutationPath: ObjectPath): [JsonObject | unknown[], string | number] {
    let current: unknown = state;
    for (const segment of mutationPath.slice(0, -1)) {
        if (!isObject(current) && !Array.isArray(current)) {
            throw new Error(`VS Code chat mutation cannot traverse ${String(segment)}`);
        }
        current = current[segment as never];
    }
    if (!isObject(current) && !Array.isArray(current)) {
        throw new Error('VS Code chat mutation parent is not an object or array');
    }
    return [current, mutationPath[mutationPath.length - 1]];
}

function applyEntry(state: JsonObject, entry: MutationEntry): void {
    const mutationPath = safePath(entry.k);
    const [parent, key] = parentAtPath(state, mutationPath);

    if (entry.kind === 1) {
        parent[key as never] = entry.v as never;
        return;
    }
    if (entry.kind === 3) {
        if (Array.isArray(parent) && typeof key === 'number') {
            delete parent[key];
        } else {
            delete (parent as JsonObject)[String(key)];
        }
        return;
    }
    if (entry.kind !== 2) {
        throw new Error(`Unsupported VS Code chat mutation kind: ${entry.kind}`);
    }

    const current = parent[key as never];
    const values = entry.v;
    if (values !== undefined && !Array.isArray(values)) {
        throw new Error('VS Code chat push mutation value is not an array');
    }
    const target: unknown[] = Array.isArray(current) ? current : [];
    if (entry.i !== undefined) {
        if (!Number.isInteger(entry.i) || entry.i < 0) {
            throw new Error('VS Code chat push mutation index is invalid');
        }
        target.length = entry.i;
    }
    if (values) target.push(...values);
    parent[key as never] = target as never;
}

function readMutationLog(filePath: string): { state: JsonObject; ignoredPartialTail: boolean } {
    const size = fs.statSync(filePath).size;
    if (size > MAX_CHAT_SESSION_BYTES) {
        throw new Error(
            `VS Code chat mutation log exceeds ${MAX_CHAT_SESSION_BYTES} byte safety limit`,
        );
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n');
    let state: JsonObject | undefined;
    let ignoredPartialTail = false;

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (!line.trim()) continue;
        let entry: MutationEntry;
        try {
            entry = JSON.parse(line) as MutationEntry;
        } catch (err) {
            const isUnterminatedTail = index === lines.length - 1 && !raw.endsWith('\n');
            if (isUnterminatedTail) {
                ignoredPartialTail = true;
                break;
            }
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Malformed VS Code chat mutation at line ${index + 1}: ${message}`);
        }

        if (entry.kind === 0) {
            if (!isObject(entry.v)) {
                throw new Error('VS Code chat initial mutation is not an object');
            }
            state = entry.v;
            continue;
        }
        if (!state) throw new Error('VS Code chat mutation log is missing an initial entry');
        applyEntry(state, entry);
    }

    if (!state) throw new Error('VS Code chat mutation log contains no initial state');
    return { state, ignoredPartialTail };
}

function stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isoTimestamp(value: unknown): string | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    try {
        return new Date(value).toISOString();
    } catch {
        return undefined;
    }
}

function responseText(response: unknown): string | undefined {
    if (!Array.isArray(response)) return undefined;
    const chunks: string[] = [];
    for (const part of response) {
        if (typeof part === 'string') {
            if (part.trim()) chunks.push(part.trim());
            continue;
        }
        if (!isObject(part)) continue;

        // VS Code persists user-visible MarkdownString responses as objects
        // with `value` and no `kind`. Deliberately exclude `thinking`, tool
        // results, edit payloads, and other provider metadata.
        if (part.kind === undefined) {
            const value = stringValue(part.value);
            if (value) chunks.push(value);
        }
    }
    return chunks.length > 0 ? chunks.join('\n\n') : undefined;
}

function selectedModel(state: JsonObject): JsonObject | undefined {
    const inputState = state.inputState;
    if (!isObject(inputState)) return undefined;
    return isObject(inputState.selectedModel) ? inputState.selectedModel : undefined;
}

function modelIdentity(state: JsonObject): { identifier?: string; provider?: string } {
    let identifier: string | undefined;
    const requests = Array.isArray(state.requests) ? state.requests : [];
    for (let index = requests.length - 1; index >= 0; index--) {
        const request = requests[index];
        if (!isObject(request)) continue;
        identifier = stringValue(request.modelId);
        if (identifier) break;
    }

    const selected = selectedModel(state);
    identifier = identifier ?? stringValue(selected?.identifier);
    const metadata = isObject(selected?.metadata) ? selected.metadata : undefined;
    let provider = stringValue(metadata?.vendor)?.toLowerCase();
    if (!provider && identifier?.includes('/')) {
        provider = identifier.split('/', 1)[0].toLowerCase();
    }
    if (!provider && stringValue(metadata?.extension)?.toLowerCase().includes('copilot')) {
        provider = 'copilot';
    }
    return { identifier, provider };
}

function extractState(filePath: string): ExtractedSession {
    const { state, ignoredPartialTail } = readMutationLog(filePath);
    const messages: SessionMessage[] = [];
    const requests = Array.isArray(state.requests) ? state.requests : [];
    for (const request of requests) {
        if (!isObject(request)) continue;
        const message = isObject(request.message) ? stringValue(request.message.text) : undefined;
        const timestamp = isoTimestamp(request.timestamp);
        if (message) messages.push({ role: 'user', text: message, timestamp });

        const answer = responseText(request.response);
        if (answer) {
            messages.push({
                role: 'assistant',
                text: answer,
                timestamp: isoTimestamp(request.responseTimestamp) ?? timestamp,
            });
        }
    }

    const digest = crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
    const model = modelIdentity(state);
    const metadata: Record<string, unknown> = {
        session_id: stringValue(state.sessionId) ?? path.basename(filePath, '.jsonl'),
        source_file: filePath,
        source_format: 'vscode_chat_session_log',
        source_schema_version: state.version,
        source_revision: digest,
    };
    const createdAt = isoTimestamp(state.creationDate);
    const title = stringValue(state.customTitle);
    if (createdAt) metadata.created_at = createdAt;
    if (title) metadata.title = title;
    if (model.identifier) metadata.model_id = model.identifier;
    if (model.provider) metadata.model_provider = model.provider;
    if (ignoredPartialTail) metadata.ignored_partial_tail = true;
    return { metadata, messages, sourceDigest: digest };
}

export function inspectVSCodeChatSession(filePath: string): VSCodeChatSessionSummary {
    const extracted = extractState(filePath);
    return {
        sessionId: String(extracted.metadata.session_id),
        messageCount: extracted.messages.length,
        modelProvider: stringValue(extracted.metadata.model_provider),
        revision: extracted.sourceDigest ?? '',
    };
}

export function extractVSCodeChatSession(filePath: string): ExtractedSession {
    return extractState(filePath);
}

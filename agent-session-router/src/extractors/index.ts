/**
 * Extractor registry — maps source kinds to extractor functions.
 * Same pattern as Agent Sessions' @register("kind") decorator.
 */

import { Extractor } from '../types';

const _extractors = new Map<string, Extractor>();

export function registerExtractor(kind: string, extractor: Extractor): void {
    _extractors.set(kind, extractor);
}

export function getExtractor(kind: string): Extractor | undefined {
    return _extractors.get(kind);
}

export function knownKinds(): string[] {
    return Array.from(_extractors.keys());
}

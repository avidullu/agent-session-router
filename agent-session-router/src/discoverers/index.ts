/**
 * Discoverer registry — maps source kinds to discoverer functions.
 */

import { Discoverer } from '../types';

const _discoverers = new Map<string, Discoverer>();

export function registerDiscoverer(kind: string, discoverer: Discoverer): void {
    _discoverers.set(kind, discoverer);
}

export function getDiscoverer(kind: string): Discoverer | undefined {
    return _discoverers.get(kind);
}

export function knownKinds(): string[] {
    return Array.from(_discoverers.keys());
}

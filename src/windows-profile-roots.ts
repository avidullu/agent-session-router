/**
 * Resolve Windows user profiles that a Remote-WSL extension host may inspect.
 *
 * Never enumerate /mnt/c/Users: another Windows account's editor data is not
 * part of the current user's archive. Profiles must come from USERPROFILE or
 * the explicit agentSessionRouter.windowsProfileRoots allowlist.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function normalizeWindowsProfileRoot(value: string): string | undefined {
    let candidate = value.trim().replace(/\\/g, '/');
    const drivePath = /^([a-zA-Z]):(\/.*)$/.exec(candidate);
    if (drivePath) {
        candidate = `/mnt/${drivePath[1].toLowerCase()}${drivePath[2]}`;
    }
    candidate = path.posix.normalize(candidate);

    const match = /^\/mnt\/c\/Users\/([^/]+)$/.exec(candidate);
    if (!match || match[1] === '.' || match[1] === '..') return undefined;
    return candidate;
}

export function getWindowsProfileRoots(configuredRoots: string[]): string[] {
    if (!os.release().toLowerCase().includes('microsoft')) return [];

    const candidates = [...configuredRoots];
    if (process.env.USERPROFILE) candidates.push(process.env.USERPROFILE);

    return Array.from(
        new Set(
            candidates
                .map(normalizeWindowsProfileRoot)
                .filter((root): root is string => Boolean(root))
                .filter((root) => fs.existsSync(root) && fs.statSync(root).isDirectory()),
        ),
    );
}

import * as os from 'os';
import * as path from 'path';

/** Validate paths before any filesystem writes, including synced legacy settings. */
export function normalizeOutputPath(
    value: string,
    platform: NodeJS.Platform = process.platform,
    homeDir: string = os.homedir(),
): string {
    const paths = platform === 'win32' ? path.win32 : path.posix;
    const trimmed = value.trim();
    const expanded = /^~([\\/]|$)/.test(trimmed) ? paths.join(homeDir, trimmed.slice(2)) : trimmed;
    const foreignWindowsPath = platform !== 'win32' && /^(?:[a-z]:|\\)/i.test(expanded);
    const foreignPosixPath = platform === 'win32' && /^\/(?!\/)/.test(expanded);
    if (foreignWindowsPath || foreignPosixPath || !paths.isAbsolute(expanded)) {
        throw new Error(
            'The output directory must be an absolute path on this machine. ' +
                'Run "Agent Session Router: Set Output Directory" to choose a local folder ' +
                'or reset to auto-detect. A path synced from another OS cannot be used.',
        );
    }
    return paths.normalize(expanded);
}

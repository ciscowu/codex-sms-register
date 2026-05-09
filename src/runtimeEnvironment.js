const fs = require('fs');
const path = require('path');

const DEFAULT_BROWSER_CANDIDATES = {
    darwin: [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
    linux: [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/microsoft-edge',
        'google-chrome-stable',
        'google-chrome',
        'chromium-browser',
        'chromium',
        'microsoft-edge',
    ],
    win32: [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
};

function isTruthy(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function isRunningInDocker({ fsExistsSync = fs.existsSync } = {}) {
    return fsExistsSync('/.dockerenv');
}

function shouldAllowXvfb({ env = process.env, fsExistsSync = fs.existsSync } = {}) {
    return (
        isTruthy(env.ALLOW_XVFB) ||
        isTruthy(env.CODEX_ALLOW_XVFB) ||
        isRunningInDocker({ fsExistsSync })
    );
}

function shouldBlockXvfbRuntime({
    platform = process.platform,
    parentCmd = '',
    grandParentCmd = '',
    xauthority = '',
    display = '',
    allowXvfb = false,
} = {}) {
    if (platform !== 'linux' || allowXvfb) {
        return false;
    }

    const normalizedXauthority = String(xauthority || '').toLowerCase();
    const normalizedDisplay = String(display || '').toLowerCase();

    return (
        /\bxvfb-run\b/.test(parentCmd) ||
        /\bxvfb-run\b/.test(grandParentCmd) ||
        normalizedXauthority.includes('xvfb-run') ||
        normalizedDisplay.includes('xvfb')
    );
}

function resolveDataDir({ env = process.env, cwd = process.cwd() } = {}) {
    const candidate = String(env.CODEX_DATA_DIR || env.DATA_DIR || '').trim();
    if (!candidate) {
        return path.resolve(cwd, 'data');
    }

    return path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
}

function resolveOutputPath(targetPath, { baseDir, cwd = process.cwd() } = {}) {
    const value = String(targetPath || '').trim();
    if (!value) return '';
    if (path.isAbsolute(value)) return value;

    const root = String(baseDir || '').trim() || cwd;
    return path.resolve(root, value);
}

function resolveBrowserExecutableCandidate(candidate, {
    cwd = process.cwd(),
    env = process.env,
    fsExistsSync = fs.existsSync,
} = {}) {
    const value = String(candidate || '').trim();
    if (!value) return '';

    if (path.isAbsolute(value)) {
        return fsExistsSync(value) ? value : '';
    }

    if (value.includes(path.sep)) {
        const resolvedPath = path.resolve(cwd, value);
        return fsExistsSync(resolvedPath) ? resolvedPath : '';
    }

    const envPath = String(env.PATH || '').trim();
    if (!envPath) return '';

    for (const dir of envPath.split(path.delimiter)) {
        const normalizedDir = String(dir || '').trim();
        if (!normalizedDir) continue;

        const resolvedPath = path.join(normalizedDir, value);
        if (fsExistsSync(resolvedPath)) {
            return resolvedPath;
        }
    }

    return '';
}

function resolveBrowserExecutablePath(options = {}) {
    const {
        browserPath,
        chromePath,
        edgePath,
        platform = process.platform,
        cwd = process.cwd(),
        env = process.env,
        fsExistsSync = fs.existsSync,
    } = options;

    const configuredCandidates = [browserPath, chromePath, edgePath];
    for (const candidate of configuredCandidates) {
        const resolvedPath = resolveBrowserExecutableCandidate(candidate, {
            cwd,
            env,
            fsExistsSync,
        });
        if (resolvedPath) {
            return resolvedPath;
        }
    }

    const defaults = DEFAULT_BROWSER_CANDIDATES[platform] || [];
    for (const candidate of defaults) {
        const resolvedPath = resolveBrowserExecutableCandidate(candidate, {
            cwd,
            env,
            fsExistsSync,
        });
        if (resolvedPath) {
            return resolvedPath;
        }
    }

    return '';
}

function resolveProxyHost(host, { env = process.env, fsExistsSync = fs.existsSync } = {}) {
    const value = String(host || '').trim();
    if (!value) return '';

    if (
        isRunningInDocker({ fsExistsSync }) &&
        ['127.0.0.1', 'localhost', '::1'].includes(value)
    ) {
        return String(env.CODEX_DOCKER_PROXY_HOST || 'host.docker.internal').trim();
    }

    return value;
}

module.exports = {
    isRunningInDocker,
    resolveBrowserExecutablePath,
    resolveDataDir,
    resolveOutputPath,
    resolveProxyHost,
    shouldAllowXvfb,
    shouldBlockXvfbRuntime,
};

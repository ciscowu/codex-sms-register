const fs = require('fs');
const path = require('path');

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
        return cwd;
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

function resolveBrowserExecutablePath(options = {}) {
    return String(options.chromePath || options.browserPath || options.edgePath || '').trim();
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

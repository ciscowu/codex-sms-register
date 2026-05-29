const path = require('path');
const fs = require('fs');
const { resolveDataDir, resolveOutputPath, resolveProxyHost } = require('./runtimeEnvironment');

const configPaths = ['config.yaml', 'config.yml', 'config.json']
    .map(file => path.join(__dirname, '..', file));
const dataDir = resolveDataDir();

function stripYamlComment(line) {
    let singleQuoted = false;
    let doubleQuoted = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' && !singleQuoted && line[i - 1] !== '\\') doubleQuoted = !doubleQuoted;
        if (char === "'" && !doubleQuoted) singleQuoted = !singleQuoted;
        if (char === '#' && !singleQuoted && !doubleQuoted && (i === 0 || /\s/.test(line[i - 1]))) {
            return line.slice(0, i);
        }
    }
    return line;
}

function splitYamlInlineArray(value) {
    const body = value.slice(1, -1).trim();
    if (!body) return [];
    const parts = [];
    let start = 0;
    let singleQuoted = false;
    let doubleQuoted = false;
    for (let i = 0; i < body.length; i++) {
        const char = body[i];
        if (char === '"' && !singleQuoted && body[i - 1] !== '\\') doubleQuoted = !doubleQuoted;
        if (char === "'" && !doubleQuoted) singleQuoted = !singleQuoted;
        if (char === ',' && !singleQuoted && !doubleQuoted) {
            parts.push(body.slice(start, i).trim());
            start = i + 1;
        }
    }
    parts.push(body.slice(start).trim());
    return parts.map(parseYamlScalar);
}

function parseYamlScalar(value) {
    const text = String(value || '').trim();
    if (text === '' || text === 'null' || text === '~') return text === '' ? '' : null;
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (text.startsWith('[') && text.endsWith(']')) return splitYamlInlineArray(text);
    if (text.startsWith('"') && text.endsWith('"')) {
        try { return JSON.parse(text); } catch { return text.slice(1, -1); }
    }
    if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/g, "'");
    if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
    return text;
}

function nextYamlContent(lines, start) {
    for (let i = start; i < lines.length; i++) {
        const line = stripYamlComment(lines[i]).trimEnd();
        if (line.trim()) return line.trim();
    }
    return '';
}

function parseYamlConfig(content) {
    const root = {};
    const stack = [{ indent: -1, value: root }];
    const lines = String(content || '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const clean = stripYamlComment(lines[i]).trimEnd();
        if (!clean.trim()) continue;
        const indent = clean.match(/^ */)[0].length;
        const line = clean.trim();
        while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
        const parent = stack[stack.length - 1].value;
        if (line.startsWith('- ')) {
            if (!Array.isArray(parent)) throw new Error('unsupported yaml list indentation');
            parent.push(parseYamlScalar(line.slice(2)));
            continue;
        }
        const colonIndex = line.indexOf(':');
        if (colonIndex < 1) throw new Error(`unsupported yaml line: ${line}`);
        const key = line.slice(0, colonIndex).trim();
        const rawValue = line.slice(colonIndex + 1).trim();
        if (rawValue) {
            parent[key] = parseYamlScalar(rawValue);
            continue;
        }
        parent[key] = nextYamlContent(lines, i + 1).startsWith('- ') ? [] : {};
        stack.push({ indent, value: parent[key] });
    }
    return root;
}

function parseConfigFile(configPath, content) {
    if (configPath.endsWith('.yaml') || configPath.endsWith('.yml')) return parseYamlConfig(content);
    return JSON.parse(content);
}

// 读取配置文件
function loadConfig() {
    const configPath = configPaths.find(candidate => fs.existsSync(candidate));
    if (!configPath) {
        console.error(`[Config] 配置文件不存在: ${configPaths.map(item => path.basename(item)).join(' / ')}`);
        return {};
    }

    try {
        const content = fs.readFileSync(configPath, 'utf8');
        return parseConfigFile(configPath, content);
    } catch (error) {
        console.error(`[Config] 解析配置文件失败 (${path.basename(configPath)}):`, error.message);
        return {};
    }
}

const config = loadConfig();
const heroSmsMaxPrice = Number(config.heroSmsMaxPrice);

function firstConfigValue(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
}

function parseOptionalInt(value, fallback = null) {
    const resolved = firstConfigValue(value, fallback);
    if (resolved === undefined || resolved === null || resolved === '') return null;
    const parsed = parseInt(resolved, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCountryIds(value, fallback = [16]) {
    const rawList = Array.isArray(value)
        ? value
        : String(value ?? '').split(',').map(item => item.trim());
    const countryIds = rawList
        .map(item => parseInt(item, 10))
        .filter(Number.isFinite);
    return countryIds.length > 0 ? countryIds : fallback;
}

function buildOmrMailConfig(source) {
    const omrmail = source.omrmail && typeof source.omrmail === 'object' ? source.omrmail : {};
    const mode = String(firstConfigValue(omrmail.mode, source.omrmailMode, source.omrmail_mode) ?? '').trim();
    const registeredTag = firstConfigValue(
        omrmail.registeredTagId,
        omrmail.registered_tag_id,
        source.omrmailRegisteredTagId,
        source.omrmail_registered_tag_id
    );
    const usedTagId = parseOptionalInt(firstConfigValue(
        omrmail.usedTagId,
        omrmail.used_tag_id,
        source.omrmailUsedTagId,
        source.omrmail_used_tag_id,
        registeredTag
    ), 2);
    const result = {
        apiBase: String(firstConfigValue(omrmail.apiBase, omrmail.api_base, source.omrmailApiBase, source.omrmail_api_base) ?? 'http://localhost:5000').replace(/\/+$/, ''),
        apiKey: String(firstConfigValue(omrmail.apiKey, omrmail.api_key, source.omrmailApiKey, source.omrmail_api_key) ?? '').trim(),
        sessionCookie: String(firstConfigValue(omrmail.sessionCookie, omrmail.session_cookie, source.omrmailSessionCookie, source.omrmail_session_cookie) ?? '').trim(),
        csrfToken: String(firstConfigValue(omrmail.csrfToken, omrmail.csrf_token, source.omrmailCsrfToken, source.omrmail_csrf_token) ?? '').trim(),
        loginPassword: String(firstConfigValue(omrmail.loginPassword, omrmail.login_password, source.omrmailLoginPassword, source.omrmail_login_password) ?? '').trim(),
        mailbox: String(firstConfigValue(omrmail.mailbox, source.omrmailMailbox, source.omrmail_mailbox, 'all')).trim().toLowerCase() || 'all',
        groupId: parseOptionalInt(firstConfigValue(omrmail.groupId, omrmail.group_id, source.omrmailGroupId, source.omrmail_group_id), null),
        aliasMode: String(firstConfigValue(omrmail.aliasMode, omrmail.alias_mode, source.omrmailAliasMode, source.omrmail_alias_mode, 'prefer_alias')).trim().toLowerCase() || 'prefer_alias',
        acquireTagId: parseOptionalInt(firstConfigValue(omrmail.acquireTagId, omrmail.acquire_tag_id, source.omrmailAcquireTagId, source.omrmail_acquire_tag_id), 1),
        usedTagId,
        registeredTagId: parseOptionalInt(firstConfigValue(registeredTag, usedTagId), usedTagId),
        abnormalTagId: parseOptionalInt(firstConfigValue(omrmail.abnormalTagId, omrmail.abnormal_tag_id, source.omrmailAbnormalTagId, source.omrmail_abnormal_tag_id), 3),
        authenticatedTagId: parseOptionalInt(firstConfigValue(omrmail.authenticatedTagId, omrmail.authenticated_tag_id, source.omrmailAuthenticatedTagId, source.omrmail_authenticated_tag_id), 4),
        top: parseOptionalInt(firstConfigValue(omrmail.top, source.omrmailTop, source.omrmail_top), 20),
        requestTimeoutSecs: parseOptionalInt(firstConfigValue(omrmail.requestTimeoutSecs, omrmail.request_timeout_secs, source.omrmailRequestTimeoutSecs, source.omrmail_request_timeout_secs), 30),
    };
    if (mode) result.mode = mode.toLowerCase();
    return result;
}

const heroSmsCountries = parseCountryIds(config.heroSmsCountry);

module.exports = {
    dataDir,

    // HeroSMS
    heroSmsApiKey: config.heroSmsApiKey,
    heroSmsService: config.heroSmsService || 'dr',
    heroSmsCountry: heroSmsCountries,
    heroSmsCountries,
    heroSmsMaxPrice: Number.isFinite(heroSmsMaxPrice) ? heroSmsMaxPrice : 0.015,

    // Cloudflare 临时邮箱
    mailProvider: String(config.mailProvider || config.mail_provider || 'cloudflare').trim().toLowerCase() || 'cloudflare',
    mailBaseUrl: config.mailBaseUrl || '',
    mailAdminPassword: config.mailAdminPassword,
    mailSitePassword: config.mailSitePassword || '',
    mailDomain: config.mailDomain || '',
    omrmail: buildOmrMailConfig(config),

    // 代理
    proxyHost: resolveProxyHost(config.proxyHost || ''),
    proxyPort: parseInt(config.proxyPort, 10) || 0,
    proxyUsername: config.proxyUsername || '',
    proxyPassword: config.proxyPassword || '',

    // OAuth
    oauthClientId: config.oauthClientId || 'app_EMoamEEZ73f0CkXaXp7hrann',
    oauthRedirectPort: parseInt(config.oauthRedirectPort, 10) || 1455,
    tokenOutputDir: resolveOutputPath(config.tokenOutputDir || path.join(dataDir, 'tokens'), { baseDir: dataDir }),
    tokenOutputDirs: Array.isArray(config.tokenOutputDirs)
        ? config.tokenOutputDirs
            .filter(Boolean)
            .map((dir) => resolveOutputPath(dir, { baseDir: dataDir }))
        : [],
    cpaUrl: String(config.cpaUrl || config.cpa_url || '').trim(),
    cpaKey: String(config.cpaKey || config.cpa_key || '').trim(),

    // 浏览器
    useChrome: config.useChrome !== false,
    chromePath: String(config.chromePath || '').trim(),
};

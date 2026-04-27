const path = require('path');
const fs = require('fs');
const { resolveDataDir, resolveOutputPath, resolveProxyHost } = require('./runtimeEnvironment');

const configPath = path.join(__dirname, '..', 'config.json');
const dataDir = resolveDataDir();

// 读取配置文件
function loadConfig() {
    if (!fs.existsSync(configPath)) {
        console.error(`[Config] 配置文件不存在: ${configPath}`);
        return {};
    }

    try {
        const content = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error('[Config] 解析配置文件失败:', error.message);
        return {};
    }
}

const config = loadConfig();

module.exports = {
    dataDir,

    // HeroSMS
    heroSmsApiKey: config.heroSmsApiKey,
    heroSmsService: config.heroSmsService || 'dr',
    heroSmsCountry: parseInt(config.heroSmsCountry, 10) || 16,

    // Cloudflare 临时邮箱
    mailBaseUrl: config.mailBaseUrl || '',
    mailAdminPassword: config.mailAdminPassword,
    mailSitePassword: config.mailSitePassword || '',
    mailDomain: config.mailDomain || '',

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
    chromePath: config.chromePath || 'google-chrome-stable',
};

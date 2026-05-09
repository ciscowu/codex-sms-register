const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { execSync, execFile } = require('child_process');
const { promisify } = require('util');
const config = require('./config');

const SLEEP = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const execFileAsync = promisify(execFile);
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CURL_STATUS_MARKER = '__CODEX_HTTP_STATUS__:';
const RETRYABLE_ERROR_CODES = new Set([
    'EAI_AGAIN',
    'ENOTFOUND',
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNABORTED',
]);

function parseProxyEndpoint(endpoint) {
    if (!endpoint || typeof endpoint !== 'string') return null;
    const raw = endpoint.trim();
    if (!raw) return null;

    try {
        const withScheme = raw.includes('://') ? raw : `http://${raw}`;
        const u = new URL(withScheme);

        if (!['http:', 'https:'].includes(u.protocol)) {
            return null;
        }

        const port = parseInt(u.port, 10) || (u.protocol === 'https:' ? 443 : 80);
        if (!u.hostname || !port) return null;

        return {
            protocol: u.protocol,
            host: u.hostname,
            port,
            username: decodeURIComponent(u.username || ''),
            password: decodeURIComponent(u.password || ''),
        };
    } catch (e) {
        return null;
    }
}

function detectProxyFromEnv() {
    const env = process.env;
    const raw = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || env.ALL_PROXY || env.all_proxy;
    if (!raw) return null;

    const parsed = parseProxyEndpoint(raw);
    if (!parsed) return null;

    return { ...parsed, source: 'env' };
}

function parseWinHttpProxyText(text) {
    if (!text) return null;

    // 优先提取 https=...;http=... 形式
    const httpsMatch = text.match(/https\s*=\s*([^;\s\r\n]+)/i);
    const httpMatch = text.match(/http\s*=\s*([^;\s\r\n]+)/i);
    const endpoint = (httpsMatch && httpsMatch[1]) || (httpMatch && httpMatch[1]);
    if (endpoint) return endpoint;

    // 兼容 "Proxy Server(s) : host:port" 形式
    const lineMatch = text.match(/Proxy\s*Server\(s\)\s*:\s*([^\r\n]+)/i);
    if (lineMatch && lineMatch[1]) {
        const value = lineMatch[1].trim();
        if (value && !/direct access|no proxy/i.test(value)) return value;
    }

    // 兜底：抓第一个 host:port
    const hostPort = text.match(/([a-zA-Z0-9.-]+:\d{2,5})/);
    if (hostPort && hostPort[1]) return hostPort[1];

    return null;
}

function detectProxyFromWinHttp() {
    if (process.platform !== 'win32') return null;

    try {
        const out = execSync('netsh winhttp show proxy', {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
        });

        const endpoint = parseWinHttpProxyText(out);
        if (!endpoint) return null;

        const parsed = parseProxyEndpoint(endpoint);
        if (!parsed) return null;

        return { ...parsed, source: 'winhttp' };
    } catch (e) {
        return null;
    }
}

function detectSystemProxy() {
    return detectProxyFromEnv() || detectProxyFromWinHttp();
}

function isRetryableTokenError(error) {
    const status = error?.response?.status;
    const code = error?.code;
    return RETRYABLE_ERROR_CODES.has(code) || status === 429 || (status >= 500 && status <= 599);
}

function shouldFallbackToCurl(error) {
    return RETRYABLE_ERROR_CODES.has(error?.code);
}

function parseMaybeJson(text) {
    const raw = String(text || '').trim();
    if (!raw) return raw;

    try {
        return JSON.parse(raw);
    } catch (e) {
        return raw;
    }
}

function createHttpResponseError(status, data) {
    const message = data?.error?.message || data?.message || `HTTP ${status}`;
    const error = new Error(message);
    error.response = { status, data };
    return error;
}

function mapCurlExitCodeToNetworkCode(code) {
    switch (Number(code)) {
        case 6:
            return 'ENOTFOUND';
        case 7:
            return 'ECONNREFUSED';
        case 28:
            return 'ETIMEDOUT';
        case 35:
        case 56:
            return 'ECONNRESET';
        default:
            return 'CURL_EXEC_ERROR';
    }
}

function wrapCurlExecError(error) {
    const message = String(error?.stderr || error?.message || 'curl request failed').trim();
    const wrapped = new Error(message || 'curl request failed');
    wrapped.code = mapCurlExitCodeToNetworkCode(error?.code);
    wrapped.cause = error;
    return wrapped;
}

function buildProxyUrl(proxy) {
    if (!proxy?.host || !proxy?.port) return '';
    const protocol = proxy.protocol || 'http:';
    return `${protocol}//${proxy.host}:${proxy.port}`;
}

class OAuthService {
    constructor(options = {}) {
        this.clientId = 'app_EMoamEEZ73f0CkXaXp7hrann';
        this.redirectPort = 1455;
        this.redirectUri = `http://localhost:${this.redirectPort}/auth/callback`;
        this.proxy = options.proxy || detectSystemProxy() || null;
        this.axiosPost = options.axiosPost || axios.post.bind(axios);
        this.execFile = options.execFile || execFileAsync;
        this.cpaUrl = String(options.cpaUrl ?? config.cpaUrl ?? '').trim();
        this.cpaKey = String(options.cpaKey ?? config.cpaKey ?? '').trim();
        this.codeVerifier = null;
        this.codeChallenge = null;
        this.state = null;

        if (this.proxy && this.proxy.host && this.proxy.port) {
            const source = this.proxy.source ? ` (${this.proxy.source})` : '';
            console.log(`[OAuth] oauth/token 使用代理: ${buildProxyUrl(this.proxy)}${source}`);
        }

        this.regeneratePKCE();
    }

    shouldUploadAuthFile() {
        return !!(this.cpaUrl && this.cpaKey);
    }

    buildCpaUploadRequestConfig() {
        const requestConfig = {
            headers: {
                Authorization: `Bearer ${this.cpaKey}`,
            },
            timeout: 15000,
        };

        if (this.cpaUrl.startsWith('https://')) {
            requestConfig.httpsAgent = new https.Agent({
                rejectUnauthorized: false,
            });
        }

        return requestConfig;
    }

    async uploadAuthFile(authJson) {
        if (!this.shouldUploadAuthFile()) return null;

        const email = String(authJson?.email || 'unknown').trim() || 'unknown';
        const formData = new FormData();
        const fileBlob = new Blob([JSON.stringify(authJson)], {
            type: 'application/json',
        });

        formData.append('file', fileBlob, `codex-${email}.json`);
        formData.append('channel', 'codex');

        const response = await this.axiosPost(
            `${this.cpaUrl}/v0/management/auth-files`,
            formData,
            this.buildCpaUploadRequestConfig(),
        );

        const text = typeof response?.data === 'string'
            ? response.data
            : JSON.stringify(response?.data ?? '');

        return {
            statusCode: response?.status || 0,
            text,
        };
    }

    /**
     * 生成 Code Verifier
     */
    generateCodeVerifier() {
        return crypto.randomBytes(32).toString('base64url');
    }

    /**
     * 生成 Code Challenge
     */
    generateCodeChallenge(verifier) {
        return crypto.createHash('sha256').update(verifier).digest('base64url');
    }

    /**
     * 重新生成 PKCE 参数和 state
     */
    regeneratePKCE() {
        this.codeVerifier = this.generateCodeVerifier();
        this.codeChallenge = this.generateCodeChallenge(this.codeVerifier);
        this.state = crypto.randomBytes(16).toString('hex');
        console.log('[OAuth] 已重新生成 PKCE 参数和 state');
    }

    /**
     * 获取 OAuth 授权 URL
     * @returns {string} 授权 URL
     */
    getAuthUrl() {
        const params = new URLSearchParams({
            client_id: this.clientId,
            code_challenge: this.codeChallenge,
            code_challenge_method: 'S256',
            codex_cli_simplified_flow: 'true',
            id_token_add_organizations: 'true',
            prompt: 'login',
            redirect_uri: this.redirectUri,
            response_type: 'code',
            scope: 'openid email profile offline_access',
            state: this.state
        });
        return `https://auth.openai.com/oauth/authorize?${params.toString()}`;
    }

    /**
     * 从 localhost 回调 URL 中提取授权参数
     * @param {string} callbackUrl - 完整的回调 URL
     * @returns {object|null} 提取的参数对象
     */
    extractCallbackParams(callbackUrl) {
        try {
            const url = new URL(callbackUrl);
            const params = {
                code: url.searchParams.get('code'),
                state: url.searchParams.get('state'),
                error: url.searchParams.get('error'),
                error_description: url.searchParams.get('error_description')
            };

            // 验证 state
            if (params.state && params.state !== this.state) {
                console.error('[OAuth] State 不匹配:', params.state, '期望:', this.state);
                return null;
            }

            return params;
        } catch (e) {
            console.error('[OAuth] 解析回调 URL 失败:', e.message);
            return null;
        }
    }

    buildTokenRequestBody(code) {
        return new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: this.redirectUri,
            client_id: this.clientId,
            code_verifier: this.codeVerifier
        }).toString();
    }

    buildAxiosRequestConfig() {
        const requestConfig = {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 30000,
        };

        if (this.proxy && this.proxy.host && this.proxy.port) {
            requestConfig.proxy = {
                protocol: this.proxy.protocol || 'http:',
                host: this.proxy.host,
                port: this.proxy.port,
            };
            if (this.proxy.username || this.proxy.password) {
                requestConfig.proxy.auth = {
                    username: this.proxy.username || '',
                    password: this.proxy.password || '',
                };
            }
        }

        return requestConfig;
    }

    async exchangeTokenViaAxios(body) {
        return await this.axiosPost(TOKEN_URL, body, this.buildAxiosRequestConfig());
    }

    buildCurlArgs(body) {
        const args = [
            '--silent',
            '--show-error',
            '--location',
            '--request',
            'POST',
            '--header',
            'Content-Type: application/x-www-form-urlencoded',
            '--data',
            body,
            '--max-time',
            '30',
            '--write-out',
            `\n${CURL_STATUS_MARKER}%{http_code}`,
        ];

        if (this.proxy && this.proxy.host && this.proxy.port) {
            args.push('--proxy', buildProxyUrl(this.proxy));
            if (this.proxy.username || this.proxy.password) {
                args.push('--proxy-user', `${this.proxy.username || ''}:${this.proxy.password || ''}`);
            }
        }

        args.push(TOKEN_URL);
        return args;
    }

    async exchangeTokenViaCurl(body) {
        try {
            const { stdout } = await this.execFile('curl', this.buildCurlArgs(body), {
                maxBuffer: 1024 * 1024,
            });
            const markerIndex = stdout.lastIndexOf(`\n${CURL_STATUS_MARKER}`);
            if (markerIndex === -1) {
                throw new Error('curl token 响应缺少状态码');
            }

            const payloadText = stdout.slice(0, markerIndex);
            const statusText = stdout.slice(markerIndex + 1 + CURL_STATUS_MARKER.length).trim();
            const status = parseInt(statusText, 10);
            const data = parseMaybeJson(payloadText);

            if (!status) {
                throw new Error('curl token 响应状态码无效');
            }
            if (status < 200 || status >= 300) {
                throw createHttpResponseError(status, data);
            }

            return { status, data };
        } catch (error) {
            if (error?.response) {
                throw error;
            }
            throw wrapCurlExecError(error);
        }
    }

    /**
     * 用授权码换取 Token
     * @param {string} code - 授权码
     * @param {string} email - 邮箱地址
     * @param {object} accountInfo - 账号附加信息
     * @param {string} accountInfo.password - 账号密码
     * @returns {Promise<object>} Token 对象
     */
    async exchangeTokenAndSave(code, email, accountInfo = {}) {
        try {
            console.log('[OAuth] 开始用 code 换取 Token');

            const body = this.buildTokenRequestBody(code);

            const maxAttempts = 5;
            let response = null;
            let lastError = null;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    response = await this.exchangeTokenViaAxios(body);
                    break;
                } catch (err) {
                    lastError = err;

                    if (shouldFallbackToCurl(err)) {
                        console.warn(`[OAuth] 检测到 Node 网络层失败(${err.code})，切换 curl 兜底...`);
                        try {
                            response = await this.exchangeTokenViaCurl(body);
                            break;
                        } catch (curlErr) {
                            lastError = curlErr;
                            err = curlErr;
                        }
                    }

                    if (!isRetryableTokenError(err) || attempt === maxAttempts) {
                        throw err;
                    }

                    const status = err?.response?.status;
                    const errorCode = err?.code;
                    const waitMs = attempt * 3000;
                    console.warn(`[OAuth] 换 Token 第 ${attempt} 次失败(${errorCode || status || 'unknown'})，${waitMs}ms 后重试...`);
                    await SLEEP(waitMs);
                }
            }

            if (!response) {
                throw lastError || new Error('换取 Token 失败: 未获得响应');
            }

            const tokens = response.data;

            // 解析 JWT 获取 account_id
            let accountId = "";
            try {
                const payloadStr = Buffer.from(tokens.access_token.split('.')[1], 'base64').toString('utf8');
                const payload = JSON.parse(payloadStr);
                const apiAuth = payload['https://api.openai.com/auth'] || {};
                accountId = apiAuth.chatgpt_account_id || "";
            } catch (e) {
                console.error('[OAuth] 解析 access_token 获取 account_id 失败:', e.message);
            }

            const now = new Date();
            const expiredTime = new Date(now.getTime() + tokens.expires_in * 1000);

            const outData = {
                access_token: tokens.access_token,
                account_id: accountId,
                disabled: false,
                email: email,
                expired: expiredTime.toISOString().replace(/\.[0-9]{3}Z$/, '+08:00'),
                id_token: tokens.id_token,
                last_refresh: now.toISOString().replace(/\.[0-9]{3}Z$/, '+08:00'),
                password: String(accountInfo?.password || ''),
                refresh_token: tokens.refresh_token,
                type: 'codex'
            };

            // 保存到文件（支持双写/多目录）
            const outputDirs = config.tokenOutputDirs.length > 0
                ? [...new Set(config.tokenOutputDirs)]
                : [config.tokenOutputDir || path.join(process.cwd(), 'tokens')];
            const safeEmail = String(email || 'unknown')
                .trim()
                .replace(/[\\/:*?"<>|]/g, '_');
            const filename = `codex-${safeEmail}-free.json`;
            const savedPaths = [];
            for (const dir of outputDirs) {
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                const filepath = path.join(dir, filename);
                fs.writeFileSync(filepath, JSON.stringify(outData, null, 2));
                savedPaths.push(filepath);
            }

            console.log(`[OAuth] Token 成功保存至: ${savedPaths.join(' | ')}`);

            if (this.shouldUploadAuthFile()) {
                try {
                    const uploadResult = await this.uploadAuthFile(outData);
                    if (uploadResult) {
                        console.log(`[OAuth] CPA 上传成功: status=${uploadResult.statusCode}`);
                    }
                } catch (uploadError) {
                    console.error('[OAuth] CPA 上传失败:', uploadError.message);
                }
            }

            return outData;
        } catch (error) {
            const apiErrorCode = error?.response?.data?.error?.code;
            if (apiErrorCode === 'unsupported_country_region_territory') {
                console.error('[OAuth] 地区受限：当前出口 IP 不支持，请配置可用代理后重试');
            }
            console.error('[OAuth] 换取 Token 失败:', error.response ? error.response.data : error.message);
            throw error;
        }
    }
}

module.exports = { OAuthService };

const axios = require('axios');
const { accountTagIds, extractCookieHeader, hasTagInformation, normalizeOmrMailConfig, normalizeOmrMailMessage, omrMailStateTransition, parseMessageTime, primaryMailbox, quotePath } = require('./omrMailUtils');

const ACTIVE_STATUSES = new Set(['active', 'enabled', 'healthy']);
const RETRYABLE_ERROR_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN']);
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_REQUEST_ATTEMPTS = 3;

class OmrMailProvider {
    constructor(options = {}) {
        this.config = normalizeOmrMailConfig(options);
        this.address = null;
        this.addressId = null;
        this.identity = null;
    }

    _apiHeaders() {
        return {
            'X-API-Key': this.config.apiKey,
            'Content-Type': 'application/json',
        };
    }

    _webHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        if (this.config.sessionCookie) headers.Cookie = this.config.sessionCookie;
        if (this.config.csrfToken) {
            headers['X-CSRF-Token'] = this.config.csrfToken;
            headers['X-CSRFToken'] = this.config.csrfToken;
        }
        return headers;
    }

    _axiosConfig(overrides = {}) {
        return {
            proxy: false,
            timeout: this.config.requestTimeoutSecs * 1000,
            ...overrides,
        };
    }

    _requireApiKey() {
        if (!this.config.apiKey) {
            throw new Error('omrmail apiKey is required');
        }
    }

    _isRetryableRequestError(error) {
        const status = error?.response?.status;
        return RETRYABLE_ERROR_CODES.has(error?.code) || RETRYABLE_HTTP_STATUSES.has(status);
    }

    async _sleep(ms) {
        if (ms > 0) await new Promise(resolve => setTimeout(resolve, ms));
    }

    async _requestWithRetry(method, url, ...args) {
        for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt++) {
            try {
                return await axios[method](url, ...args);
            } catch (error) {
                if (attempt >= MAX_REQUEST_ATTEMPTS || !this._isRetryableRequestError(error)) throw error;
                const marker = error?.code || `HTTP ${error?.response?.status}`;
                console.warn(`[Mail][OMR] 请求失败(${marker})，短暂重试... (${attempt}/${MAX_REQUEST_ATTEMPTS})`);
                await this._sleep(this.config.requestRetryDelayMs);
            }
        }
        throw new Error('omrmail request retry exhausted');
    }

    async _ensureWebAuth() {
        if (this.config.sessionCookie && this.config.csrfToken) return true;
        if (this.config.sessionCookie && !this.config.csrfToken) {
            const csrfResponse = await this._requestWithRetry('get',
                `${this.config.apiBase}/api/csrf-token`,
                this._axiosConfig({ headers: this._webHeaders() })
            );
            this.config.csrfToken = String(csrfResponse.data?.csrf_token || '').trim();
            const refreshedCookie = extractCookieHeader(csrfResponse.headers?.['set-cookie']);
            if (refreshedCookie) this.config.sessionCookie = refreshedCookie;
            return !!this.config.sessionCookie;
        }
        if (!this.config.loginPassword) return false;

        const loginResponse = await this._requestWithRetry('post',
            `${this.config.apiBase}/login`,
            { password: this.config.loginPassword },
            this._axiosConfig({ headers: { 'Content-Type': 'application/json' } })
        );
        if (loginResponse.data && loginResponse.data.success === false) {
            throw new Error(loginResponse.data.error || loginResponse.data.message || 'omrmail login failed');
        }
        const sessionCookie = extractCookieHeader(loginResponse.headers?.['set-cookie']);
        if (sessionCookie) this.config.sessionCookie = sessionCookie;
        if (!this.config.sessionCookie) return false;
        return await this._ensureWebAuth();
    }

    _accountMatchesTag(account) {
        if (this.config.acquireTagId === null) return true;
        if (!hasTagInformation(account)) return true;
        return accountTagIds(account).has(this.config.acquireTagId);
    }

    _aliasCandidates(primary, aliases) {
        if (this.config.aliasMode === 'primary_only') return [primary];
        if (this.config.aliasMode === 'alias_only') return aliases;
        return [...aliases, primary];
    }

    _normalizeIdentity(account, requestedEmail) {
        const resolvedEmail = String(account.email || '').trim();
        const accountId = account.id === undefined || account.id === null ? null : String(account.id);
        return {
            provider: 'omrmail',
            id: accountId,
            email: requestedEmail,
            requestedEmail,
            requested_email: requestedEmail,
            resolvedEmail,
            resolved_email: resolvedEmail,
            matchedAlias: requestedEmail !== resolvedEmail ? requestedEmail : '',
            token: {
                requested_email: requestedEmail,
                resolved_email: resolvedEmail,
                account_id: accountId,
            },
        };
    }

    _identityMatches(identity, email) {
        const normalized = String(email || '').trim().toLowerCase();
        if (!normalized) return false;
        return [
            identity?.email,
            identity?.requestedEmail,
            identity?.requested_email,
            identity?.resolvedEmail,
            identity?.resolved_email,
            identity?.matchedAlias,
        ].some(candidate => String(candidate || '').trim().toLowerCase() === normalized);
    }

    async _listAccounts() {
        this._requireApiKey();
        const params = {};
        if (this.config.groupId !== null) params.group_id = this.config.groupId;
        const response = await this._requestWithRetry('get',
            `${this.config.apiBase}/api/external/accounts`,
            this._axiosConfig({
                params,
                headers: this._apiHeaders(),
            })
        );
        const payload = response.data || {};
        if (Array.isArray(payload)) return payload;
        if (Array.isArray(payload.accounts)) return payload.accounts;
        if (Array.isArray(payload.data?.accounts)) return payload.data.accounts;
        return [];
    }

    async createAddress() {
        if (this.config.mode !== 'api') {
            throw new Error(`unsupported omrmail mode: ${this.config.mode}`);
        }
        const accounts = await this._listAccounts();
        for (const account of accounts) {
            const status = String(account.status || '').trim().toLowerCase();
            if (status && !ACTIVE_STATUSES.has(status)) continue;
            if (!this._accountMatchesTag(account)) continue;

            const primary = String(account.email || '').trim();
            if (!primary) continue;
            const aliases = (account.aliases || []).map(item => String(item || '').trim()).filter(Boolean);
            const requestedEmail = this._aliasCandidates(primary, aliases).find(Boolean);
            if (!requestedEmail) continue;

            this.identity = this._normalizeIdentity(account, requestedEmail);
            this.address = this.identity.email;
            this.addressId = this.identity.id;
            console.log(`[Mail][OMR] 获取邮箱: ${this.address}`);
            return {
                jwt: null,
                address: this.address,
                addressId: this.addressId,
                identity: this.identity,
            };
        }
        throw new Error('omrmail pool empty');
    }

    async _findIdentityByEmail(email) {
        if (this.identity && this._identityMatches(this.identity, email)) return this.identity;
        const normalized = String(email || '').trim().toLowerCase();
        if (!normalized) return null;

        const accounts = await this._listAccounts();
        for (const account of accounts) {
            const primary = String(account.email || '').trim();
            const aliases = (account.aliases || []).map(item => String(item || '').trim()).filter(Boolean);
            const matched = [primary, ...aliases].find(item => item.toLowerCase() === normalized);
            if (matched) return this._normalizeIdentity(account, matched);
        }
        return null;
    }

    async _updateTag(identity, tagId, action) {
        if (tagId === null || !identity?.id) return false;
        const hasAuth = await this._ensureWebAuth().catch(() => false);
        if (!hasAuth) return false;

        await this._requestWithRetry('post',
            `${this.config.apiBase}/api/accounts/tags`,
            {
                account_ids: [Number.isFinite(Number(identity.id)) ? Number(identity.id) : identity.id],
                tag_id: tagId,
                action,
            },
            this._axiosConfig({ headers: this._webHeaders() })
        );
        return true;
    }

    async _applyTagChanges(email, changes) {
        const identity = await this._findIdentityByEmail(email);
        if (!identity) return false;
        let changed = false;
        for (const [tagId, action] of changes) {
            changed = await this._updateTag(identity, tagId, action) || changed;
        }
        return changed;
    }

    async markClaimed(email = this.address) {
        return await this._applyTagChanges(email, omrMailStateTransition(this.config, this.config.usedTagId));
    }

    async markAbnormal(email = this.address) {
        return await this._applyTagChanges(email, omrMailStateTransition(this.config, this.config.abnormalTagId));
    }

    async markAuthenticated(email = this.address) {
        return await this._applyTagChanges(email, omrMailStateTransition(this.config, this.config.authenticatedTagId));
    }

    async markRegistered(email = this.address) { return await this.markAuthenticated(email); }

    getEmail() {
        return this.address;
    }

    getInboxUrl() {
        return this.address
            ? `${this.config.apiBase}/emails/${quotePath(primaryMailbox(this.address))}`
            : this.config.apiBase;
    }

    async _fetchDetail(email, message) {
        if (!message?.id && !message?.message_id) return null;
        const hasAuth = await this._ensureWebAuth().catch(() => false);
        if (!hasAuth) return null;
        const messageId = message.id || message.message_id;
        const folder = String(message.folder || this.config.mailbox || 'inbox').toLowerCase() === 'all'
            ? 'inbox'
            : (message.folder || this.config.mailbox || 'inbox');
        const response = await this._requestWithRetry('get',
            `${this.config.apiBase}/api/email/${quotePath(email)}/${quotePath(messageId)}`,
            this._axiosConfig({
                params: { folder, method: 'graph' },
                headers: this._webHeaders(),
            })
        );
        const payload = response.data || {};
        const detail = payload.email && typeof payload.email === 'object' ? payload.email : payload;
        if (detail.body && typeof detail.body === 'object' && detail.body.content) {
            return { ...detail, content: detail.body.content };
        }
        return detail;
    }

    async getMailsByAddress(address, limit = 10, offset = 0) {
        this._requireApiKey();
        const email = String(address || '').trim();
        if (!email) throw new Error('email is empty');

        const response = await this._requestWithRetry('get',
            `${this.config.apiBase}/api/external/emails`,
            this._axiosConfig({
                params: {
                    email,
                    folder: this.config.mailbox,
                    top: limit || this.config.top,
                    skip: offset || 0,
                },
                headers: this._apiHeaders(),
            })
        );
        const payload = response.data || {};
        const messages = Array.isArray(payload.emails)
            ? payload.emails
            : (Array.isArray(payload.results) ? payload.results : []);

        const sorted = [...messages].sort((left, right) => parseMessageTime(right) - parseMessageTime(left));
        const normalized = [];
        for (const message of sorted) {
            const detail = await this._fetchDetail(email, message);
            normalized.push(normalizeOmrMailMessage(message, detail));
        }
        return normalized;
    }

    async getMails(limit = 10, offset = 0) {
        if (!this.address) throw new Error('omrmail address is empty');
        return await this.getMailsByAddress(this.address, limit, offset);
    }
}

module.exports = {
    OmrMailProvider,
    normalizeOmrMailConfig,
};

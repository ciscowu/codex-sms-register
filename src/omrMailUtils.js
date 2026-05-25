const DEFAULT_API_BASE = 'http://localhost:5000';

function firstValue(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
}

function toInt(value, fallback = null) {
    const resolved = firstValue(value, fallback);
    if (resolved === undefined || resolved === null || resolved === '') return null;
    const parsed = parseInt(resolved, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function trimTrailingSlash(value) {
    return String(value || DEFAULT_API_BASE).replace(/\/+$/, '');
}

function quotePath(value) {
    return encodeURIComponent(String(value || ''));
}

function primaryMailbox(email) {
    const [local, domain] = String(email || '').trim().split('@');
    if (!local || !domain) return String(email || '').trim();
    return `${local.split('+', 1)[0]}@${domain.toLowerCase()}`;
}

function normalizeOmrMailConfig(raw = {}) {
    const usedTagId = toInt(firstValue(raw.usedTagId, raw.used_tag_id, raw.registeredTagId, raw.registered_tag_id), 2);
    const registeredTagId = toInt(firstValue(raw.registeredTagId, raw.registered_tag_id, usedTagId), usedTagId);
    return {
        mode: String(firstValue(raw.mode) ?? 'api').trim().toLowerCase() || 'api',
        apiBase: trimTrailingSlash(firstValue(raw.apiBase, raw.api_base)),
        apiKey: String(firstValue(raw.apiKey, raw.api_key) ?? '').trim(),
        sessionCookie: String(firstValue(raw.sessionCookie, raw.session_cookie) ?? '').trim(),
        csrfToken: String(firstValue(raw.csrfToken, raw.csrf_token) ?? '').trim(),
        loginPassword: String(firstValue(raw.loginPassword, raw.login_password) ?? '').trim(),
        mailbox: String(firstValue(raw.mailbox) ?? 'all').trim().toLowerCase() || 'all',
        groupId: toInt(firstValue(raw.groupId, raw.group_id), null),
        aliasMode: String(firstValue(raw.aliasMode, raw.alias_mode) ?? 'prefer_alias').trim().toLowerCase() || 'prefer_alias',
        acquireTagId: toInt(firstValue(raw.acquireTagId, raw.acquire_tag_id), 1),
        usedTagId,
        registeredTagId,
        abnormalTagId: toInt(firstValue(raw.abnormalTagId, raw.abnormal_tag_id), 3),
        authenticatedTagId: toInt(firstValue(raw.authenticatedTagId, raw.authenticated_tag_id), 4),
        top: toInt(firstValue(raw.top), 20),
        requestTimeoutSecs: toInt(firstValue(raw.requestTimeoutSecs, raw.request_timeout_secs), 30),
    };
}

function omrMailStateTagIds(config = {}) {
    const ids = [
        config.acquireTagId,
        config.usedTagId,
        config.registeredTagId,
        config.abnormalTagId,
        config.authenticatedTagId,
    ].filter(id => id !== null && id !== undefined && id !== '');
    return [...new Set(ids)];
}

function omrMailStateTransition(config, targetTagId) {
    const changes = omrMailStateTagIds(config)
        .filter(tagId => tagId !== targetTagId)
        .map(tagId => [tagId, 'remove']);
    if (targetTagId !== null && targetTagId !== undefined && targetTagId !== '') {
        changes.push([targetTagId, 'add']);
    }
    return changes;
}

function extractCookieHeader(setCookie) {
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    return cookies
        .filter(Boolean)
        .map(cookie => String(cookie).split(';')[0].trim())
        .filter(Boolean)
        .join('; ');
}

function accountTagIds(account = {}) {
    const ids = new Set();
    for (const key of ['tag_id', 'tagId']) {
        const parsed = toInt(account[key], null);
        if (parsed !== null) ids.add(parsed);
    }
    for (const value of account.tag_ids || account.tagIds || []) {
        const parsed = toInt(value, null);
        if (parsed !== null) ids.add(parsed);
    }
    for (const tag of account.tags || []) {
        const raw = typeof tag === 'object' && tag ? firstValue(tag.id, tag.tag_id, tag.tagId) : tag;
        const parsed = toInt(raw, null);
        if (parsed !== null) ids.add(parsed);
    }
    return ids;
}

function hasTagInformation(account = {}) {
    return ['tag_id', 'tagId', 'tag_ids', 'tagIds', 'tags'].some(key => account[key] !== undefined);
}

function parseMessageTime(message = {}) {
    for (const key of ['posix-millis', 'timestamp', 'time', 'received_at_ms', 'sent_at_ms']) {
        const value = message[key];
        if (Number.isFinite(value) && value > 0) return Number(value);
    }
    for (const key of ['date', 'received_at', 'sent_at', 'created_at', 'updated_at']) {
        const value = message[key];
        if (!value) continue;
        const normalized = String(value).includes('T') ? String(value) : String(value).replace(' ', 'T');
        const parsed = Date.parse(normalized);
        if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
}

function collectContentParts(message = {}) {
    const parts = [];
    for (const key of ['subject', 'body_preview', 'preview', 'text', 'body_text', 'body_html', 'content', 'html']) {
        if (message[key]) parts.push(String(message[key]));
    }
    if (message.body && typeof message.body === 'object' && message.body.content) {
        parts.push(String(message.body.content));
    }
    return parts;
}

function normalizeOmrMailMessage(message = {}, detail = null) {
    const merged = detail && typeof detail === 'object' ? { ...message, ...detail } : message;
    const content = collectContentParts(merged).join('\n');
    const headers = [
        merged.subject ? `Subject: ${merged.subject}` : '',
        merged.from ? `From: ${typeof merged.from === 'object' ? JSON.stringify(merged.from) : merged.from}` : '',
        merged.date ? `Date: ${merged.date}` : '',
    ].filter(Boolean);
    const raw = merged.raw || `${headers.join('\n')}\n\n${content}`.trim();
    return { ...merged, raw };
}

module.exports = {
    accountTagIds,
    extractCookieHeader,
    firstValue,
    hasTagInformation,
    normalizeOmrMailConfig,
    normalizeOmrMailMessage,
    omrMailStateTagIds,
    omrMailStateTransition,
    parseMessageTime,
    primaryMailbox,
    quotePath,
    toInt,
};

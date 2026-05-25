const KEYWORD_PATTERN = /code|验证码|驗證碼|verification|verify|one[-\s]?time|一次性/i;

function decodeQuotedPrintable(text) {
    return String(text || '')
        .replace(/=\r?\n/g, '')
        .replace(/(?:=[0-9a-f]{2})+/gi, (chunk) => {
            const bytes = chunk.match(/[0-9a-f]{2}/gi).map(hex => parseInt(hex, 16));
            return Buffer.from(bytes).toString('utf8');
        });
}

function decodeHtmlEntities(text) {
    return String(text || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#(\d+);/g, (_, value) => String.fromCharCode(Number(value)))
        .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCharCode(parseInt(value, 16)));
}

function htmlToText(text) {
    return decodeHtmlEntities(text)
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeDigits(text) {
    return String(text || '').replace(/[０-９]/g, char => String(char.charCodeAt(0) - 0xff10));
}

function extractMailBody(raw = '') {
    const decoded = decodeQuotedPrintable(raw);
    const htmlMatch = decoded.match(/Content-Type:\s*text\/html[\s\S]*?\r?\n\r?\n([\s\S]*?)(?:--[^\r\n]+--|$)/i);
    if (htmlMatch) return htmlMatch[1];

    const parts = decoded.split(/\r?\n\r?\n/);
    if (parts.length > 1) return parts.slice(Math.max(1, parts.length - 3)).join('\n');
    return decoded;
}

function keywordPositions(text) {
    const positions = [];
    const matcher = new RegExp(KEYWORD_PATTERN.source, 'gi');
    for (const match of text.matchAll(matcher)) positions.push(match.index);
    return positions;
}

function codePriority(index, keywords) {
    if (keywords.length === 0) return index;
    let best = 10000 + index;
    for (const keywordIndex of keywords) {
        const afterKeyword = index - keywordIndex;
        const beforeKeyword = keywordIndex - index;
        if (afterKeyword >= 0 && afterKeyword <= 600) best = Math.min(best, afterKeyword);
        if (beforeKeyword >= 0 && beforeKeyword <= 120) best = Math.min(best, 1000 + beforeKeyword);
    }
    return best;
}

function addContiguousCodes(text, candidates) {
    const pattern = /(^|[^\d])(\d{6})(?!\d)/g;
    for (const match of text.matchAll(pattern)) {
        candidates.push({ code: match[2], index: match.index + match[1].length });
    }
}

function addSpacedCodes(text, candidates) {
    const pattern = /(^|[^\d])(\d)[\s-]+(\d)[\s-]+(\d)[\s-]+(\d)[\s-]+(\d)[\s-]+(\d)(?!\d)/g;
    for (const match of text.matchAll(pattern)) {
        candidates.push({ code: match.slice(2, 8).join(''), index: match.index + match[1].length });
    }
}

function findCodeInText(text, raw) {
    const normalized = normalizeDigits(text);
    const candidates = [];
    addContiguousCodes(normalized, candidates);
    addSpacedCodes(normalized, candidates);
    const filtered = candidates.filter(({ code }) => !raw.includes(`t=${code}`) && !raw.includes(`x=${code}`));
    if (filtered.length === 0) return null;

    const keywords = keywordPositions(normalized);
    filtered.sort((left, right) => codePriority(left.index, keywords) - codePriority(right.index, keywords));
    return filtered[0].code;
}

function getMailBodyPreview(raw = '') {
    return htmlToText(extractMailBody(raw)).substring(0, 200);
}

function extractVerificationCodeFromMailRaw(raw = '') {
    if (!raw || typeof raw !== 'string') return null;
    const body = extractMailBody(raw);
    const candidates = [body, htmlToText(body), htmlToText(raw)];
    for (const candidate of candidates) {
        const code = findCodeInText(candidate, raw);
        if (code) return code;
    }
    return null;
}

module.exports = {
    extractMailBody,
    extractVerificationCodeFromMailRaw,
    getMailBodyPreview,
};

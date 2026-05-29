const axios = require('axios');

// hero-sms 国家 ID → 拨号前缀 + ISO 3166-1 alpha-2
const COUNTRY_MAP = {
    0:{dial:'7',iso:'RU'},1:{dial:'380',iso:'UA'},2:{dial:'7',iso:'KZ'},3:{dial:'86',iso:'CN'},
    4:{dial:'63',iso:'PH'},5:{dial:'95',iso:'MM'},6:{dial:'62',iso:'ID'},7:{dial:'60',iso:'MY'},
    8:{dial:'254',iso:'KE'},9:{dial:'255',iso:'TZ'},10:{dial:'84',iso:'VN'},11:{dial:'996',iso:'KG'},
    12:{dial:'1',iso:'US'},13:{dial:'972',iso:'IL'},14:{dial:'852',iso:'HK'},15:{dial:'48',iso:'PL'},
    16:{dial:'44',iso:'GB'},17:{dial:'261',iso:'MG'},18:{dial:'243',iso:'CD'},19:{dial:'234',iso:'NG'},
    20:{dial:'853',iso:'MO'},21:{dial:'20',iso:'EG'},22:{dial:'91',iso:'IN'},23:{dial:'353',iso:'IE'},
    24:{dial:'855',iso:'KH'},25:{dial:'856',iso:'LA'},26:{dial:'509',iso:'HT'},27:{dial:'225',iso:'CI'},
    28:{dial:'220',iso:'GM'},29:{dial:'381',iso:'RS'},30:{dial:'967',iso:'YE'},31:{dial:'27',iso:'ZA'},
    32:{dial:'40',iso:'RO'},33:{dial:'57',iso:'CO'},34:{dial:'372',iso:'EE'},35:{dial:'994',iso:'AZ'},
    36:{dial:'1',iso:'CA'},37:{dial:'212',iso:'MA'},38:{dial:'233',iso:'GH'},39:{dial:'54',iso:'AR'},
    40:{dial:'998',iso:'UZ'},41:{dial:'237',iso:'CM'},42:{dial:'235',iso:'TD'},43:{dial:'49',iso:'DE'},
    44:{dial:'370',iso:'LT'},45:{dial:'385',iso:'HR'},46:{dial:'46',iso:'SE'},47:{dial:'964',iso:'IQ'},
    48:{dial:'31',iso:'NL'},49:{dial:'371',iso:'LV'},50:{dial:'43',iso:'AT'},51:{dial:'375',iso:'BY'},
    52:{dial:'66',iso:'TH'},53:{dial:'966',iso:'SA'},54:{dial:'52',iso:'MX'},55:{dial:'886',iso:'TW'},
    56:{dial:'34',iso:'ES'},57:{dial:'98',iso:'IR'},58:{dial:'213',iso:'DZ'},59:{dial:'386',iso:'SI'},
    60:{dial:'880',iso:'BD'},61:{dial:'221',iso:'SN'},62:{dial:'90',iso:'TR'},63:{dial:'420',iso:'CZ'},
    64:{dial:'94',iso:'LK'},65:{dial:'51',iso:'PE'},66:{dial:'92',iso:'PK'},67:{dial:'64',iso:'NZ'},
    68:{dial:'224',iso:'GN'},69:{dial:'223',iso:'ML'},70:{dial:'58',iso:'VE'},71:{dial:'251',iso:'ET'},
    72:{dial:'976',iso:'MN'},73:{dial:'55',iso:'BR'},74:{dial:'93',iso:'AF'},75:{dial:'256',iso:'UG'},
    76:{dial:'244',iso:'AO'},77:{dial:'357',iso:'CY'},78:{dial:'33',iso:'FR'},79:{dial:'675',iso:'PG'},
    80:{dial:'258',iso:'MZ'},81:{dial:'977',iso:'NP'},82:{dial:'32',iso:'BE'},83:{dial:'359',iso:'BG'},
    84:{dial:'36',iso:'HU'},85:{dial:'373',iso:'MD'},86:{dial:'39',iso:'IT'},87:{dial:'595',iso:'PY'},
    88:{dial:'504',iso:'HN'},89:{dial:'216',iso:'TN'},90:{dial:'505',iso:'NI'},91:{dial:'670',iso:'TL'},
    92:{dial:'591',iso:'BO'},93:{dial:'506',iso:'CR'},94:{dial:'502',iso:'GT'},95:{dial:'971',iso:'AE'},
    96:{dial:'263',iso:'ZW'},97:{dial:'1',iso:'PR'},98:{dial:'249',iso:'SD'},99:{dial:'228',iso:'TG'},
    100:{dial:'965',iso:'KW'},101:{dial:'503',iso:'SV'},102:{dial:'218',iso:'LY'},103:{dial:'1',iso:'JM'},
    104:{dial:'1',iso:'TT'},105:{dial:'593',iso:'EC'},106:{dial:'268',iso:'SZ'},107:{dial:'968',iso:'OM'},
    108:{dial:'387',iso:'BA'},109:{dial:'1',iso:'DO'},110:{dial:'963',iso:'SY'},111:{dial:'974',iso:'QA'},
    112:{dial:'507',iso:'PA'},113:{dial:'53',iso:'CU'},114:{dial:'222',iso:'MR'},115:{dial:'232',iso:'SL'},
    116:{dial:'962',iso:'JO'},117:{dial:'351',iso:'PT'},118:{dial:'1',iso:'BB'},119:{dial:'257',iso:'BI'},
    120:{dial:'229',iso:'BJ'},121:{dial:'673',iso:'BN'},122:{dial:'1',iso:'BS'},123:{dial:'267',iso:'BW'},
    124:{dial:'501',iso:'BZ'},125:{dial:'236',iso:'CF'},126:{dial:'1',iso:'DM'},127:{dial:'1',iso:'GD'},
    128:{dial:'995',iso:'GE'},129:{dial:'30',iso:'GR'},130:{dial:'245',iso:'GW'},131:{dial:'592',iso:'GY'},
    132:{dial:'354',iso:'IS'},133:{dial:'269',iso:'KM'},134:{dial:'1',iso:'KN'},135:{dial:'231',iso:'LR'},
    136:{dial:'266',iso:'LS'},137:{dial:'265',iso:'MW'},138:{dial:'264',iso:'NA'},139:{dial:'227',iso:'NE'},
    140:{dial:'250',iso:'RW'},141:{dial:'421',iso:'SK'},142:{dial:'597',iso:'SR'},143:{dial:'992',iso:'TJ'},
    144:{dial:'377',iso:'MC'},145:{dial:'973',iso:'BH'},146:{dial:'262',iso:'RE'},147:{dial:'260',iso:'ZM'},
    148:{dial:'374',iso:'AM'},149:{dial:'252',iso:'SO'},150:{dial:'242',iso:'CG'},151:{dial:'56',iso:'CL'},
    152:{dial:'226',iso:'BF'},153:{dial:'961',iso:'LB'},154:{dial:'241',iso:'GA'},155:{dial:'355',iso:'AL'},
    156:{dial:'598',iso:'UY'},157:{dial:'230',iso:'MU'},158:{dial:'975',iso:'BT'},159:{dial:'960',iso:'MV'},
    160:{dial:'590',iso:'GP'},161:{dial:'993',iso:'TM'},162:{dial:'594',iso:'GF'},163:{dial:'358',iso:'FI'},
    164:{dial:'1',iso:'LC'},165:{dial:'352',iso:'LU'},166:{dial:'1',iso:'VC'},167:{dial:'240',iso:'GQ'},
    168:{dial:'253',iso:'DJ'},169:{dial:'1',iso:'AG'},170:{dial:'1',iso:'KY'},171:{dial:'382',iso:'ME'},
    172:{dial:'45',iso:'DK'},173:{dial:'41',iso:'CH'},174:{dial:'47',iso:'NO'},175:{dial:'61',iso:'AU'},
    176:{dial:'291',iso:'ER'},177:{dial:'211',iso:'SS'},178:{dial:'239',iso:'ST'},179:{dial:'297',iso:'AW'},
    180:{dial:'1',iso:'MS'},181:{dial:'1',iso:'AI'},182:{dial:'81',iso:'JP'},183:{dial:'389',iso:'MK'},
    184:{dial:'248',iso:'SC'},185:{dial:'687',iso:'NC'},186:{dial:'238',iso:'CV'},187:{dial:'1',iso:'US'},
    188:{dial:'970',iso:'PS'},189:{dial:'679',iso:'FJ'},190:{dial:'82',iso:'KR'},191:{dial:'850',iso:'KP'},
    192:{dial:'212',iso:'EH'},193:{dial:'677',iso:'SB'},194:{dial:'44',iso:'JE'},195:{dial:'1',iso:'BM'},
    196:{dial:'65',iso:'SG'},197:{dial:'676',iso:'TO'},198:{dial:'685',iso:'WS'},199:{dial:'356',iso:'MT'},
    200:{dial:'423',iso:'LI'},201:{dial:'350',iso:'GI'},202:{dial:'298',iso:'FO'},203:{dial:'383',iso:'XK'},
    204:{dial:'683',iso:'NU'},
};

// 按拨号前缀长度降序排列，用于从手机号中提取前缀（避免短前缀误匹配）
const DIAL_CODES_SORTED = Object.values(COUNTRY_MAP)
    .map(c => c.dial)
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => b.length - a.length);
const DEFAULT_COUNTRIES = [16];
const DEFAULT_NUMBER_ROUNDS = 3;
const NUMBER_POLL_INTERVAL_MS = 5000;

function formatHttpError(error) {
    const status = error?.response?.status;
    const data = error?.response?.data;

    if (!status) {
        return error.message;
    }

    if (!data || typeof data !== 'object') {
        return `${status} ${error.message}`;
    }

    const parts = [`HTTP ${status}`];

    if (data.title) {
        parts.push(`title=${data.title}`);
    }
    if (data.details) {
        parts.push(`details=${data.details}`);
    }
    if (data.info !== undefined) {
        parts.push(`info=${JSON.stringify(data.info)}`);
    }

    return parts.join(' | ');
}

function normalizeCountryList(country) {
    const rawList = Array.isArray(country) ? country : [country];
    const countries = rawList
        .map(item => parseInt(item, 10))
        .filter(Number.isFinite);
    return countries.length > 0 ? countries : DEFAULT_COUNTRIES;
}

function normalizeNumberOptions(options) {
    if (typeof options === 'number') {
        return {
            maxRounds: Number.isFinite(options) ? Math.max(1, options) : DEFAULT_NUMBER_ROUNDS,
            intervalMs: NUMBER_POLL_INTERVAL_MS,
        };
    }

    return {
        maxRounds: Math.max(1, parseInt(options?.maxRounds ?? DEFAULT_NUMBER_ROUNDS, 10)),
        intervalMs: Math.max(0, parseInt(options?.intervalMs ?? NUMBER_POLL_INTERVAL_MS, 10)),
    };
}

function isNoNumbersHttpError(error) {
    const status = error?.response?.status;
    const data = error?.response?.data || {};
    const title = String(data.title || '').toUpperCase();
    const details = String(data.details || '').toLowerCase();
    return status === 404 && (title.includes('NO_NUMBERS') || details.includes('numbers not found'));
}

class SMSProvider {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://hero-sms.com/stubs/handler_api.php';
        this.activationId = null;
        this.phoneNumber = null;
        this.countryId = null;
        this.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * 发送 API 请求
     */
    async request(action, params = {}) {
        const response = await axios.get(this.baseUrl, {
            params: { api_key: this.apiKey, action, ...params },
            timeout: 30000,
        });
        return response.data;
    }

    /**
     * 根据 hero-sms 国家 ID 获取拨号前缀和 ISO 代码
     * @param {number} countryId
     * @returns {{ dial: string, iso: string } | null}
     */
    getCountryInfo(countryId) {
        return COUNTRY_MAP[parseInt(countryId, 10)] || null;
    }

    getCountryInfoByDialCode(dialCode) {
        const normalized = String(dialCode || '').replace(/^\+/, '');
        const entry = Object.entries(COUNTRY_MAP).find(([, info]) => info.dial === normalized);
        return entry ? entry[1] : null;
    }

    getCountryInfoByPhone(phone) {
        return this.getCountryInfoByDialCode(SMSProvider.extractDialCode(phone));
    }

    setCurrentCountryId(countryId) {
        const parsed = parseInt(countryId, 10);
        this.countryId = Number.isFinite(parsed) ? parsed : null;
    }

    getCurrentCountryId() {
        return this.countryId;
    }

    getCurrentCountryInfo() {
        return this.getCountryInfo(this.countryId) || this.getCountryInfoByPhone(this.phoneNumber);
    }

    /**
     * 从完整手机号中提取拨号前缀
     * @param {string} phone - 完整手机号，如 +5511999999999
     * @returns {string} 拨号前缀，如 '55'
     */
    static extractDialCode(phone) {
        if (!phone) return '';
        const digits = phone.replace(/^\+/, '');
        for (const dial of DIAL_CODES_SORTED) {
            if (digits.startsWith(dial)) return dial;
        }
        return '';
    }

    async requestNumberOnce(service, country, maxPrice) {
        try {
            const data = await this.request('getNumberV2', { service, country, maxPrice });
            if (typeof data !== 'string') return { ok: true, data };
            if (data === 'NO_BALANCE') throw new Error('HeroSMS 余额不足');
            if (data === 'BAD_KEY') throw new Error('HeroSMS API Key 无效');
            if (data === 'NO_NUMBERS') return { ok: false, reason: data, quiet: true };
            throw new Error(`获取号码失败: ${data}`);
        } catch (error) {
            if (!error.response) throw error;

            const errorDetails = formatHttpError(error);
            if (error.response.status === 422) {
                throw new Error(`HeroSMS 请求参数无效: ${errorDetails}`);
            }
            return {
                ok: false,
                reason: errorDetails,
                quiet: isNoNumbersHttpError(error),
            };
        }
    }

    saveNumberData(data, country) {
        this.activationId = data.activationId;
        this.phoneNumber = String(data.phoneNumber);
        this.setCurrentCountryId(country);

        if (!this.phoneNumber.startsWith('+')) {
            this.phoneNumber = `+${this.phoneNumber}`;
        }

        console.log(`[SMS] 获取号码: ${this.phoneNumber} (activation: ${this.activationId}, 费用: $${data.activationCost})`);
        return { activationId: this.activationId, phoneNumber: this.phoneNumber };
    }

    /**
     * 获取手机号码（V2 接口，返回 JSON）
     * @param {string} service - 服务代码（OpenAI = 'dr'）
     * @param {number|number[]} country - 国家 ID 或国家 ID 数组
     * @param {number} maxPrice - 可接受的最高价格
     * @param {number|object} options - 数字为兼容旧 maxRetries；对象支持 maxRounds/intervalMs
     * @returns {Promise<{activationId: number, phoneNumber: string}>}
     */
    async getNumber(service = 'dr', country = DEFAULT_COUNTRIES, maxPrice, options = {}) {
        const countries = normalizeCountryList(country);
        const { maxRounds, intervalMs } = normalizeNumberOptions(options);
        let lastReason = '';

        this.activationId = null;
        this.phoneNumber = null;
        this.countryId = null;

        for (let round = 1; round <= maxRounds; round++) {
            for (let index = 0; index < countries.length; index++) {
                const countryId = countries[index];
                const result = await this.requestNumberOnce(service, countryId, maxPrice);
                if (result.ok) return this.saveNumberData(result.data, countryId);

                lastReason = result.reason;
                if (!result.quiet) {
                    console.warn(`[SMS] 国家 ${countryId} 获取号码失败: ${result.reason}`);
                }

                const isFinalAttempt = round === maxRounds && index === countries.length - 1;
                if (!isFinalAttempt) await this.sleep(intervalMs);
            }
            console.log(`[SMS] 第 ${round}/${maxRounds} 轮未获取到号码`);
        }

        throw new Error(`当前无可用号码（已轮询 ${countries.length} 个国家 x ${maxRounds} 轮，最后错误: ${lastReason || 'NO_NUMBERS'}）`);
    }

    /**
     * 标记准备接收短信
     */
    async markReady() {
        await this.request('setStatus', { id: this.activationId, status: 1 });
        console.log('[SMS] 已标记为准备接收短信');
    }

    /**
     * 查询激活状态（V2 接口）
     * @returns {Promise<{received: boolean, code?: string}>}
     */
    async getStatus() {
        const data = await this.request('getStatusV2', { id: this.activationId });

        if (typeof data === 'string') {
            if (data === 'STATUS_WAIT_CODE') return { received: false };
            if (data === 'STATUS_CANCEL') throw new Error('激活已被取消');
            if (data.startsWith('STATUS_OK:')) {
                return { received: true, code: data.split(':')[1] };
            }
            return { received: false };
        }

        // V2 JSON 响应
        const smsCode = data?.sms?.code;
        if (smsCode && smsCode.length > 0) {
            return { received: true, code: smsCode };
        }
        return { received: false };
    }

    /**
     * 轮询等待短信验证码
     * @param {object} options
     * @param {number} options.interval - 轮询间隔（毫秒，默认 5000）
     * @param {number} options.maxAttempts - 最大尝试次数（默认 26 = 130秒）
     * @returns {Promise<string>} 验证码
     */
    async pollForCode(options = {}) {
        const { interval = 5000, maxAttempts = 26 } = options;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            console.log(`[SMS] 等待短信验证码... (${attempt}/${maxAttempts})`);

            try {
                const result = await this.getStatus();
                if (result.received) {
                    console.log(`[SMS] 收到验证码: ${result.code}`);
                    return result.code;
                }
            } catch (error) {
                console.error(`[SMS] 查询状态出错: ${error.message}`);
            }

            if (attempt < maxAttempts) {
                await this.sleep(interval);
            }
        }

        const timeoutSeconds = (maxAttempts * interval) / 1000;
        console.error(`[SMS] 等待短信验证码超过 ${timeoutSeconds} 秒，取消当前号码`);
        await this.cancel();
        throw new Error(`短信验证码超时（等待 ${timeoutSeconds} 秒），已取消当前号码`);
    }

    /**
     * 完成激活（确认已收到验证码）
     */
    async complete() {
        await this.request('setStatus', { id: this.activationId, status: 6 });
        console.log('[SMS] 激活已完成');
    }

    /**
     * 取消激活（退款）
     */
    async cancel() {
        try {
            await this.request('setStatus', { id: this.activationId, status: 8 });
            console.log('[SMS] 激活已取消（退款）');
        } catch (error) {
            // 409 = EARLY_CANCEL_DENIED（刚创建的号码不能立即取消）
            // 其他错误也不应阻塞主流程
            console.error(`[SMS] 取消失败: ${error.message}（号码将在超时后自动退款）`);
        }
    }

    /**
     * 获取格式化的手机号
     * @returns {string}
     */
    getPhone() {
        return this.phoneNumber;
    }

    /**
     * 获取去掉拨号前缀的本地号码
     * @returns {string}
     */
    getPhoneLocal() {
        const dial = SMSProvider.extractDialCode(this.phoneNumber);
        return dial ? this.phoneNumber.slice(1 + dial.length) : this.phoneNumber;
    }
}

module.exports = { SMSProvider };

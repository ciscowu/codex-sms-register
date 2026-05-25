const path = require('path');
const fs = require('fs');
const { SMSProvider } = require('./src/smsProvider');
const { MailProvider } = require('./src/mailProvider');
const { BrowserService } = require('./src/browserService');
const { OAuthService } = require('./src/oauthService');
const { generateRandomName, generateRandomPassword } = require('./src/randomIdentity');
const { extractVerificationCodeFromMailRaw, getMailBodyPreview } = require('./src/mailCodeExtractor');
const config = require('./src/config');
const { shouldAllowXvfb, shouldBlockXvfbRuntime } = require('./src/runtimeEnvironment');

// command line args
const args = process.argv.slice(2);
const PHASE2_ONLY = args.includes('--phase2');
const PHASE8_ONLY = args.includes('--phase8');
const TARGET_COUNT = parseInt(args.find(a => /^\d+$/.test(a)) || '1', 10);
const DATA_DIR = config.dataDir || process.cwd();
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const USERNAME_FILE = path.join(DATA_DIR, 'username.json');
const ERROR_ACCOUNT_FILE = path.join(DATA_DIR, 'error_account.json');
const LEGACY_SHIBAI_FILE = path.join(DATA_DIR, 'shibai.json');
const TOKEN_OUTPUT_DIR = config.tokenOutputDir || path.join(DATA_DIR, 'tokens');
const SMS_POLL_INTERVAL = 5000;
const SMS_MAX_ATTEMPTS = 26; // 26 * 5s = 130s
const PHASE8_ACCOUNT_DELAY_MS = 60 * 1000;

function createMailProvider() {
    return new MailProvider({
        provider: config.mailProvider,
        baseUrl: config.mailBaseUrl,
        adminPassword: config.mailAdminPassword,
        sitePassword: config.mailSitePassword,
        domain: config.mailDomain,
        omrmail: config.omrmail,
    });
}

function requireMailConfig(context) {
    if (config.mailProvider === 'omrmail') {
        if (!config.omrmail?.apiKey) {
            throw new Error(`${context} requires omrmail.api_key in config.yaml/config.json`);
        }
        return;
    }

    if (!config.mailBaseUrl || !config.mailAdminPassword || !config.mailDomain) {
        throw new Error(`${context} requires mailBaseUrl / mailAdminPassword / mailDomain in config.yaml/config.json`);
    }
}

async function markMailAbnormalIfAvailable(mailProvider, context) {
    const email = mailProvider?.getEmail?.();
    if (!email || typeof mailProvider?.markAbnormal !== 'function') return false;
    const changed = await mailProvider.markAbnormal(email);
    if (changed) console.warn(`[${context}] OMRMail 邮箱已标记异常: ${email}`);
    return changed;
}

function isProxyConnectionError(error) {
    const msg = String(error?.message || '');
    return msg.includes('ERR_PROXY_CONNECTION_FAILED') || msg.includes('ECONNREFUSED') || msg.includes('tunnel') || msg.includes('proxy');
}

function readCmdlineByPid(pid) {
    if (!pid || process.platform !== 'linux') return '';
    try {
        const raw = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        return raw.replace(/\u0000/g, ' ').trim();
    } catch (e) {
        return '';
    }
}

function getParentPid(pid) {
    if (!pid || process.platform !== 'linux') return 0;
    try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        const parts = stat.split(' ');
        return parseInt(parts[3], 10) || 0;
    } catch (e) {
        return 0;
    }
}

function assertNotRunningWithXvfb() {
    if (process.platform !== 'linux') return;

    const parentCmd = readCmdlineByPid(process.ppid);
    const grandParentPid = getParentPid(process.ppid);
    const grandParentCmd = readCmdlineByPid(grandParentPid);
    const allowXvfb = shouldAllowXvfb();
    const hit = shouldBlockXvfbRuntime({
        platform: process.platform,
        parentCmd,
        grandParentCmd,
        xauthority: process.env.XAUTHORITY,
        display: process.env.DISPLAY,
        allowXvfb,
    });

    if (hit) {
        throw new Error('禁止使用 xvfb 运行项目。容器内请设置 ALLOW_XVFB=1 或在 Docker 中运行。');
    }
}

function ensureParentDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

/**
 * 获取另一个数据目录（用于双写同步）
 * 当前目录是 data/ 时返回根目录，反之亦然
 */
function getAlternateDataDir() {
    const currentDir = DATA_DIR;
    const rootDir = process.cwd();
    const dataDir = path.resolve(rootDir, 'data');

    // 如果当前是 data/ 目录，返回根目录；否则返回 data/ 目录
    if (path.resolve(currentDir) === path.resolve(dataDir)) {
        return rootDir;
    }
    return dataDir;
}

/**
 * 合并两个位置的 JSON 数组文件（启动时调用）
 * 以 phone 为主键去重，合并后写回两个位置
 */
function mergeJsonFiles(primaryPath, secondaryPath, keyField = 'phone') {
    const primary = readJsonArray(primaryPath);
    const secondary = readJsonArray(secondaryPath);

    if (primary.length === 0 && secondary.length === 0) return [];
    if (secondary.length === 0) return primary;
    if (primary.length === 0) {
        ensureParentDir(primaryPath);
        fs.writeFileSync(primaryPath, JSON.stringify(secondary, null, 2));
        return secondary;
    }

    // 以 keyField 为主键合并，保留最新的记录
    const mergedMap = new Map();
    for (const item of primary) {
        const key = item[keyField];
        if (key) mergedMap.set(key, item);
    }
    for (const item of secondary) {
        const key = item[keyField];
        if (!key) continue;
        const existing = mergedMap.get(key);
        if (!existing) {
            mergedMap.set(key, item);
        } else {
            // 比较 createdAt，保留更新的
            const existingTime = new Date(existing.createdAt || 0).getTime();
            const itemTime = new Date(item.createdAt || 0).getTime();
            if (itemTime > existingTime) {
                mergedMap.set(key, item);
            }
        }
    }

    return Array.from(mergedMap.values());
}

/**
 * 启动时合并本地和根目录的数据文件
 */
function mergeDataFiles() {
    const altDir = getAlternateDataDir();
    const altAccounts = path.join(altDir, 'accounts.json');
    const altUsername = path.join(altDir, 'username.json');

    console.log(`[同步] 检查数据同步: ${DATA_DIR} <-> ${altDir}`);

    // 合并 accounts.json
    if (fs.existsSync(ACCOUNTS_FILE) || fs.existsSync(altAccounts)) {
        const mergedAccounts = mergeJsonFiles(ACCOUNTS_FILE, altAccounts, 'phone');
        ensureParentDir(ACCOUNTS_FILE);
        fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(mergedAccounts, null, 2));
        if (path.resolve(ACCOUNTS_FILE) !== path.resolve(altAccounts)) {
            ensureParentDir(altAccounts);
            fs.writeFileSync(altAccounts, JSON.stringify(mergedAccounts, null, 2));
        }
        console.log(`[同步] accounts.json 合并完成 (共 ${mergedAccounts.length} 条)`);
    }

    // 合并 username.json
    if (fs.existsSync(USERNAME_FILE) || fs.existsSync(altUsername)) {
        const mergedUsername = mergeJsonFiles(USERNAME_FILE, altUsername, 'email');
        ensureParentDir(USERNAME_FILE);
        fs.writeFileSync(USERNAME_FILE, JSON.stringify(mergedUsername, null, 2));
        if (path.resolve(USERNAME_FILE) !== path.resolve(altUsername)) {
            ensureParentDir(altUsername);
            fs.writeFileSync(altUsername, JSON.stringify(mergedUsername, null, 2));
        }
        console.log(`[同步] username.json 合并完成 (共 ${mergedUsername.length} 条)`);
    }
}

/**
 * 生成随机用户数据
 */
function generateUserData() {
    const fullName = generateRandomName();
    const password = generateRandomPassword();

    const age = 25 + Math.floor(Math.random() * 16);
    const birthYear = new Date().getFullYear() - age;
    const birthMonth = 1 + Math.floor(Math.random() * 12);
    const birthDay = 1 + Math.floor(Math.random() * 28);
    const birthDate = `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`;

    return { fullName, password, age, birthDate, birthMonth, birthDay, birthYear };
}

/**
 * 从邮箱中轮询获取验证码
 */
async function pollEmailCode(mailProvider, maxAttempts = 30, interval = 5000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`[Mail] 轮询邮箱验证码... (${attempt}/${maxAttempts})`);

        try {
            const mails = await mailProvider.getMails(5, 0);
            if (mails.length > 0) {
                const latest = mails[0];
                const raw = latest.raw || '';
                const code = extractVerificationCodeFromMailRaw(raw);
                if (code) {
                    console.log(`[Mail] 收到验证码: ${code}`);
                    return code;
                }

                console.log(`[Mail] 邮件已收到但未提取到验证码，正文前200字: ${getMailBodyPreview(raw)}`);
            }
        } catch (error) {
            console.error(`[Mail] 查询出错: ${error.message}`);
        }

        await new Promise(r => setTimeout(r, interval));
    }

    throw new Error(`邮箱验证码超时（等待 ${(maxAttempts * interval) / 1000} 秒）`);
}

async function pollEmailCodeByAddress(mailProvider, email, maxAttempts = 30, interval = 5000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`[Mail][Phase8] polling ${email} code... (${attempt}/${maxAttempts})`);
        try {
            const mails = await mailProvider.getMailsByAddress(email, 5, 0);
            if (Array.isArray(mails) && mails.length > 0) {
                const code = extractVerificationCodeFromMailRaw(mails[0]?.raw || '');
                if (code) {
                    console.log(`[Mail][Phase8] latest code for ${email}: ${code}`);
                    return code;
                }
            }
        } catch (error) {
            console.error(`[Mail][Phase8] query error for ${email}: ${error.message}`);
        }
        await new Promise(r => setTimeout(r, interval));
    }
    throw new Error(`${email} email code timeout`);
}

function readJsonArray(filePath, fallbackPaths = []) {
    const candidates = [filePath, ...fallbackPaths];
    const existingFile = candidates.find((candidate) => fs.existsSync(candidate));
    if (!existingFile) return [];
    try {
        const parsed = JSON.parse(fs.readFileSync(existingFile, 'utf8'));
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object') return [parsed];
        return [];
    } catch (e) {
        return [];
    }
}

function appendToJsonArrayFile(filePath, item) {
    const list = readJsonArray(filePath);
    list.push(item);
    ensureParentDir(filePath);
    fs.writeFileSync(filePath, JSON.stringify(list, null, 2));
    return list.length;
}

function appendFailedToErrorAccount(entry) {
    const failedEntry = entry && typeof entry === 'object' ? { ...entry } : { raw: entry };
    const existing = readJsonArray(ERROR_ACCOUNT_FILE, [LEGACY_SHIBAI_FILE]);
    existing.push(failedEntry);
    ensureParentDir(ERROR_ACCOUNT_FILE);
    fs.writeFileSync(ERROR_ACCOUNT_FILE, JSON.stringify(existing, null, 2));
    console.log(`[Phase8] appended failed record to error_account.json, total=${existing.length}`);
}

function calcAgeFromBirthDate(birthDate) {
    const year = parseInt(String(birthDate || '').slice(0, 4), 10);
    if (!Number.isFinite(year)) return 30;
    return Math.max(18, new Date().getFullYear() - year);
}

function getUsernameRecords() {
    return readJsonArray(USERNAME_FILE);
}

function saveAccount(phone, password, name, birthDate) {
    let accounts = [];
    if (fs.existsSync(ACCOUNTS_FILE)) {
        try { accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')); } catch (e) {}
    }
    accounts.push({
        phone, password, name, birthDate,
        createdAt: new Date().toISOString(),
        status: 'registered',
    });
    ensureParentDir(ACCOUNTS_FILE);
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
    console.log(`[账号] 已保存到 ${ACCOUNTS_FILE} (共 ${accounts.length} 个)`);

    // 双写：同步到另一个数据目录
    const altDir = getAlternateDataDir();
    const altAccounts = path.join(altDir, 'accounts.json');
    if (path.resolve(ACCOUNTS_FILE) !== path.resolve(altAccounts)) {
        ensureParentDir(altAccounts);
        fs.writeFileSync(altAccounts, JSON.stringify(accounts, null, 2));
        console.log(`[账号] 双写同步: ${altAccounts}`);
    }
}

/**
 * 加载一个未完成 OAuth 的账号
 */
function loadAccount() {
    if (!fs.existsSync(ACCOUNTS_FILE)) return null;
    const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    const available = accounts.find(a => a.status === 'registered' && a.password);
    return available || null;
}

function findAccountByPhone(phone) {
    if (!phone || !fs.existsSync(ACCOUNTS_FILE)) return null;
    try {
        const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
        return accounts.find(a => a.phone === phone) || null;
    } catch (e) {
        return null;
    }
}

/**
 * 更新账号状态
 */
function updateAccountStatus(phone, status) {
    if (!fs.existsSync(ACCOUNTS_FILE)) return;
    const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    const account = accounts.find(a => a.phone === phone);
    if (account) {
        account.status = status;
        ensureParentDir(ACCOUNTS_FILE);
        fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));

        // 双写：同步到另一个数据目录
        const altDir = getAlternateDataDir();
        const altAccounts = path.join(altDir, 'accounts.json');
        if (path.resolve(ACCOUNTS_FILE) !== path.resolve(altAccounts)) {
            let altAccountsList = [];
            if (fs.existsSync(altAccounts)) {
                try { altAccountsList = JSON.parse(fs.readFileSync(altAccounts, 'utf8')); } catch (e) {}
            }
            const altAccount = altAccountsList.find(a => a.phone === phone);
            if (altAccount) {
                altAccount.status = status;
            } else {
                altAccountsList.push({ ...account });
            }
            ensureParentDir(altAccounts);
            fs.writeFileSync(altAccounts, JSON.stringify(altAccountsList, null, 2));
        }
    }
}

/**
 * 更新账号邮箱（Phase 2 绑定邮箱后调用）
 */
function updateAccountEmail(phone, email) {
    if (!fs.existsSync(ACCOUNTS_FILE)) return;
    const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    const account = accounts.find(a => a.phone === phone);
    if (account) {
        account.email = email;
        ensureParentDir(ACCOUNTS_FILE);
        fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
        console.log(`[账号] 已更新邮箱: ${phone} -> ${email}`);

        // 双写
        const altDir = getAlternateDataDir();
        const altAccounts = path.join(altDir, 'accounts.json');
        if (path.resolve(ACCOUNTS_FILE) !== path.resolve(altAccounts)) {
            let altAccountsList = [];
            if (fs.existsSync(altAccounts)) {
                try { altAccountsList = JSON.parse(fs.readFileSync(altAccounts, 'utf8')); } catch (e) {}
            }
            const altAccount = altAccountsList.find(a => a.phone === phone);
            if (altAccount) {
                altAccount.email = email;
            }
            ensureParentDir(altAccounts);
            fs.writeFileSync(altAccounts, JSON.stringify(altAccountsList, null, 2));
        }
    }
}

function saveUsernameFile({ email, phone, password, name, birthDate, status }) {
    const account = findAccountByPhone(phone);
    const outData = {
        email: email || '',
        phone: phone || '',
        password: password || '',
        name: name || '',
        birthDate: birthDate || '',
        createdAt: account?.createdAt || new Date().toISOString(),
        status: status || account?.status || 'registered',
    };

    let usernameList = [];
    if (fs.existsSync(USERNAME_FILE)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(USERNAME_FILE, 'utf8'));
            if (Array.isArray(parsed)) {
                usernameList = parsed;
            } else if (parsed && typeof parsed === 'object') {
                usernameList = [parsed];
            }
        } catch (e) {
            usernameList = [];
        }
    }

    usernameList.push(outData);
    ensureParentDir(USERNAME_FILE);
    fs.writeFileSync(USERNAME_FILE, JSON.stringify(usernameList, null, 2));
    console.log(`[账号] 已追加保存账户信息: ${USERNAME_FILE} (共 ${usernameList.length} 条)`);

    // 双写：同步到另一个数据目录
    const altDir = getAlternateDataDir();
    const altUsername = path.join(altDir, 'username.json');
    if (path.resolve(USERNAME_FILE) !== path.resolve(altUsername)) {
        let altList = [];
        if (fs.existsSync(altUsername)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(altUsername, 'utf8'));
                altList = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
            } catch (e) {
                altList = [];
            }
        }
        altList.push(outData);
        ensureParentDir(altUsername);
        fs.writeFileSync(altUsername, JSON.stringify(altList, null, 2));
        console.log(`[账号] 双写同步: ${altUsername}`);
    }
}

/**
 * 第一阶段：用手机号注册 ChatGPT
 */
async function phase1(smsProvider, browserService, userData) {
    console.log('\n=========================================');
    console.log('[阶段1] 开始 ChatGPT 手机号注册流程');
    console.log('=========================================');

    let numberUsed = false;
    let numberAcquired = false;

    try {
        // 1. 先获取手机号并标记为准备接收短信
        await smsProvider.getNumber(config.heroSmsService, config.heroSmsCountry, config.heroSmsMaxPrice);
        numberAcquired = true;
        await smsProvider.markReady();

        // 2. 再打开注册页面
        await browserService.navigateToSignup();

        // 3. 根据 heroSmsCountry 动态选择国家并输入手机号
        const countryInfo = smsProvider.getCountryInfo(config.heroSmsCountry);
        const dialCode = countryInfo ? countryInfo.dial : SMSProvider.extractDialCode(smsProvider.getPhone());
        const isoCode = countryInfo ? countryInfo.iso : '';
        const countryName = countryInfo ? '' : '';
        await browserService.selectCountry(dialCode, countryName, isoCode);
        const localNumber = smsProvider.getPhoneLocal();
        await browserService.enterPhone(localNumber);
        numberUsed = true;

        // 4. 完成注册资料（密码、验证码、姓名、生日等）
        // 当页面需要 SMS 验证码时，通过回调获取
        await browserService.completeProfile(userData, async () => {
            console.log('[阶段1] 页面需要 SMS 验证码，开始轮询...');
            const code = await smsProvider.pollForCode({
                interval: SMS_POLL_INTERVAL,
                maxAttempts: SMS_MAX_ATTEMPTS,
            });
            return code;
        });

        // 6. 完成 SMS 激活
        await smsProvider.complete();

        // 7. 保存账号信息
        saveAccount(smsProvider.getPhone(), userData.password, userData.fullName, userData.birthDate);

        console.log('[阶段1] ChatGPT 注册流程完成！');
        return true;

    } catch (error) {
        if (!numberUsed && numberAcquired) {
            console.error('[阶段1] 流程失败，取消号码退款...');
            await smsProvider.cancel();
        } else if (numberUsed) {
            await smsProvider.complete().catch(() => {});
        }
        throw error;
    }
}

/**
 * 第 1.5 阶段：首次登录 chatgpt.com 完成 about-you
 */
async function phase1_5(smsProvider, browserService, userData) {
    console.log('\n=========================================');
    console.log('[阶段1.5] 首次登录 chatgpt.com 完成个人资料');
    console.log('=========================================');

    const countryInfo1_5 = smsProvider.getCountryInfo(config.heroSmsCountry);
    await browserService.loginAndCompleteProfile({
        phone: smsProvider.getPhone(),
        password: userData.password,
        fullName: userData.fullName,
        birthDate: userData.birthDate,
        dialCode: countryInfo1_5 ? countryInfo1_5.dial : '',
        isoCode: countryInfo1_5 ? countryInfo1_5.iso : '',
    });

    console.log('[阶段1.5] 完成！');
}

/**
 * 第二阶段：Codex OAuth（手机号登录并绑定临时邮箱）
 */
async function phase2(smsProvider, mailProvider, browserService, oauthService, userData) {
    console.log('\n=========================================');
    console.log('[阶段2] 开始 Codex OAuth（绑定临时邮箱）');
    console.log('=========================================');

    // 1. 创建临时邮箱
    await mailProvider.createAddress(null, userData.fullName);
    await mailProvider.markClaimed(mailProvider.getEmail());
    console.log(`[阶段2] 邮箱: ${mailProvider.getEmail()}`);

    // 2. 第一轮：手机号登录并绑定临时邮箱（不取 token）
    oauthService.regeneratePKCE();
    const bindEmailAuthUrl = oauthService.getAuthUrl();
    console.log(`[阶段2] 绑定邮箱 OAuth URL: ${bindEmailAuthUrl.substring(0, 100)}...`);

    // 3. 导航到 OAuth 页面并完成邮箱绑定
    await browserService.navigateToOAuth(bindEmailAuthUrl);
    const countryInfo2 = smsProvider.getCountryInfo(config.heroSmsCountry);
    await browserService.oauthLoginAndAuthorize({
        loginMethod: 'phone',
        stopAfterEmailBound: true,
        phone: smsProvider.getPhone(),
        email: mailProvider.getEmail(),
        password: userData.password,
        fullName: userData.fullName,
        age: userData.age,
        birthDate: userData.birthDate,
        redirectUri: oauthService.redirectUri,
        dialCode: countryInfo2 ? countryInfo2.dial : '',
        isoCode: countryInfo2 ? countryInfo2.iso : '',
        onSmsNeeded: async () => {
            console.log('[阶段2]（绑定邮箱）需要 SMS 验证码...');
            return await smsProvider.pollForCode({ interval: SMS_POLL_INTERVAL, maxAttempts: SMS_MAX_ATTEMPTS });
        },
        onEmailCodeNeeded: async () => {
            console.log('[阶段2]（绑定邮箱）需要邮箱验证码...');
            return await pollEmailCode(mailProvider);
        },
    });
    console.log('[阶段2] 临时邮箱绑定完成');

    // 优先使用 consent 页面读到的邮箱（权威来源），其次用 mailProvider 的
    const consentEmail = browserService._consentEmail || null;
    return {
        email: consentEmail || mailProvider.getEmail(),
    };
}

/**
 * 第三阶段：重新进入 Codex OAuth（临时邮箱登录并获取 token）
 */
async function phase3(smsProvider, mailProvider, browserService, oauthService, userData) {
    console.log('\n=========================================');
    console.log('[阶段3] 开始 Codex OAuth（临时邮箱登录获取 Token）');
    console.log('=========================================');

    if (!mailProvider.getEmail()) {
        throw new Error('阶段3失败：未检测到已绑定的临时邮箱，请先执行阶段2');
    }

    console.log('[阶段3] 重新发起 Codex OAuth（邮箱登录）...');

    // 重新生成 PKCE，使用临时邮箱登录并获取授权码
    oauthService.regeneratePKCE();
    const authUrl = oauthService.getAuthUrl();
    console.log(`[阶段3] OAuth URL(邮箱登录): ${authUrl.substring(0, 100)}...`);
    await browserService.navigateToOAuth(authUrl);

    // 一站式登录 + 授权（邮箱登录）
    const countryInfo3 = smsProvider.getCountryInfo(config.heroSmsCountry);
    const callbackUrl = await browserService.oauthLoginAndAuthorize({
        loginMethod: 'email',
        phone: smsProvider.getPhone(),
        email: mailProvider.getEmail(),
        password: userData.password,
        fullName: userData.fullName,
        age: userData.age,
        birthDate: userData.birthDate,
        redirectUri: oauthService.redirectUri,
        dialCode: countryInfo3 ? countryInfo3.dial : '',
        isoCode: countryInfo3 ? countryInfo3.iso : '',
        onSmsNeeded: async () => {
            console.log('[阶段3] 需要 SMS 验证码...');
            return await smsProvider.pollForCode({ interval: SMS_POLL_INTERVAL, maxAttempts: SMS_MAX_ATTEMPTS });
        },
        onEmailCodeNeeded: async () => {
            console.log('[阶段3] 需要邮箱验证码...');
            return await pollEmailCodeByAddress(mailProvider, mailProvider.getEmail());
        },
    });

    console.log(`[阶段3] 回调 URL: ${callbackUrl}`);

    // 提取授权参数
    const params = oauthService.extractCallbackParams(callbackUrl);
    if (!params || params.error) {
        throw new Error(`OAuth 授权失败: ${params?.error_description || params?.error || '未知错误'}`);
    }
    if (!params.code) {
        throw new Error('回调 URL 中未找到授权码');
    }

    console.log(`[阶段3] 成功获取授权码: ${params.code.substring(0, 10)}...`);

    // 用授权码换取 Token（传递密码以便保存到 token 文件）
    const tokenData = await oauthService.exchangeTokenAndSave(params.code, mailProvider.getEmail(), {
        password: userData.password,
    });
    return tokenData;
}

/**
 * 单次注册流程
 */
async function runSingleRegistration() {
    console.log('\n=========================================');
    console.log('[主程序] 开始一次全新的注册与授权流程');
    console.log('=========================================');

    const smsProvider = new SMSProvider(config.heroSmsApiKey);
    const mailProvider = createMailProvider();
    const baseProxy = config.proxyHost ? {
        host: config.proxyHost,
        port: config.proxyPort,
        username: config.proxyUsername,
        password: config.proxyPassword,
    } : null;
    let browserService = null;
    let oauthService = null;
    let tokenCompleted = false;

    const createServices = (useProxy) => {
        const proxy = useProxy ? baseProxy : null;
        const b = new BrowserService(proxy, {
            useChrome: config.useChrome,
            chromePath: config.chromePath,
        });
        const oauthProxy = proxy ? {
            host: proxy.host,
            port: proxy.port,
            username: proxy.username,
            password: proxy.password,
        } : null;
        const o = new OAuthService({ proxy: oauthProxy });
        return { b, o };
    };

    const executeFlow = async () => {
        if (PHASE2_ONLY) {
            // --phase2 模式：使用已注册的账号跑 Phase 1.5 + Phase 2
            const account = loadAccount();
            if (!account) {
                throw new Error('accounts.json 中没有可用账号，请先跑完整流程注册');
            }
            console.log(`[主程序] Phase2 模式: 使用账号 ${account.phone} (${account.name})`);
            smsProvider.phoneNumber = account.phone;
            const userData = {
                fullName: account.name,
                password: account.password,
                birthDate: account.birthDate,
                age: new Date().getFullYear() - parseInt(account.birthDate),
            };

            // 先完成首次登录 about-you
            await phase1_5(smsProvider, browserService, userData);

            const phase2Data = await phase2(smsProvider, mailProvider, browserService, oauthService, userData);
            mailProvider.address = phase2Data.email;
            updateAccountEmail(account.phone, phase2Data.email);
            saveUsernameFile({
                email: phase2Data.email,
                phone: account.phone,
                password: account.password,
                name: account.name,
                birthDate: account.birthDate,
                status: 'email_bound',
            });

            const tokenData = await phase3(smsProvider, mailProvider, browserService, oauthService, userData);
            tokenCompleted = true;
            await mailProvider.markAuthenticated(tokenData.email);
            updateAccountStatus(account.phone, 'oauth_done');
            console.log('[主程序] Phase2 完成！');
            console.log(`[主程序] Token 已保存，邮箱: ${tokenData.email}`);
            return true;
        }

        // 正常模式：Phase 1 + Phase 1.5 + Phase 2
        const userData = generateUserData();
        console.log(`[主程序] 用户: ${userData.fullName}, 年龄: ${userData.age}, 生日: ${userData.birthDate}`);

        // 1. 第一阶段：手机号注册
        await phase1(smsProvider, browserService, userData);

        // 1.5. 首次登录完成个人资料
        await phase1_5(smsProvider, browserService, userData);

        // 2. 第二阶段：手机号登录并绑定临时邮箱
        const phase2Data = await phase2(smsProvider, mailProvider, browserService, oauthService, userData);
        mailProvider.address = phase2Data.email;
        updateAccountEmail(smsProvider.getPhone(), phase2Data.email);
        saveUsernameFile({
            email: phase2Data.email,
            phone: smsProvider.getPhone(),
            password: userData.password,
            name: userData.fullName,
            birthDate: userData.birthDate,
            status: 'email_bound',
        });

        // 3. 第三阶段：临时邮箱登录并获取 token
        const tokenData = await phase3(smsProvider, mailProvider, browserService, oauthService, userData);
        tokenCompleted = true;
        await mailProvider.markAuthenticated(tokenData.email);

        updateAccountStatus(smsProvider.getPhone(), 'oauth_done');
        console.log('[主程序] 本次注册流程圆满结束！');
        console.log(`[主程序] Token 已保存，邮箱: ${tokenData.email}`);
        return true;
    };

    try {
        const hasProxy = !!baseProxy;

        // 优先走配置代理
        ({ b: browserService, o: oauthService } = createServices(hasProxy));
        await browserService.launch();
        try {
            return await executeFlow();
        } catch (error) {
            if (hasProxy && isProxyConnectionError(error)) {
                console.warn('[主程序] 检测到代理连接失败，自动切换为直连重试本轮任务...');
                await browserService.close().catch(() => {});
                ({ b: browserService, o: oauthService } = createServices(false));
                await browserService.launch();
                return await executeFlow();
            }
            throw error;
        }

    } catch (error) {
        console.error('[主程序] 本次任务执行失败:', error.message);
        if (!tokenCompleted) await markMailAbnormalIfAvailable(mailProvider, '主程序');
        // 打印 axios 响应详情帮助定位 400 等 HTTP 错误
        if (error?.response) {
            console.error(`[主程序] HTTP ${error.response.status}: ${JSON.stringify(error.response.data || '').substring(0, 500)}`);
            console.error(`[主程序] 请求 URL: ${error?.config?.url || 'unknown'}`);
        }
        throw error;
    } finally {
        await browserService.close();
    }
}

/**
 * 检查 token 数量
 */
async function runPhase8ForEntry(entry, index, total) {
    const email = String(entry?.email || '').trim();
    if (!email) {
        throw new Error('Phase8 entry is missing email');
    }

    const mailProvider = createMailProvider();

    const baseProxy = config.proxyHost ? {
        host: config.proxyHost,
        port: config.proxyPort,
        username: config.proxyUsername,
        password: config.proxyPassword,
    } : null;

    const createServices = (useProxy) => {
        const proxy = useProxy ? baseProxy : null;
        const b = new BrowserService(proxy, {
            useChrome: config.useChrome,
            chromePath: config.chromePath,
        });
        const oauthProxy = proxy ? {
            host: proxy.host,
            port: proxy.port,
            username: proxy.username,
            password: proxy.password,
        } : null;
        const o = new OAuthService({ proxy: oauthProxy });
        return { b, o };
    };

    let browserService = null;
    let oauthService = null;
    let tokenCompleted = false;

    const userData = {
        fullName: String(entry?.name || email.split('@')[0] || 'user').trim(),
        password: String(entry?.password || '').trim(),
        birthDate: String(entry?.birthDate || '1996-01-01').trim(),
        age: calcAgeFromBirthDate(entry?.birthDate),
    };

    const executeFlow = async () => {
        oauthService.regeneratePKCE();
        const authUrl = oauthService.getAuthUrl();
        console.log(`[Phase8] (${index}/${total}) OAuth URL: ${authUrl.substring(0, 100)}...`);
        await browserService.navigateToOAuth(authUrl);

        const callbackUrl = await browserService.oauthLoginAndAuthorize({
            loginMethod: 'email',
            preferEmailOtp: true,
            phone: String(entry?.phone || ''),
            email,
            password: userData.password,
            fullName: userData.fullName,
            age: userData.age,
            birthDate: userData.birthDate,
            redirectUri: oauthService.redirectUri,
            onEmailCodeNeeded: async () => {
                console.log(`[Phase8] (${index}/${total}) waiting latest code from ${email}...`);
                return await pollEmailCodeByAddress(mailProvider, email);
            },
            onSmsNeeded: async () => {
                throw new Error('Phase8 hit SMS verification, treated as failed');
            },
        });

        console.log(`[Phase8] (${index}/${total}) callback: ${callbackUrl}`);
        const params = oauthService.extractCallbackParams(callbackUrl);
        if (!params || params.error) {
            throw new Error(`OAuth failed: ${params?.error_description || params?.error || 'unknown'}`);
        }
        if (!params.code) {
            throw new Error('OAuth callback missing code');
        }

        const tokenData = await oauthService.exchangeTokenAndSave(params.code, email, {
            password: userData.password,
        });
        tokenCompleted = true;
        await mailProvider.markAuthenticated(email);
        console.log(`[Phase8] (${index}/${total}) token saved for ${tokenData.email}`);
        return tokenData;
    };

    try {
        const hasProxy = !!baseProxy;
        ({ b: browserService, o: oauthService } = createServices(hasProxy));
        await browserService.launch();

        try {
            return await executeFlow();
        } catch (error) {
            if (hasProxy && isProxyConnectionError(error)) {
                console.warn('[Phase8] proxy failed, retry this account without proxy...');
                await browserService.close().catch(() => {});
                ({ b: browserService, o: oauthService } = createServices(false));
                await browserService.launch();
                return await executeFlow();
            }
            throw error;
        }
    } catch (error) {
        const changed = tokenCompleted ? false : await mailProvider.markAbnormal(email);
        if (changed) console.warn(`[Phase8] (${index}/${total}) OMRMail 邮箱已标记异常: ${email}`);
        throw error;
    } finally {
        if (browserService) {
            await browserService.close().catch(() => {});
        }
    }
}

async function startPhase8() {
    console.log('[Start] Phase8 mode: iterate username.json and fetch token by email OTP');

    assertNotRunningWithXvfb();

    requireMailConfig('Phase8');

    const records = getUsernameRecords();
    if (records.length === 0) {
        console.log('[Phase8] username.json is empty');
        return;
    }

    let success = 0;
    let failed = 0;

    for (let i = 0; i < records.length; i++) {
        const entry = records[i];
        const idx = i + 1;
        console.log(`\\n[Phase8] ===== ${idx}/${records.length} =====`);
        console.log(`[Phase8] email: ${entry?.email || '(empty)'}`);

        try {
            await runPhase8ForEntry(entry, idx, records.length);
            success++;
        } catch (error) {
            failed++;
            console.error(`[Phase8] (${idx}/${records.length}) failed: ${error.message}`);
            appendFailedToErrorAccount(entry);
        }

        if (i < records.length - 1) {
            console.log(`[Phase8] wait ${PHASE8_ACCOUNT_DELAY_MS / 1000}s before next account...`);
            await new Promise(r => setTimeout(r, PHASE8_ACCOUNT_DELAY_MS));
        }
    }

    console.log(`\\n[Phase8] done: success=${success}, failed=${failed}, total=${records.length}`);
}

async function checkTokenCount() {
    if (!fs.existsSync(TOKEN_OUTPUT_DIR)) return 0;
    return fs.readdirSync(TOKEN_OUTPUT_DIR).filter(f => f.startsWith('codex-') && f.endsWith('-free.json')).length;
}

/**
 * 归档已有 tokens
 */
function archiveExistingTokens() {
    if (!fs.existsSync(TOKEN_OUTPUT_DIR)) return;
    const files = fs.readdirSync(TOKEN_OUTPUT_DIR).filter(f => f.startsWith('codex-') && f.endsWith('-free.json'));
    for (const file of files) {
        fs.renameSync(path.join(TOKEN_OUTPUT_DIR, file), path.join(TOKEN_OUTPUT_DIR, `old_${file}`));
        console.log(`[归档] ${file} → old_${file}`);
    }
}

/**
 * 启动批量注册
 */
async function startBatch() {
    console.log(`[启动] Codex 远程注册机（手机号 + Puppeteer 模式），目标: ${TARGET_COUNT}`);

    assertNotRunningWithXvfb();

    if (!config.heroSmsApiKey) {
        console.error('[错误] 未配置 heroSmsApiKey');
        process.exit(1);
    }
    try {
        requireMailConfig('Batch registration');
    } catch (error) {
        console.error(`[错误] ${error.message}`);
        process.exit(1);
    }

    archiveExistingTokens();

    while (true) {
        const currentCount = await checkTokenCount();
        if (currentCount >= TARGET_COUNT) {
            console.log(`\n[完成] Token 数量 (${currentCount}) 已达目标 (${TARGET_COUNT})。`);
            break;
        }

        console.log(`\n[进度] ${currentCount} / ${TARGET_COUNT}`);

        try {
            await runSingleRegistration();
        } catch (error) {
            console.error('[主程序] 注册失败，30 秒后重试...');
            await new Promise(r => setTimeout(r, 30000));
        }
    }
}

async function main() {
    // 启动时合并两个数据目录的文件
    mergeDataFiles();

    if (PHASE8_ONLY) {
        await startPhase8();
        return;
    }
    await startBatch();
}

main().catch(console.error);

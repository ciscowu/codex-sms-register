const BROWSER_LOCALE = 'zh-CN';
const BROWSER_LANGUAGES = ['zh-CN', 'zh', 'en-US', 'en'];
const BROWSER_ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en;q=0.8';
const BROWSER_TIMEZONE = 'Asia/Shanghai';

function getBrowserPreferenceScript() {
    return {
        locale: BROWSER_LOCALE,
        languages: BROWSER_LANGUAGES,
        timezone: BROWSER_TIMEZONE,
    };
}

module.exports = {
    BROWSER_ACCEPT_LANGUAGE,
    BROWSER_LANGUAGES,
    BROWSER_LOCALE,
    BROWSER_TIMEZONE,
    getBrowserPreferenceScript,
};

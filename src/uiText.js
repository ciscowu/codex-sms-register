const UI_TEXT = {
    signUpFree: ['免费注册', 'Sign up for free'],
    login: ['登录', 'Log in'],
    loginOrSignup: ['登录或注册', 'Log in or sign up'],
    phoneLogin: ['手机登录', 'Phone', 'Continue with phone'],
    emailLogin: ['电子邮件地址登录', '邮箱登录', 'Email address', 'Continue with email'],
};

function includesAnyText(text, variants) {
    const normalized = String(text || '').trim().toLowerCase();
    return variants.some((variant) => normalized.includes(String(variant).trim().toLowerCase()));
}

module.exports = {
    UI_TEXT,
    includesAnyText,
};

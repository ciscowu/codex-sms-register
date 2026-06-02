const { randomInt } = require('node:crypto');

const firstNames = [
    // --- 赛博朋克与科幻未来风格 ---
    'Vector', 'Cipher', 'Helix', 'Nova', 'Apex', 'Zenith', 'Orion', 'Ember', 'Proxy', 'Echo',
    'Glitch', 'Matrix', 'Voxel', 'Rune', 'Solas', 'Aero', 'Kaelen', 'Zephyr', 'Rift', 'Axiom',
    'Atlas', 'Titan', 'Cosmo', 'Vega', 'Siren', 'Nyx', 'Osiris', 'Krypton', 'Vesper', 'Astra',

    // --- 经典英伦与复古绅士/淑女风格 ---
    'Arthur', 'Benedict', 'Clarence', 'Dorian', 'Edmund', 'Fitzgerald', 'Gideon', 'Humphrey', 'Alistair', 'Julian',
    'Lawrence', 'Montgomery', 'Nathaniel', 'Percival', 'Quentin', 'Reginald', 'Sebastian', 'Tristan', 'Victor', 'Vincent',
    'Beatrice', 'Cordelia', 'Dorothea', 'Evelyn', 'Florence', 'Genevieve', 'Harriet', 'Iris', 'Josephine', 'Lillian',

    // --- 北欧与硬朗工业风格 ---
    'Bjorn', 'Gunnar', 'Ivar', 'Leif', 'Magnus', 'Ragnar', 'Sigurd', 'Thorin', 'Vance', 'Jax',
    'Gage', 'Flint', 'Steel', 'Blade', 'Barrett', 'Colt', 'Pierce', 'Sterling', 'Zane', 'Ryker',
    'Kira', 'Freya', 'Astrid', 'Ingrid', 'Sigrid', 'Hilda', 'Valkyrie', 'Sable', 'Raven', 'Onyx',

    // --- 极简现代与自然元素 ---
    'Ash', 'Cole', 'Finn', 'Kai', 'Leo', 'Max', 'Milo', 'Nico', 'Owen', 'Reid',
    'Silas', 'Jude', 'Ezra', 'Asher', 'Levi', 'Arlo', 'Bodhi', 'Cove', 'Dune', 'Sage',
    'Ivy', 'Fern', 'Hazel', 'Willow', 'Dawn', 'Sky', 'River', 'Rain', 'Storm', 'Winter',

    // --- 古典拉丁与神话色彩 ---
    'Augustus', 'Cyrus', 'Darius', 'Cassius', 'Lucius', 'Marcus', 'Rufus', 'Silvanus', 'Valerius', 'Tiberius',
    'Aurora', 'Diana', 'Flora', 'Luna', 'Minerva', 'Selene', 'Thalia', 'Vesta', 'Calliope', 'Athena',
    'Achilles', 'Hector', 'Ajax', 'Castor', 'Pollux', 'Jason', 'Theseus', 'Perseus', 'Orpheus', 'Evander',

    // --- 独特拼写与异域现代感 ---
    'Xander', 'Zarek', 'Malakai', 'Idris', 'Soren', 'Dante', 'Damian', 'Ronen', 'Zev', 'Kian',
    'Nesta', 'Lumi', 'Zuri', 'Ayla', 'Lyra', 'Nova', 'Talia', 'Zara', 'Sari', 'Mira',
    'Jaxon', 'Kyson', 'Zayd', 'Lennox', 'Knox', 'Dash', 'Cruz', 'Nash', 'Jett', 'Ace',

    // --- 欧式小众与现代沙龙风格 ---
    'Armand', 'Caspian', 'Dimitri', 'Elian', 'Fabian', 'Gaspard', 'Henri', 'Igor', 'Joris', 'Kristof',
    'Luc', 'Mateo', 'Nikolai', 'Olivier', 'Pascal', 'Remy', 'Stefan', 'Teo', 'Urban', 'Valentin',
    'Amelie', 'Chloe', 'Elise', 'Fleur', 'Ines', 'Leonore', 'Margot', 'Noemi', 'Odette', 'Sylvie'
];

const lastNames = [
    // --- 经典英伦与盎格鲁-撒克逊（沉稳、职业起源） ---
    'Blackwood', 'Hawthorne', 'Sterling', 'Kingsley', 'Pendleton', 'Gallowglass', 'Abernathy', 'Winslow', 'Davenport', 'Harrington',
    'Fairchild', 'Pemberton', 'Redmond', 'Stonemason', 'Bancroft', 'Garrison', 'Kendall', 'Lockwood', 'Sinclair', 'Thorne',
    'Vanguard', 'Ashcroft', 'Bradford', 'Cavendish', 'Ellington', 'Fitzroy', 'Giles', 'Hampton', 'Langley', 'Marlowe',

    // --- 德意志与中欧（工业、硬朗、严谨质感） ---
    'Eisenhauer', 'Freidhof', 'Brandt', 'Gottlieb', 'Hartmann', 'Klausner', 'Lindemann', 'Reiter', 'Schwarzhans', 'Vogel',
    'Winterhalter', 'Baumann', 'Drechsler', 'Fuchs', 'Gruber', 'Jaeger', 'Kohler', 'Lang', 'Preiss', 'Richter',
    'Schneider', 'Voss', 'Wagner', 'Ziegler', 'Zimmermann', 'Keller', 'Krause', 'Lehmann', 'Meier', 'Wolff',

    // --- 罗曼语族：法兰西、意大利、西班牙（优雅、古典文学感） ---
    'Beaumont', 'Devereaux', 'Fontaine', 'Marceau', 'Valois', 'Rousseau', 'Garnier', 'Lachapelle', 'Duval', 'Mercier',
    'D’Angelo', 'Moretti', 'Bianchi', 'Romano', 'Ricci', 'Venturi', 'Marchetti', 'Leone', 'Esposito', 'Gallo',
    'De Luca', 'Gaspari', 'Alba', 'Cortez', 'Navarro', 'Vega', 'Mendoza', 'Salazar', 'De la Cruz', 'Montes',

    // --- 斯拉夫与东欧（冷峻、史诗感） ---
    'Vasiliev', 'Volkov', 'Sokolov', 'Morozov', 'Petrov', 'Kuznetsov', 'Lebedev', 'Kozlov', 'Novikov', 'Morozov',
    'Kaminski', 'Kowalski', 'Zielinski', 'Szymanski', 'Wozniak', 'Jankowski', 'Marek', 'Horvat', 'Kovac', 'Barta',

    // --- 北欧（斯堪的纳维亚的自然与盾墙感） ---
    'Sorenson', 'Lindqvist', 'Nielsen', 'Hansen', 'Andersen', 'Erickson', 'Svensson', 'Larsson', 'Olsson', 'Persson',
    'Aaberg', 'Beck', 'Dahl', 'Hagen', 'Lund', 'Solberg', 'Strom', 'Thorvaldsen', 'Tiberg', 'Valen',

    // --- 凯尔特与盖尔（爱尔兰/苏格兰的荒野与古老感） ---
    'MacLean', 'Gallagher', 'O’Connor', 'Sullivan', 'Kennedy', 'MacKenzie', 'Boyd', 'Cunningham', 'Fraser', 'Graham',
    'MacLeod', 'O’Donnell', 'O’Neill', 'Ramsey', 'Wallace', 'Boyle', 'Callahan', 'Dougherty', 'McCarthy', 'O’Shea'
];

const uppers = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const lowers = 'abcdefghijklmnopqrstuvwxyz';
const digits = '0123456789';
const symbols = '!@#$';
const allChars = lowers + uppers + digits + symbols;

function pickRandom(list) {
    return list[randomInt(list.length)];
}

function generateRandomName() {
    return `${pickRandom(firstNames)} ${pickRandom(lastNames)}`;
}

function generateRandomPassword(length = 16) {
    let password = '';
    for (let i = 0; i < length; i++) {
        password += allChars[randomInt(allChars.length)];
    }

    let passwordArray = password.split('');

    // 只要没有大写、或没有数字、或没有符号，就一直循环修补
    while (true) {
        const currentStr = passwordArray.join('');
        const hasUpper = /[A-Z]/.test(currentStr);
        const hasDigit = /\d/.test(currentStr);
        const hasSymbol = /[!@#$]/.test(currentStr);

        // 全部满足则直接跳出
        if (hasUpper && hasDigit && hasSymbol) {
            break;
        }

        // 缺什么，就随机找个位置补什么（即使互相覆盖了，下一轮 while 也会补回来）
        if (!hasUpper) {
            passwordArray[randomInt(length)] = uppers[randomInt(uppers.length)];
        }
        if (!hasDigit) {
            passwordArray[randomInt(length)] = digits[randomInt(digits.length)];
        }
        if (!hasSymbol) {
            passwordArray[randomInt(length)] = symbols[randomInt(symbols.length)];
        }
    }
    return passwordArray.join('');
}

module.exports = {
    generateRandomName,
    generateRandomPassword,
};

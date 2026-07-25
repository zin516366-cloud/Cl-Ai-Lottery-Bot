const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const crypto = require('crypto');

// BOT CONFIGURATION
const BOT_TOKEN = "8688772916:AAFEvtoMo6KVwTCNotYonxqr5fRYhK5n1i0";
const CHANNEL_USERNAME = "@xearningfreehack";
const CHANNEL_LINK = "https://t.me/xearningfreehack";
const ADMIN_USER_ID = "8370471165";

// API ENDPOINTS - Only
const API_ENDPOINTS = {
    "CKLOTTERY": "https://ckygjf6r.com/api/webapi/" // endpoint only
};

// BET TYPES
const SIX_LOTTERY_BET_TYPES = {
    "BIG": 13,
    "SMALL": 14,
    "RED": 10,
    "GREEN": 11,
    "VIOLET": 12
};

// DATABASE SETUP
const DB_NAME = "CKLOTTERY_bot.db";

// GLOBAL STORAGE
const userSessions = {};
const issueCheckers = {};
const autoBettingTasks = {};
const waitingForResults = {};
const processedIssues = {};

// MYANMAR TIME FUNCTION
const getMyanmarTime = () => {
    const now = new Date();
    const myanmarOffset = 6.5 * 60 * 60 * 1000;
    const myanmarTime = new Date(now.getTime() + myanmarOffset);

    const year = myanmarTime.getUTCFullYear();
    const month = String(myanmarTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(myanmarTime.getUTCDate()).padStart(2, '0');
    const hours = String(myanmarTime.getUTCHours()).padStart(2, '0');
    const minutes = String(myanmarTime.getUTCMinutes()).padStart(2, '0');
    const seconds = String(myanmarTime.getUTCSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

class Database {
    constructor() {
        this.db = new sqlite3.Database(DB_NAME);
        this.initDatabase();
    }

    initDatabase() {
    const tables = [
        `CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            phone TEXT,
            password TEXT,
            platform TEXT DEFAULT 'CKLOTTERY',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS user_settings (
            user_id INTEGER PRIMARY KEY,
            bet_amount INTEGER DEFAULT 100,
            auto_login BOOLEAN DEFAULT 1,
            bet_sequence TEXT DEFAULT '100,300,700,1600,3200,7600,16000,32000',
            current_bet_index INTEGER DEFAULT 0,
            platform TEXT DEFAULT 'CKLOTTERY',
            auto_betting BOOLEAN DEFAULT 0,
            random_betting TEXT DEFAULT 'bot',
            profit_target INTEGER DEFAULT 0,
            loss_target INTEGER DEFAULT 0,
            game_type TEXT DEFAULT 'WINGO_1MIN',
            crease_mode TEXT DEFAULT 'none',
            follow_inverse BOOLEAN DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
            `CREATE TABLE IF NOT EXISTS allowed_game_ids (
                game_id TEXT PRIMARY KEY,
                added_by INTEGER,
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS bet_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                platform TEXT,
                issue TEXT,
                bet_type TEXT,
                amount INTEGER,
                result TEXT,
                profit_loss INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS pending_bets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                platform TEXT,
                issue TEXT,
                bet_type TEXT,
                amount INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS bot_sessions (
                user_id INTEGER PRIMARY KEY,
                is_running BOOLEAN DEFAULT 0,
                last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                total_bets INTEGER DEFAULT 0,
                total_profit INTEGER DEFAULT 0,
                session_profit INTEGER DEFAULT 0,
                session_loss INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS formula_patterns (
                user_id INTEGER PRIMARY KEY,
                bs_pattern TEXT DEFAULT '',
                colour_pattern TEXT DEFAULT '',
                bs_current_index INTEGER DEFAULT 0,
                colour_current_index INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        tables.forEach(table => {
        this.db.run(table, (err) => {
            if (err) {
                console.error('Error creating table:', err);
            }
        });
    });

    // Existing table ကို check လုပ်ပြီး missing column ကို ထည့်သွင်းပါ
    this.addMissingColumns();
}

addMissingColumns() {
    const columnsToAdd = [
        { table: 'user_settings', column: 'crease_mode', type: 'TEXT DEFAULT "none"' },
        { table: 'user_settings', column: 'follow_inverse', type: 'BOOLEAN DEFAULT 0' }
    ];

    columnsToAdd.forEach((col) => {
        try {
            const checkSql = `PRAGMA table_info(${col.table})`;
            this.db.all(checkSql, (err, rows) => {
                if (err) {
                    console.error(`Error checking columns for ${col.table}:`, err);
                    return;
                }
                
                const columns = rows.map(row => row.name);
                // ✅ ဒီမှာ column ရှိပြီးသားလား စစ်ပါ
                if (!columns.includes(col.column)) {
                    const alterSql = `ALTER TABLE ${col.table} ADD COLUMN ${col.column} ${col.type}`;
                    this.db.run(alterSql, (alterErr) => {
                        if (alterErr) {
                            // ❌ duplicate column error ကို ignore လုပ်ပါ
                            if (alterErr.message && alterErr.message.includes('duplicate column name')) {
                                console.log(`Column ${col.column} already exists in ${col.table}, skipping...`);
                            } else {
                                console.error(`Error adding column ${col.column} to ${col.table}:`, alterErr);
                            }
                        } else {
                            console.log(`✅ Added column ${col.column} to ${col.table}`);
                        }
                    });
                } else {
                    console.log(`✅ Column ${col.column} already exists in ${col.table}, skipping...`);
                }
            });
        } catch (error) {
            console.error(`Error checking/adding column ${col.column} to ${col.table}:`, error);
        }
    });
}

run(sql, params = []) {
    return new Promise((resolve, reject) => {
        this.db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ id: this.lastID, changes: this.changes });
        });
    });
}

get(sql, params = []) {
    return new Promise((resolve, reject) => {
        this.db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

all(sql, params = []) {
    return new Promise((resolve, reject) => {
        this.db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}
}

class LotteryAPI {
    constructor(platform = 'CKLOTTERY', gameType = 'WINGO') {
        this.platform = platform;
        this.gameType = gameType;
        this.baseUrl = API_ENDPOINTS[platform];
        this.token = '';
        this.headers = {
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json;charset=UTF-8",
            "Origin": this.getOrigin(),
            "Referer": this.getReferer(),
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7.5 Mobile/15E148 Safari/604.1"
        };
    }

    getOrigin() {
        return "https://cklottery.cc";
    }

        getReferer() {
            return "https://cklottery.cc/";
    }

    signMd5(data) {
        const signData = { ...data };
        delete signData.signature;
        delete signData.timestamp;

        const sortedKeys = Object.keys(signData).sort();
        const sortedData = {};
        sortedKeys.forEach(key => {
            sortedData[key] = signData[key];
        });

        const hashString = JSON.stringify(sortedData).replace(/\s/g, '');
        return crypto.createHash('md5').update(hashString).digest('hex').toUpperCase();
    }

    randomKey() {
        const xxxx = "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx";
        let result = "";

        for (let char of xxxx) {
            if (char === 'x') {
                result += '0123456789abcdef'[Math.floor(Math.random() * 16)];
            } else if (char === 'y') {
                result += '89a'[Math.floor(Math.random() * 3)];
            } else {
                result += char;
            }
        }
        return result;
    }

async login(phone, password) {
    try {
        let formattedPhone = phone;

        // အတွက် login format
        if (!phone.startsWith('95')) {
            formattedPhone = '95' + phone;
        }

        formattedPhone = formattedPhone.replace(/\D/g, '');

        const body = {
            "phonetype": -1,
            "language": 0,
            "logintype": "mobile",
            "random": "9078efc98754430e92e51da59eb2563c",
            "username": formattedPhone,
            "pwd": password,
            "timestamp": Math.floor(Date.now() / 1000)
        };

        body.signature = this.signMd5(body);

        // DEBUG: Request body ကို log ထုတ်ကြည့်ပါ
        console.log(' Login Request Body:', JSON.stringify(body, null, 2));

        const response = await axios.post(`${this.baseUrl}Login`, body, {
            headers: this.headers,
            timeout: 30000
        });

        // DEBUG: Response ကို log ထုတ်ကြည့်ပါ
        console.log(' Login Response:', JSON.stringify(response.data, null, 2));

        if (response.status === 200) {
            const result = response.data;
            if (result.msgCode === 0 || result.code === 0 || result.success === true) { // ✅ ဒီမှာ ပြင်ပါ
                const tokenData = result.data || {};
                this.token = `${tokenData.tokenHeader || ''}${tokenData.token || ''}`; // ✅ template literal ပြင်ပါ
                this.headers.Authorization = this.token;
                return { success: true, message: " Login successful", token: this.token };
            } else {
                return { 
                    success: false, 
                    message: result.msg || result.message || " Login failed", // ✅ ဒီမှာလည်း ပြင်ပါ
                    token: "" 
                };
            }
        } else {
            return { 
                success: false, 
                message: ` API connection failed: ${response.status}`, // ✅ template literal ပြင်ပါ
                token: "" 
            };
        }
    } catch (error) {
        console.error(' Login error details:', error);
        return { 
            success: false, 
            message: ` Login error: ${error.message}`, // ✅ template literal ပြင်ပါ
            token: "" 
        };
    }
}

    async getUserInfo() {
        try {
            const body = {
                "language": 0,
                "random": "9078efc98754430e92e51da59eb2563c",
                "timestamp": Math.floor(Date.now() / 1000)
            };
            body.signature = this.signMd5(body);

            const response = await axios.post(`${this.baseUrl}GetUserInfo`, body, {
                headers: this.headers,
                timeout: 10000
            });

            if (response.status === 200) {
                const result = response.data;
                if (result.msgCode === 0 || result.code === 0) {
                    return result.data || {};
                }
            }
            return {};
        } catch (error) {
            console.error('Error getting user info from :', error.message);
            return {};
        }
    }

    async getBalance() {
        try {
            const body = {
                "language": 0,
                "random": "9078efc98754430e92e51da59eb2563c",
                "timestamp": Math.floor(Date.now() / 1000)
            };
            body.signature = this.signMd5(body);

            const response = await axios.post(`${this.baseUrl}GetBalance`, body, {
                headers: this.headers,
                timeout: 10000
            });

            if (response.status === 200) {
                const result = response.data;
                if (result.msgCode === 0 || result.code === 0) {
                    return result.data?.amount || 0;
                }
            }
            return 0;
        } catch (error) {
            console.error('Error getting balance from :', error.message);
            return 0;
        }
    }

    async getCurrentIssue() {
    try {
        let typeId;
        let endpoint;

        if (this.gameType === 'TRX_1MIN') {
            typeId = 13;
            endpoint = 'GetTrxGameIssue';
        } else if (this.gameType === 'WINGO_30S') {
    typeId = 30;
    endpoint = 'GetGameIssue';
        } else if (this.gameType === 'WINGO_1MIN') {
            typeId = 1;
            endpoint = 'GetGameIssue';
        } else {
            typeId = 1;
            endpoint = 'GetGameIssue';
        }

            const body = {
                "typeId": typeId,
                "language": 0,
                "random": "b05034ba4a2642009350ee863f29e2e9",
                "timestamp": Math.floor(Date.now() / 1000)
            };
            body.signature = this.signMd5(body);

            console.log(`GETTING CURRENT ISSUE FOR - ${this.gameType}, TYPEID: ${typeId}`);

            const response = await axios.post(`${this.baseUrl}${endpoint}`, body, {
                headers: this.headers,
                timeout: 10000
            });

            console.log(` ISSUE RESPONSE FOR ${this.gameType}:`, JSON.stringify(response.data));

            if (response.status === 200) {
                const result = response.data;

                if (result.msgCode === 0 || result.code === 0) {
                    let issueNumber = '';

                    // TRX GAMES
                    if (this.gameType === 'TRX' || this.gameType === 'TRX_3MIN' || 
                        this.gameType === 'TRX_5MIN' || this.gameType === 'TRX_10MIN') {
                        issueNumber = result.data?.predraw?.issueNumber || 
                                     result.data?.issueNumber || 
                                     result.issueNumber || '';
                    } 
                    // WINGO 30S GAME
                    else if (this.gameType === 'WINGO_30S') {
                        if (result.data) {
                            issueNumber = result.data.issueNumber || 
                                         result.data.predraw?.issueNumber || 
                                         result.data.current?.issueNumber || '';

                            if (!issueNumber) {
                                if (result.data.currentIssue) {
                                    issueNumber = result.data.currentIssue;
                                } else if (result.data.issue) {
                                    issueNumber = result.data.issue;
                                }
                            }
                        }

                        if (!issueNumber) {
                            issueNumber = result.issueNumber || result.issue || '';
                        }
                    }
                    // OTHER WINGO GAMES
                    else {
                        issueNumber = result.data?.issueNumber || 
                                     result.data?.predraw?.issueNumber || 
                                     result.issueNumber || 
                                     result.data?.current?.issueNumber || '';

                        if (!issueNumber && result.data) {
                            const dataStr = JSON.stringify(result.data);
                            const issueMatch = dataStr.match(/"issueNumber"\s*:\s*"(\d+)"/);
                            if (issueMatch) {
                                issueNumber = issueMatch[1];
                            }
                        }
                    }

                    console.log(` CURRENT ISSUE FOR ${this.gameType}: ${issueNumber}`);
                    return issueNumber;
                } else {
                    console.log(` ERROR GETTING ISSUE FOR ${this.gameType}:`, result.msg);
                    return "";
                }
            } else {
                console.log(` HTTP ERROR FOR ${this.gameType}:`, response.status);
                return "";
            }
        } catch (error) {
            console.error(` ERROR GETTING CURRENT ISSUE FOR ${this.gameType}:`, error.message);

            if (error.response) {
                console.error(' Error response data:', error.response.data);
                console.error(' Error response status:', error.response.status);
                console.error(' Error response headers:', error.response.headers);
            } else if (error.request) {
                console.error(' No response received:', error.request);
            } else {
                console.error(' Error setting up request:', error.message);
            }

            return "";
        }
    }

    async placeBet(amount, betType) {
    try {
        console.log(` - ATTEMPTING TO PLACE BET - GAME: ${this.gameType}, AMOUNT: ${amount}, BETTYPE: ${betType}`);

        // TRX နဲ့ WINGO နှစ်ခုလုံးအတွက် minimum 100
        if (amount < 100) {
            console.log(` Minimum amount is 100, adjusting from ${amount} to 100`);
            amount = 100;
        }

        let issueId = "";
        let retryCount = 0;
        const maxRetries = 3;

        while (!issueId && retryCount < maxRetries) {
            issueId = await this.getCurrentIssue();
            if (!issueId) {
                console.log(` Failed to get issue (attempt ${retryCount + 1}/${maxRetries})`);
                retryCount++;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        if (!issueId) {
            console.log(` FAILED TO GET ISSUE AFTER ${maxRetries} ATTEMPTS`);
            return { 
                success: false, 
                message: "Failed to get current issue after multiple attempts. Please check your game type and try again.", 
                issueId: "", 
                potentialProfit: 0 
            };
        }

        console.log(` SUCCESSFULLY GOT ISSUE: ${issueId} FOR ${this.gameType}`);
        console.log(` PLACING BET - ISSUE: ${issueId}, AMOUNT: ${amount}, BETTYPE: ${betType}, GAMETYPE: ${this.gameType}`);

        let requestBody;
        let baseAmount, betCount;
        let endpoint;

        // TRX 1 MIN အတွက် သီးခြား endpoint နဲ့ parameters
// TRX 1 MIN အတွက် သီးခြား endpoint နဲ့ parameters
if (this.gameType === 'TRX_1MIN') {
    // TRX အတွက် base amount 100 သတ်မှတ်
    baseAmount = 100;
    betCount = Math.floor(amount / baseAmount);

    if (amount < 100) {
        amount = 100;
        betCount = 1;
    }

    const actualAmount = baseAmount * betCount;
    if (actualAmount !== amount) {
        console.log(` TRX Platform amount adjusted: ${amount} -> ${actualAmount}`);
        amount = actualAmount;
    }

    // TRX 1 MIN အတွက် bet type mapping
    let selectType;
    let gameTypeForTrx;
    
    // BET TYPE MAPPING FOR TRX 1 MIN
    if (betType === 13) { // BIG
        selectType = 13;
        gameTypeForTrx = 2;  // BIG/SMALL game type
        console.log(` TRX Bet - BIG (selectType: 13, gameType: 2)`);
    } else if (betType === 14) { // SMALL
        selectType = 14;
        gameTypeForTrx = 2;  // BIG/SMALL game type
        console.log(` TRX Bet - SMALL (selectType: 14, gameType: 2)`);
    } else if (betType === 10) { // RED
        selectType = 10;
        gameTypeForTrx = 0;  // Colour game type
        console.log(` TRX Bet - RED (selectType: 10, gameType: 0)`);
    } else if (betType === 11) { // GREEN
        selectType = 11;
        gameTypeForTrx = 0;  // Colour game type
        console.log(` TRX Bet - GREEN (selectType: 11, gameType: 0)`);
    } else if (betType === 12) { // VIOLET
        selectType = 12;
        gameTypeForTrx = 0;  // Colour game type
        console.log(` TRX Bet - VIOLET (selectType: 12, gameType: 0)`);
    } else {
        // Fallback to random BIG/SMALL if unknown bet type
        console.log(` Unknown bet type ${betType}, defaulting to BIG`);
        selectType = 13;
        gameTypeForTrx = 2;
    }

    requestBody = {
        "typeId": 13,
        "issuenumber": issueId,
        "language": 0,
        "gameType": gameTypeForTrx,  // 0 for colour, 2 for BIG/SMALL
        "amount": baseAmount,
        "betCount": betCount,
        "selectType": selectType,
        "random": this.randomKey(),
        "timestamp": Math.floor(Date.now() / 1000)
    };

    // TRX 1 MIN အတွက် endpoint
    endpoint = 'GameTRXBetting';

            
        } else {
            // WINGO games အတွက်
            if (amount < 1000) {
                baseAmount = 100;
            } else if (amount < 10000) {
                baseAmount = 100;
            } else {
                baseAmount = 1000;
            }

            betCount = Math.floor(amount / baseAmount);

            if (amount < baseAmount) {
                if (amount < 100) {
                    baseAmount = 100;
                    betCount = 1;
                    amount = 100;
                }
            }

            const actualAmount = baseAmount * betCount;
            if (actualAmount !== amount) {
                console.log(` WINGO Platform amount adjusted: ${amount} -> ${actualAmount}`);
                amount = actualAmount;
            }

            const isColourBet = [10, 11, 12].includes(betType);
            let typeId, gameType;

            if (this.gameType === 'WINGO_30S') {
    typeId = 30;
    gameType = isColourBet ? 0 : 2;

            } else {
                typeId = 1;
                gameType = isColourBet ? 0 : 2;
            }

            requestBody = {
                "typeId": typeId,
                "issuenumber": issueId,
                "language": 0,
                "gameType": gameType,
                "amount": baseAmount,
                "betCount": betCount,
                "selectType": betType,
                "random": this.randomKey(),
                "timestamp": Math.floor(Date.now() / 1000)
            };

            endpoint = 'GameBetting';
        }

        console.log(' REQUEST BODY:', JSON.stringify(requestBody, null, 2));
        console.log(` CALLING ENDPOINT: ${this.baseUrl}${endpoint}`);

        requestBody.signature = this.signMd5(requestBody);

        const response = await axios.post(`${this.baseUrl}${endpoint}`, requestBody, {
            headers: this.headers,
            timeout: 15000
        });

        console.log(' API RESPONSE:', JSON.stringify(response.data, null, 2));

        if (response.status === 200) {
            const result = response.data;

            if (result.code === 0 || result.msgCode === 0 || result.success === true) {
                let potentialProfit;

                if (betType === 13 || betType === 14) { // BIG/SMALL
                    const contractAmount = Math.floor(amount * 0.98);
                    potentialProfit = contractAmount * 2;
                } else if (betType === 10) { // RED
                    const contractAmount = Math.floor(amount * 0.98);
                    potentialProfit = contractAmount * 2;
                } else if (betType === 11) { // GREEN
                    const contractAmount = Math.floor(amount * 0.98);
                    potentialProfit = contractAmount * 2;
                } else if (betType === 12) { // VIOLET
                    const contractAmount = Math.floor(amount * 0.98);
                    potentialProfit = contractAmount * 2;
                } else {
                    potentialProfit = 0;
                }

                console.log(` BET SUCCESS - Potential Profit: ${potentialProfit}, Contract Amount: ${Math.floor(amount * 0.98)}`);

                return { 
                    success: true, 
                    message: " Bet placed successfully", 
                    issueId, 
                    potentialProfit, 
                    actualAmount: amount,
                    contractAmount: Math.floor(amount * 0.98)
                };
            } else {
                const errorMsg = result.msg || result.message || result.error || ' Bet failed';
                console.log(' BET API ERROR:', errorMsg);

                if (errorMsg.includes('余额') || errorMsg.includes('不足') || errorMsg.includes('amount')) {
                    return { 
                        success: false, 
                        message: "Insufficient balance or amount error", 
                        issueId, 
                        potentialProfit: 0 
                    };
                } else if (errorMsg.includes('期号') || errorMsg.includes('issue')) {
                    return { 
                        success: false, 
                        message: "Issue has already closed", 
                        issueId, 
                        potentialProfit: 0 
                    };
                } else if (errorMsg.includes('Game is being maintained')) {
                    return { 
                        success: false, 
                        message: "Game is being maintained. Please try again in a few moments.", 
                        issueId, 
                        potentialProfit: 0 
                    };
                }

                return { 
                    success: false, 
                    message: errorMsg, 
                    issueId, 
                    potentialProfit: 0 
                };
            }
        } else {
            console.log(' HTTP ERROR:', response.status, response.statusText);
            return { 
                success: false, 
                message: ` API connection failed: ${response.status}`, 
                issueId, 
                potentialProfit: 0 
            };
        }
    } catch (error) {
        console.log(' BETTING ERROR:', error.message);

        if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            return { 
                success: false, 
                message: " Connection timeout or server error. Please try again.", 
                issueId: "", 
                potentialProfit: 0 
            };
        } else if (error.response) {
            console.log(' Error response data:', error.response.data);
            return { 
                success: false, 
                message: ` API error: ${error.response.status}`, 
                issueId: "", 
                potentialProfit: 0 
            };
        } else {
            return { 
                success: false, 
                message: ` Betting error: ${error.message}`, 
                issueId: "", 
                potentialProfit: 0 
            };
        }
    }
}

    async getRecentResults(count = 10) {
    try {
        if (this.gameType === 'TRX_1MIN') {
            let typeId = 13; // TRX 1 MIN typeId

            const body = {
                "typeId": typeId,
                "language": 0,
                "random": "b05034ba4a2642009350ee863f29e2e9",
                "timestamp": Math.floor(Date.now() / 1000)
            };
            body.signature = this.signMd5(body);

            // TRX 1 MIN အတွက် GetTRXNoaverageEmerdList endpoint ကိုသုံးမယ်
            const response = await axios.post(`${this.baseUrl}GetTRXNoaverageEmerdList`, body, {
                headers: this.headers,
                timeout: 10000
            });

            if (response.status === 200) {
                const result = response.data;
                console.log(' TRX 1 MIN Results Response:', JSON.stringify(result, null, 2));
                
                if (result.msgCode === 0 || result.code === 0) {
                    let gamesList = [];
                    
                    // API response structure ကို စစ်ဆေးပါ
                    // သင်ပေးထားတဲ့ data structure အတိုင်း
                    if (result.data?.data?.gamesList) {
                        gamesList = result.data.data.gamesList;
                    } else if (result.data?.data?.gameslist) {
                        gamesList = result.data.data.gameslist;
                    } else if (result.data?.gamesList) {
                        gamesList = result.data.gamesList;
                    } else if (result.data?.gameslist) {
                        gamesList = result.data.gameslist;
                    } else if (result.data?.date?.gamesList) {
                        gamesList = result.data.date.gamesList;
                    } else if (result.data?.date?.gameslist) {
                        gamesList = result.data.date.gameslist;
                    }
                    
                    if (gamesList && gamesList.length > 0) {
                        const results = [];
                        // Limit to requested count
                        const limitedGames = gamesList.slice(0, count);
                        
                        for (const game of limitedGames) {
                            const number = String(game.number || '');
                            let colour = game.colour || '';
                            colour = colour.toUpperCase();
                            
                            // Standardize colour names
                            if (colour === 'GREEN') colour = 'GREEN';
                            else if (colour === 'RED') colour = 'RED';
                            else if (colour === 'VIOLET') colour = 'VIOLET';
                            else {
                                // Fallback to number-based colour detection
                                if (['0', '5'].includes(number)) colour = 'VIOLET';
                                else if (['1', '3', '7', '9'].includes(number)) colour = 'GREEN';
                                else if (['2', '4', '6', '8'].includes(number)) colour = 'RED';
                                else colour = 'UNKNOWN';
                            }
                            
                            results.push({
                                issueNumber: game.issueNumber,
                                number: number,
                                colour: colour
                            });
                        }
                        console.log(` Retrieved ${results.length} TRX results from GetTRXNoaverageEmerdList`);
                        return results;
                    }
                    
                    // Fallback to single settled result
                    let settled = result.data?.settled || result.data?.data?.settled;
                    if (settled) {
                        const number = String(settled.number || '');
                        let colour = settled.colour || '';
                        colour = colour.toUpperCase();
                        
                        if (colour === 'GREEN') colour = 'GREEN';
                        else if (colour === 'RED') colour = 'RED';
                        else if (colour === 'VIOLET') colour = 'VIOLET';
                        else {
                            if (['0', '5'].includes(number)) colour = 'VIOLET';
                            else if (['1', '3', '7', '9'].includes(number)) colour = 'GREEN';
                            else if (['2', '4', '6', '8'].includes(number)) colour = 'RED';
                            else colour = 'UNKNOWN';
                        }

                        return [{
                            issueNumber: settled.issueNumber,
                            number: number,
                            colour: colour
                        }];
                    }
                }
            }
            return [];
        } else if (this.gameType === 'WINGO_30S' || this.gameType === 'WINGO_1MIN') {
            let typeId;
            if (this.gameType === 'WINGO_30S') {
                typeId = 30;
            } else {
                typeId = 1;
            }

            const body = {
                "pageNo": 1,
                "pageSize": count,
                "language": 0,
                "typeId": typeId,
                "random": "6DEB0766860C42151A193692ED16D65A",
                "timestamp": Math.floor(Date.now() / 1000)
            };
            body.signature = this.signMd5(body);

            const response = await axios.post(`${this.baseUrl}GetNoaverageEmerdList`, body, {
                headers: this.headers,
                timeout: 10000
            });

            if (response.status === 200) {
                const result = response.data;
                if (result.msgCode === 0 || result.code === 0) {
                    const dataStr = JSON.stringify(response.data);
                    const startIdx = dataStr.indexOf('[');
                    const endIdx = dataStr.indexOf(']') + 1;

                    if (startIdx !== -1 && endIdx !== -1) {
                        const resultsJson = dataStr.substring(startIdx, endIdx);
                        const results = JSON.parse(resultsJson);

                        results.forEach(resultItem => {
                            const number = String(resultItem.number || '');
                            if (['0', '5'].includes(number)) {
                                resultItem.colour = 'VIOLET';
                            } else if (['1', '3', '7', '9'].includes(number)) {
                                resultItem.colour = 'GREEN';
                            } else if (['2', '4', '6', '8'].includes(number)) {
                                resultItem.colour = 'RED';
                            } else {
                                resultItem.colour = 'UNKNOWN';
                            }
                        });

                        return results;
                    }
                }
            }
            return [];
        }
        return [];
    } catch (error) {
        console.error(' Error getting recent results:', error.message);
        return [];
    }
}
}

class AutoLotteryBot {
    constructor() {
        this.bot = new TelegramBot(BOT_TOKEN, { polling: true });
        this.db = new Database();
        this.setupHandlers();
        console.log(" Auto Bot initialized successfully!");
    }
    
    // Helper function to mask phone number: 09796572086 -> 097******86
maskPhoneNumber(phone) {
    if (!phone) return 'N/A';
    
    // Remove any non-digit characters
    const cleanPhone = phone.replace(/\D/g, '');
    
    if (cleanPhone.length < 6) return phone;
    
    // Keep first 3 and last 2 digits
    const firstThree = cleanPhone.substring(0, 3);
    const lastTwo = cleanPhone.substring(cleanPhone.length - 2);
    
    // Create mask with asterisks for the middle part
    const middleLength = cleanPhone.length - 5; // Total minus first 3 and last 2
    const mask = '*'.repeat(middleLength);
    
    return `${firstThree}${mask}${lastTwo}`;
}

    setupHandlers() {
        this.bot.onText(/\/start/, (msg) => this.handleStart(msg));
        this.bot.onText(/\/aid (.+)/, (msg, match) => this.handleAddGameId(msg, match));
        this.bot.onText(/\/rid (.+)/, (msg, match) => this.handleRemoveGameId(msg, match));
        this.bot.onText(/\/ids/, (msg) => this.handleListGameIds(msg));
        this.bot.onText(/\/gats/, (msg) => this.handleGameIdStats(msg));
        this.bot.onText(/\/broadcast (.+)/, (msg, match) => this.handleBroadcastMessage(msg, match));
        this.bot.onText(/\/msg (.+)/, (msg, match) => this.handleBroadcastActive(msg, match));

        this.bot.on('callback_query', (query) => this.handleCallbackQuery(query));

        this.bot.on('message', (msg) => {
            if (msg.text && !msg.text.startsWith('/')) {
                this.handleMessage(msg);
            }
        });

        this.bot.on('polling_error', (error) => {
            console.error(' Bot Polling error:', error);
        });
    }

    ensureUserSession(userId) {
        if (!userSessions[userId]) {
            userSessions[userId] = {
                step: 'main',
                phone: '',
                password: '',
                platform: 'CKLOTTERY',
                gameType: 'WINGO_30S',
                loggedIn: false,
                apiInstance: null
            };
        }
        return userSessions[userId];
    }

    getMainKeyboard(userId = null) {
    return {
        keyboard: [
            [{ text: "Login" }],
            [{ text: "Balance" }, { text: "Results" }],
            [{ text: "Bet BIG" }, { text: "Bet SMALL" }],
            [{ text: "Bet RED" }, { text: "Bet GREEN" }, { text: "Bet VIOLET" }],
            [{ text: "Bot Settings" }, { text: "My Bets" }],
            [{ text: "Bot Info" }, { text: "Game Type" }],
            [{ text: "Crease Mode" }],  // Follow Inverse ဖယ်ထား
            [{ text: "Run Bot" }, { text: "Stop Bot" }]
        ],
        resize_keyboard: true
    };
}

// Crease Mode Keyboard ကို ဖန်တီးပါ
getCreaseModeKeyboard() {
    return {
        keyboard: [
            [{ text: "Loss Crease" }, { text: "Win Crease" }],
            [{ text: "Main Menu" }]
        ],
        resize_keyboard: true
    };
}

// Follow Inverse Keyboard ကို ဖန်တီးပါ
getFollowInverseKeyboard() {
    return {
        keyboard: [
            [{ text: "Enable Inverse" }, { text: "Disable Inverse" }],
            [{ text: "Main Menu" }]
        ],
        resize_keyboard: true
    };
}

    getBotSettingsKeyboard() {
        return {
            keyboard: [
                [{ text: "Random BIG" }, { text: "Random SMALL" }],
                [{ text: "Random Bot" }, { text: "Follow Bot" }],
                [{ text: "Follow Inverse" }],
                [{ text: "Set Bet Sequence" }],
                [{ text: "BS Formula" }, { text: "Colour Formula" }],
                [{ text: "Profit Target" }, { text: "Loss Target" }],
                [{ text: "Main Menu" }]
            ],
            resize_keyboard: true
        };
    }

    getLoginKeyboard() {
        return {
            keyboard: [
                [{ text: "Enter Phone" }, { text: "Enter Password" }],
                [{ text: "Login Now" },  { text: "Back" }]
            ],
            resize_keyboard: true
        };
    }

    getGameTypeKeyboard() {
    return {
        keyboard: [
            [{ text: "WINGO 30S" }],
            [{ text: "WINGO 1 MIN" }],
            [{ text: "TRX 1 MIN" }],
            [{ text: "Back" }]
        ],
        resize_keyboard: true
    };
}

    getBsPatternKeyboard() {
        return {
            keyboard: [
                [{ text: "Set BS Pattern" }, { text: "View BS Pattern" }],
                [{ text: "Clear BS Pattern" }, { text: "Bot Settings" }]
            ],
            resize_keyboard: true
        };
    }

    getColourPatternKeyboard() {
        return {
            keyboard: [
                [{ text: "Set Colour Pattern" }, { text: "View Colour Pattern" }],
                [{ text: "Clear Colour Pattern" }, { text: "Bot Settings" }]
            ],
            resize_keyboard: true
        };
    }

    async getColourFormulaBetType(userId) {
        try {
            const patternsData = await this.getFormulaPatterns(userId);
            const colourPattern = patternsData.colour_pattern;
            let currentIndex = patternsData.colour_current_index;

            if (!colourPattern) {
                const betType = Math.random() < 0.5 ? 13 : 14;
                return { 
                    betType, 
                    betTypeStr: betType === 13 ? "BIG (Random Fallback)" : "SMALL (Random Fallback)" 
                };
            }

            const patternArray = colourPattern.split(',');

            if (currentIndex >= patternArray.length) {
                currentIndex = 0;
            }

            const currentBet = patternArray[currentIndex];

            let betType;
            let betTypeStr;

            switch(currentBet) {
                case 'G':
                    betType = 11;
                    betTypeStr = "GREEN";
                    break;
                case 'R':
                    betType = 10;
                    betTypeStr = "RED";
                    break;
                case 'V':
                    betType = 12;
                    betTypeStr = "VIOLET";
                    break;
                default:
                    betType = Math.random() < 0.5 ? 13 : 14;
                    betTypeStr = betType === 13 ? "BIG" : "SMALL";
            }

            const fullBetTypeStr = `${betTypeStr} (Colour Formula ${currentIndex + 1}/${patternArray.length})`;

            const newIndex = currentIndex + 1;
            await this.updateColourPatternIndex(userId, newIndex);

            return { betType, betTypeStr: fullBetTypeStr };

        } catch (error) {
            console.error(`Error getting Colour formula bet type for user ${userId}:`, error);
            const betType = Math.random() < 0.5 ? 13 : 14;
            return { betType, betTypeStr: betType === 13 ? "BIG" : "SMALL" };
        }
    }

    async updateColourPatternIndex(userId, newIndex) {
        try {
            await this.db.run(
                'UPDATE formula_patterns SET colour_current_index = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                [newIndex, userId]
            );
            return true;
        } catch (error) {
            console.error(`Error updating Colour pattern index for user ${userId}:`, error);
            return false;
        }
    }
    
    async showCreaseModeMenu(chatId, userId) {
    try {
        const creaseMode = await this.getUserSetting(userId, 'crease_mode', 'none');
        let statusText = "";
        
        if (creaseMode === 'loss') {
            statusText = "Loss Crease";
        } else if (creaseMode === 'win') {
            statusText = " Win Crease";
        } else {
            statusText = "⚪ Crease Mode Not Set";
        }
        
        const menuText = `Choose Select Crease:`;
        
        await this.bot.sendMessage(chatId, menuText, {
            reply_markup: this.getCreaseModeKeyboard()
        });
    } catch (error) {
        console.error(` Error showing crease mode menu for user ${userId}:`, error);
        await this.bot.sendMessage(chatId, "Error loading crease mode menu. Please try again.");
    }
}

// Show Follow Inverse Menu
async showFollowInverseMenu(chatId, userId) {
    try {
        const followInverse = await this.getUserSetting(userId, 'follow_inverse', 0);
        let statusText = followInverse ? "✅ Enabled" : "❌ Disabled";
        
        const menuText = `Follow Inverse Mode: ${statusText}`;
        
        await this.bot.sendMessage(chatId, menuText, {
            reply_markup: this.getFollowInverseKeyboard()
        });
    } catch (error) {
        console.error(` Error showing follow inverse menu for user ${userId}:`, error);
        await this.bot.sendMessage(chatId, "Error loading follow inverse settings. Please try again.");
    }
}

// Set Follow Inverse Mode
// Replace the setFollowInverse function (around line 1197) with this:

async setFollowInverse(chatId, userId, enabled) {
    try {
        await this.saveUserSetting(userId, 'follow_inverse', enabled ? 1 : 0);
        
        if (enabled) {
            await this.clearFormulaPatterns(userId);
        }
        
        const statusText = enabled ? "✅ Enabled" : "❌ Disabled";
        
        // Bot Settings ထဲမှာပဲ ရှိနေအောင် - Main Menu မသွားဘူး
        const message = `Follow Inverse Mode: ${statusText}\n\n${enabled ? 
            'Bot will bet the opposite of the last result' : 
            'Follow Inverse is disabled'}`;
        
        // Main Menu မပြဘဲ သတင်းစကားပဲပြမယ်
        await this.bot.sendMessage(chatId, message);
        
        console.log(` Follow inverse mode set to ${enabled} for user ${userId}`);
        
    } catch (error) {
        console.error(` Error setting follow inverse mode for user ${userId}:`, error);
        await this.bot.sendMessage(chatId, "Error setting follow inverse mode. Please try again.");
        await this.showBotSettings(chatId, userId);
    }
}

// Get Follow Inverse Bet Type
async getFollowInverseBetType(apiInstance) {
    try {
        const results = await apiInstance.getRecentResults(1);
        if (!results || results.length === 0) {
            const betType = Math.random() < 0.5 ? 13 : 14;
            return { betType, betTypeStr: betType === 13 ? "BIG (Random Fallback)" : "SMALL (Random Fallback)" };
        }

        const lastResult = results[0];
        const number = lastResult.number || '';
        let lastResultType = '';
        
        // Determine last result type
        if (['0','1','2','3','4'].includes(number)) {
            lastResultType = "SMALL";
        } else {
            lastResultType = "BIG";
        }
        
        // Bet the opposite
        const betType = lastResultType === "SMALL" ? 13 : 14;
        const betTypeStr = `${lastResultType === "SMALL" ? "BIG" : "SMALL"} (Inverse of ${lastResultType})`;
        
        return { betType, betTypeStr };
        
    } catch (error) {
        console.error(` Error getting follow inverse bet type:`, error);
        const betType = Math.random() < 0.5 ? 13 : 14;
        return { betType, betTypeStr: betType === 13 ? "BIG" : "SMALL" };
    }
}

// Crease Mode ကို set လုပ်မယ့် function
async setCreaseMode(chatId, userId, mode) {
    try {
        await this.saveUserSetting(userId, 'crease_mode', mode);
        
        let message = "";
        
        if (mode === 'loss') {
            message = "Crease Mode Set to: Loss Crease";
        } else if (mode === 'win') {
            message = "Crease Mode Set to: Win Crease";
        }
        
        const userSession = this.ensureUserSession(userId);
        userSession.step = 'main';
        
        await this.bot.sendMessage(chatId, message, {
            reply_markup: this.getMainKeyboard(userId)
        });
        
        console.log(` Crease mode set to ${mode} for user ${userId}`);
    } catch (error) {
        console.error(` Error setting crease mode for user ${userId}:`, error);
        await this.bot.sendMessage(chatId, "Error setting crease mode. Please try again.");
    }
}

    async getBsFormulaBetType(userId) {
        try {
            const patternsData = await this.getFormulaPatterns(userId);
            const bsPattern = patternsData.bs_pattern;
            let currentIndex = patternsData.bs_current_index;

            if (!bsPattern) {
                const betType = Math.random() < 0.5 ? 13 : 14;
                return { 
                    betType, 
                    betTypeStr: betType === 13 ? "BIG (Random Fallback)" : "SMALL (Random Fallback)" 
                };
            }

            const patternArray = bsPattern.split(',');

            if (currentIndex >= patternArray.length) {
                currentIndex = 0;
            }

            const currentBet = patternArray[currentIndex];
            const betType = currentBet === 'B' ? 13 : 14;
            const betTypeStr = `${currentBet === 'B' ? 'BIG' : 'SMALL'} (BS Formula ${currentIndex + 1}/${patternArray.length})`;

            const newIndex = currentIndex + 1;
            await this.updateBsPatternIndex(userId, newIndex);

            return { betType, betTypeStr };

        } catch (error) {
            console.error(`Error getting BS formula bet type for user ${userId}:`, error);
            const betType = Math.random() < 0.5 ? 13 : 14;
            return { betType, betTypeStr: betType === 13 ? "BIG" : "SMALL" };
        }
    }

    async updateBsPatternIndex(userId, newIndex) {
        try {
            await this.db.run(
                'UPDATE formula_patterns SET bs_current_index = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                [newIndex, userId]
            );
            return true;
        } catch (error) {
            console.error(`Error updating BS pattern index for user ${userId}:`, error);
            return false;
        }
    }

    async handleStart(msg) {
        const chatId = msg.chat.id;
        const userId = String(chatId);

        console.log(`User ${userId} started the bot`);

        this.ensureUserSession(userId);

        const welcomeText = `Wellcome ${msg.from.first_name} to Auto Bot!`;

        await this.bot.sendMessage(chatId, welcomeText, {
            reply_markup: this.getMainKeyboard()
        });
    }

    async handleCallbackQuery(query) {
        const chatId = query.message.chat.id;
        const userId = String(chatId);

        console.log(` Callback query: ${query.data} from user ${userId}`);

        if (query.data === "check_join") {
            await this.bot.answerCallbackQuery(query.id);
            await this.bot.editMessageText("Thank you for joining our channel! You can now use the bot.\n\nPress /start to begin.", {
                chat_id: chatId,
                message_id: query.message.message_id
            });
        }
    }

    async handleMessage(msg) {
        if (!msg.text) return;

        const chatId = msg.chat.id;
        const userId = String(chatId);
        const text = msg.text;

        console.log(` User ${userId} sent: ${text}`);

        const userSession = this.ensureUserSession(userId);

        switch (userSession.step) {
            case 'login_phone':
                userSession.phone = text;
                userSession.step = 'login';
                await this.bot.sendMessage(chatId, `Phone number saved: ${text}\nNow please enter your password:`, {
                    reply_markup: this.getLoginKeyboard()
                });
                break;

            case 'login_password':
                userSession.password = text;
                userSession.step = 'login';
                await this.bot.sendMessage(chatId, "Password saved!\nClick 'Login Now' to authenticate.", {
                    reply_markup: this.getLoginKeyboard()
                });
                break;

            case 'set_game_type':
                await this.handleSetGameType(chatId, userId, text);
                break;

            case 'set_bet_sequence':
                await this.handleSetBetSequence(chatId, userId, text);
                break;

            case 'set_profit_target':
                await this.handleSetProfitTarget(chatId, userId, text);
                break;

            case 'set_loss_target':
                await this.handleSetLossTarget(chatId, userId, text);
                break;

            case 'set_bs_pattern':
                await this.handleSetBsPattern(chatId, userId, text);
                break;

            case 'set_colour_pattern':
                await this.handleSetColourPattern(chatId, userId, text);
                break;

            default:
                await this.handleButtonCommand(chatId, userId, text);
        }
    }

    async handleButtonCommand(chatId, userId, text) {
    console.log(` Handling button command: '${text}' for user ${userId}`);

    try {
        const userSession = this.ensureUserSession(userId);

        // Check login status for protected commands
        const protectedCommands = [
            "Balance", "Results", "Bet BIG", "Bet SMALL", "Bet RED", 
            "Bet GREEN", "Bet VIOLET", "Bot Settings", "My Bets", 
            "Run Bot", "Bot Info", "Crease Mode", "Game Type", "Stop Bot",
            "Follow Inverse"
        ];

        if (protectedCommands.includes(text) && !userSession.loggedIn) {
            await this.bot.sendMessage(chatId, "Please login to first!");
            return;
        }

        switch (text) {
            case "Login":
                await this.handleLoginPlatform(chatId, userId);
                break;

            case "Balance":
                await this.handleBalance(chatId, userId);
                break;
                
            case "Results":
                await this.handleResults(chatId, userId);
                break;

            case "Bet BIG":
                await this.placeBetHandler(chatId, userId, 13);
                break;

            case "Bet SMALL":
                await this.placeBetHandler(chatId, userId, 14);
                break;

            case "Bet RED":
                await this.placeColourBet(chatId, userId, "RED");
                break;

            case "Bet GREEN":
                await this.placeColourBet(chatId, userId, "GREEN");
                break;

            case "Bet VIOLET":
                await this.placeColourBet(chatId, userId, "VIOLET");
                break;

            case "Bot Settings":
                await this.showBotSettings(chatId, userId);
                break;

            case "My Bets":
                await this.showMyBets(chatId, userId);
                break;

            case "Game Type":
                await this.showPlatformMenu(chatId, userId);
                break;

            case "Run Bot":
                await this.runBot(chatId, userId);
                break;

            case "Stop Bot":
                await this.stopBot(chatId, userId);
                break;

            case "Bot Info":
                await this.showBotInfo(chatId, userId);
                break;

            case "Enter Phone":
                userSession.step = 'login_phone';
                await this.bot.sendMessage(chatId, "Please enter your phone number (without country code):");
                break;

            case "Enter Password":
                userSession.step = 'login_password';
                await this.bot.sendMessage(chatId, "Please enter your password:");
                break;

            case "Login Now":
                await this.processLogin(chatId, userId);
                break;

            case "Back":
                userSession.step = 'main';
                await this.bot.sendMessage(chatId, "Main Menu", {
                    reply_markup: this.getMainKeyboard()
                });
                break;

            case "Random BIG":
                await this.setRandomBig(chatId, userId);
                break;

            case "Random SMALL":
                await this.setRandomSmall(chatId, userId);
                break;

            case "Random Bot":
                await this.setRandomBot(chatId, userId);
                break;

            case "Follow Bot":
                await this.setFollowBot(chatId, userId);
                break;

            case "Follow Inverse":
    // တိုဂယ် (Toggle) လုပ်မယ် - ဖွင့်ထားရင်ပိတ်၊ ပိတ်ထားရင်ဖွင့်
    const currentInverse = await this.getUserSetting(userId, 'follow_inverse', 0);
    await this.setFollowInverse(chatId, userId, !currentInverse);
  
    break;

            case "Enable Inverse":
                await this.setFollowInverse(chatId, userId, true);
                break;

            case "Disable Inverse":
                await this.setFollowInverse(chatId, userId, false);
                break;

            case "BS Formula":
                await this.showBsFormula(chatId, userId);
                break;

            case "Colour Formula":
                await this.showColourFormula(chatId, userId);
                break;

            case "Set Bet Sequence":
                userSession.step = 'set_bet_sequence';
                const currentSequence = await this.getUserSetting(userId, 'bet_sequence', '');
                await this.bot.sendMessage(chatId, `Current bet sequence: ${currentSequence}\nEnter new bet sequence (comma separated e.g.,)`);
                break;

            case "Profit Target":
                userSession.step = 'set_profit_target';
                const currentProfitTarget = await this.getUserSetting(userId, 'profit_target', 0);
                await this.bot.sendMessage(chatId, `Set Profit Target\n\nCurrent target: ${currentProfitTarget.toLocaleString()} K\n\nPlease enter the profit target amount:\nExample: 10000\nEnter 0 to disable.`);
                break;

            case "Loss Target":
                userSession.step = 'set_loss_target';
                const currentLossTarget = await this.getUserSetting(userId, 'loss_target', 0);
                await this.bot.sendMessage(chatId, `Set Loss Target\n\nCurrent target: ${currentLossTarget.toLocaleString()} K\n\nPlease enter the loss target amount:\nExample: 5000\nEnter 0 to disable.`);
                break;

            case "Main Menu":
                userSession.step = 'main';
                await this.bot.sendMessage(chatId, "Main Menu", {
                    reply_markup: this.getMainKeyboard()
                });
                break;

            case "Set BS Pattern":
                userSession.step = 'set_bs_pattern';
                await this.bot.sendMessage(chatId, "Set BS Pattern for BS Formula Mode\nEnter your BS pattern using ONLY:\n\nExamples:\n- B,S,B,B\n- S,S,B\n- B,B,B,S\n\nEnter your BS pattern:");
                break;

            case "View BS Pattern":
                await this.viewBsPattern(chatId, userId);
                break;

            case "Clear BS Pattern":
                await this.clearBsPattern(chatId, userId);
                break;

            case "Set Colour Pattern":
                userSession.step = 'set_colour_pattern';
                await this.bot.sendMessage(chatId, "Set Colour Pattern for Colour Formula Mode\nEnter your Colour pattern using ONLY:\n\nExamples:\n- R,G,V,R\n- G,V,R\n- R,R,G\n\nEnter your Colour pattern:");
                break;

            case "View Colour Pattern":
                await this.viewColourPattern(chatId, userId);
                break;

            case "Clear Colour Pattern":
                await this.clearColourPattern(chatId, userId);
                break;

            // Handle the new game types
            case "WINGO 1 MIN":
            case "WINGO 30S":
            case "TRX 1 MIN":
                await this.handleSetGameType(chatId, userId, text);
                break;

            case "":
                await this.handleSetPlatform(chatId, userId, 'CKLOTTERY');
                break;

            // CREASE MODE COMMANDS
            case "Crease Mode":
                await this.showCreaseModeMenu(chatId, userId);
                break;

            case "Loss Crease":
                await this.setCreaseMode(chatId, userId, 'loss');
                break;

            case "Win Crease":
                await this.setCreaseMode(chatId, userId, 'win');
                break;

            default:
                await this.bot.sendMessage(chatId, "Please use the buttons below to navigate.", {
                    reply_markup: this.getMainKeyboard()
                });
        }
    } catch (error) {
        console.error(` Error handling button command '${text}' for user ${userId}:`, error);
        await this.bot.sendMessage(chatId, "Error processing command. Please try again.");
    }
}

    async showPlatformMenu(chatId, userId) {
    const userSession = this.ensureUserSession(userId);
    const currentPlatform = userSession.platform || 'CKLOTTERY';
    const currentGameType = userSession.gameType || 'WINGO_1MIN';

    let platformInfo = "\n\n: Premium Gaming Platform";

    let gameTypeInfo = "";
    if (currentGameType === 'TRX_1MIN') {
        gameTypeInfo = "\n\nTRX 1 MIN: Supports BIG/SMALL Only (No colour betting)";
    } else if (currentGameType === 'WINGO_30S') {
        gameTypeInfo = "\n\nWINGO 30S: Supports BIG/SMALL and Colour betting";
    } else if (currentGameType === 'WINGO_1MIN') {
        gameTypeInfo = "\n\nWINGO 1 MIN: Supports BIG/SMALL and Colour betting";
    }

    const platformText = ` Select Game Type`;

    await this.bot.sendMessage(chatId, platformText, {
        reply_markup: {
            keyboard: [
                [{ text: "WINGO 1 MIN" }],
                [{ text: "WINGO 30S" }],
                [{ text: "TRX 1 MIN" }],
                [{ text: "Back" }]
            ],
            resize_keyboard: true
        }
    });
}

    async handleSetPlatform(chatId, userId, platform) {
        try {
            const userSession = this.ensureUserSession(userId);

            if (platform === 'CKLOTTERY') {
                userSession.platform = platform;
                await this.saveUserSetting(userId, 'platform', platform);

                if (userSession.apiInstance) {
                    userSession.apiInstance = new LotteryAPI(platform, userSession.gameType);
                }

                userSession.step = 'main';

                await this.bot.sendMessage(chatId, `Platform set to: `, {
                    reply_markup: this.getMainKeyboard()
                });
            } else {
                await this.bot.sendMessage(chatId, "Only  platform is available.", {
                    reply_markup: this.getPlatformKeyboard()
                });
            }
        } catch (error) {
            console.error(` Error setting platform for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, "Error setting platform. Please try again.");
        }
    }

    async handleSetGameType(chatId, userId, text) {
    try {
        const userSession = this.ensureUserSession(userId);
        let gameType = text.toUpperCase();

        if (text === "WINGO 1 MIN") {
            gameType = "WINGO_1MIN";
        } else if (text === "WINGO 30S") {
            gameType = "WINGO_30S";
        } else if (text === "TRX 1 MIN") {
            gameType = "TRX_1MIN";
        }

        if (gameType === 'WINGO_1MIN' || gameType === 'WINGO_30S' || gameType === 'TRX_1MIN') {
            userSession.gameType = gameType;
            await this.saveUserSetting(userId, 'game_type', gameType);

            if (userSession.apiInstance) {
                userSession.apiInstance.gameType = gameType;
            }

            userSession.step = 'main';

            let displayGameType = text;
            await this.bot.sendMessage(chatId, ` Game type set to: ${displayGameType}`, {
                reply_markup: this.getMainKeyboard(userId)
            });
        } else {
            await this.bot.sendMessage(chatId, "Invalid game type. Please select from available options.", {
                reply_markup: this.getGameTypeKeyboard()
            });
        }
    } catch (error) {
        console.error(` Error setting game type for user ${userId}:`, error);
        await this.bot.sendMessage(chatId, "Error setting game type. Please try again.");
    }
}

    async handleLoginPlatform(chatId, userId) {
        const userSession = this.ensureUserSession(userId);
        userSession.step = 'login';

        userSession.apiInstance = new LotteryAPI('CKLOTTERY', userSession.gameType);

        const loginGuide = `6 Lottery Login

Please follow these steps:

1. Click 'Enter Phone' and send your phone number
2. Click 'Enter Password' and send your password  
3. Click 'Login Now' to authenticate

Your credentials will be saved for feathuer use!`;

        await this.bot.sendMessage(chatId, loginGuide, {
            reply_markup: this.getLoginKeyboard()
        });
    }

    async processLogin(chatId, userId) {
    const userSession = this.ensureUserSession(userId);

    if (!userSession.phone || !userSession.password) {
        await this.bot.sendMessage(chatId, "Please enter phone number and password first!", {
            reply_markup: this.getLoginKeyboard()
        });
        return;
    }

    const loadingMsg = await this.bot.sendMessage(chatId, `Logging into ... Please wait.`);

    try {
        const result = await userSession.apiInstance.login(userSession.phone, userSession.password);

        if (result.success) {
            const userInfo = await userSession.apiInstance.getUserInfo();
            const gameId = userInfo.userId || '';

            if (!await this.isGameIdAllowed(gameId)) {
                await this.bot.editMessageText(` Login Failed!\n\nGame ID: ${gameId}\nStatus: NOT ALLOWED\n\nPlease contact admin: @trilionx2`, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
                return;
            }

            userSession.loggedIn = true;
            userSession.step = 'main';

            const balance = await userSession.apiInstance.getBalance();
            const gameType = userSession.gameType || 'WINGO';

            await this.saveUserCredentials(userId, userSession.phone, userSession.password, userSession.platform);
            await this.saveUserSetting(userId, 'auto_login', 1);
            await this.saveUserSetting(userId, 'game_type', gameType);
            
            // WINGO games အတွက် default bet amount ကို 100 သတ်မှတ်ပေးမယ်
            if (gameType.includes('WINGO') || !gameType.includes('TRX')) {
                await this.saveUserSetting(userId, 'bet_amount', 100);
            }

            // 🔥 PHONE NUMBER MASKING - 09796572086 -> 097******86
            const maskedPhone = this.maskPhoneNumber(userSession.phone);

            const successText = ` Login Successful!
 
Game ID: ${gameId}
Account: ${maskedPhone}
Balance: ${balance.toLocaleString()} K
Game Type: ${gameType}

Status: VERIFIED ✅`;

            await this.bot.editMessageText(successText, {
                chat_id: chatId,
                message_id: loadingMsg.message_id
            });

            await this.bot.sendMessage(chatId, "Choose an option:", {
                reply_markup: this.getMainKeyboard()
            });
        } else {
            await this.bot.editMessageText(` Login failed: ${result.message}`, {
                chat_id: chatId,
                message_id: loadingMsg.message_id
            });
        }
    } catch (error) {
        await this.bot.editMessageText(` Login error: ${error.message}`, {
            chat_id: chatId,
            message_id: loadingMsg.message_id
        });
    }
}

    async handleBalance(chatId, userId) {
        const userSession = this.ensureUserSession(userId);

        if (!userSession.loggedIn) {
            await this.bot.sendMessage(chatId, "Please login to first!");
            return;
        }

        try {
            const balance = await userSession.apiInstance.getBalance();
            const userInfo = await userSession.apiInstance.getUserInfo();
            const user_id_display = userInfo.userId || 'N/A';
            const gameType = userSession.gameType || 'WINGO';

            const balanceText = ` Account Information

Game Type: ${gameType}
User ID: ${user_id_display}
Balance: ${balance.toLocaleString()} K
Status: LOGGED IN ✅

Last update: ${getMyanmarTime()}`;

            await this.bot.sendMessage(chatId, balanceText);
        } catch (error) {
            await this.bot.sendMessage(chatId, ` Error getting balance: ${error.message}`);
        }
    }

    async handleResults(chatId, userId) {
        const userSession = this.ensureUserSession(userId);
        const gameType = userSession.gameType || 'WINGO';

        try {
            let results;
            if (userSession.apiInstance) {
                results = await userSession.apiInstance.getRecentResults(10);
            } else {
                const api = new LotteryAPI('CKLOTTERY', gameType);
                results = await api.getRecentResults(10);
            }

            if (!results || results.length === 0) {
                await this.bot.sendMessage(chatId, "No recent results available from .");
                return;
            }

            let resultsText = ` Recent Game Results (${gameType})\n\n`;
            results.forEach((result, i) => {
                const issueNo = result.issueNumber || 'N/A';
                const number = result.number || 'N/A';
                const resultType = ['0','1','2','3','4'].includes(number) ? "SMALL" : "BIG";
                const colour = result.colour || 'UNKNOWN';

                resultsText += `${i+1}. ${issueNo} - ${number} - ${resultType} ${colour}\n`;
            });

            resultsText += ` `;

            await this.bot.sendMessage(chatId, resultsText);
        } catch (error) {
            await this.bot.sendMessage(chatId, ` Error getting results: ${error.message}`);
        }
    }

    async placeBetHandler(chatId, userId, betType) {
    const userSession = this.ensureUserSession(userId);

    if (!userSession.loggedIn) {
        await this.bot.sendMessage(chatId, "Please login to first!");
        return;
    }

    try {
        const currentIssue = await userSession.apiInstance.getCurrentIssue();
        if (!currentIssue) {
            await this.bot.sendMessage(chatId, "Cannot get current game issue from . Please try again.");
            return;
        }

        if (await this.hasUserBetOnIssue(userId, userSession.platform, currentIssue)) {
            await this.bot.sendMessage(chatId, `Wait for next period\n\nYou have already placed a bet on issue ${currentIssue}.\nPlease wait for the next game period to place another bet.`);
            return;
        }

        let amount = await this.getCurrentBetAmount(userId);
        const betTypeStr = betType === 13 ? "BIG" : "SMALL";
        const gameType = userSession.gameType || 'WINGO';

        // TRX နဲ့ WINGO နှစ်ခုလုံးအတွက် minimum 100
        if (amount < 100) {
            console.log(` Adjusting manual bet amount from ${amount} to 100`);
            amount = 100;
            await this.saveUserSetting(userId, 'bet_amount', amount);
        }

        // amount က 100, 200, 300,... ဖြစ်ရမယ်
        if (amount % 100 !== 0) {
            const adjustedAmount = Math.floor(amount / 100) * 100;
            console.log(`Bet amount ${amount} is not multiple of 100, adjusting to: ${adjustedAmount}`);
            amount = adjustedAmount;
        }

        const balance = await userSession.apiInstance.getBalance();
        if (balance < amount) {
            await this.bot.sendMessage(chatId, `Insufficient balance! You have ${balance.toLocaleString()} K but need ${amount.toLocaleString()} K`);
            return;
        }

        const loadingMsg = await this.bot.sendMessage(chatId, `Placing ${betTypeStr} Bet on `);

        const result = await userSession.apiInstance.placeBet(amount, betType);

        if (result.success) {
            await this.savePendingBet(userId, userSession.platform, result.issueId, betTypeStr, amount);

            if (!issueCheckers[userId]) {
                this.startIssueChecker(userId);
            }

            const betText = ` Bet Placed Successfully!\n\nIssue: ${result.issueId}\nType: ${betTypeStr}\nAmount: ${amount.toLocaleString()} K`;

            await this.bot.editMessageText(betText, {
                chat_id: chatId,
                message_id: loadingMsg.message_id
            });
        } else {
            await this.bot.editMessageText(` Bet Failed\n\nError: ${result.message}`, {
                chat_id: chatId,
                message_id: loadingMsg.message_id
            });
        }
    } catch (error) {
        await this.bot.sendMessage(chatId, ` Bet Error\n\nError: ${error.message}`);
    }
}

    async placeColourBet(chatId, userId, colour) {
    const userSession = this.ensureUserSession(userId);

    if (!userSession.loggedIn) {
        await this.bot.sendMessage(chatId, "Please login to first!");
        return;
    }

    try {
        // Allow colour betting for ALL game types (WINGO and TRX)
        // TRX also supports colour betting now
        
        const currentIssue = await userSession.apiInstance.getCurrentIssue();
        if (!currentIssue) {
            await this.bot.sendMessage(chatId, "Cannot get current game issue from . Please try again.");
            return;
        }

        if (await this.hasUserBetOnIssue(userId, userSession.platform, currentIssue)) {
            await this.bot.sendMessage(chatId, `Wait for next period\n\nYou have already placed a bet on issue ${currentIssue}.\nPlease wait for the next game period to place another bet.`);
            return;
        }

        let amount = await this.getCurrentBetAmount(userId);
        const betType = SIX_LOTTERY_BET_TYPES[colour];
        const gameType = userSession.gameType || 'WINGO';

        // Minimum amount check
        if (amount < 100) {
            console.log(` Adjusting colour bet amount from ${amount} to 100`);
            amount = 100;
            await this.saveUserSetting(userId, 'bet_amount', amount);
        }

        // amount က 100, 200, 300,... ဖြစ်ရမယ်
        if (amount % 100 !== 0) {
            const adjustedAmount = Math.floor(amount / 100) * 100;
            console.log(`Colour bet amount ${amount} is not multiple of 100, adjusting to: ${adjustedAmount}`);
            amount = adjustedAmount;
        }

        const balance = await userSession.apiInstance.getBalance();
        if (balance < amount) {
            await this.bot.sendMessage(chatId, `Insufficient balance!\n\nYou have: ${balance.toLocaleString()} K\nNeed: ${amount.toLocaleString()} K`);
            return;
        }

        const contractAmount = Math.floor(amount * 0.98);
        let potentialProfit, payoutInfo;

        if (colour === "RED") {
            potentialProfit = contractAmount * 2;
            payoutInfo = "Win 196K on 2,4,6,8 | Win 147K on 0 (RedViolet)";
        } else if (colour === "GREEN") {
            potentialProfit = contractAmount * 2;
            payoutInfo = "Win 196K on 1,3,7,9 | Win 147K on 5 (GreenViolet)";
        } else if (colour === "VIOLET") {
            potentialProfit = contractAmount * 2;
            payoutInfo = "Win 196K on 0,5";
        }

        const loadingMsg = await this.bot.sendMessage(chatId, `Placing ${colour} Bet on `);

        const result = await userSession.apiInstance.placeBet(amount, betType);

        if (result.success) {
            const betTypeStr = `${colour}`;
            await this.savePendingBet(userId, userSession.platform, result.issueId, betTypeStr, amount);

            if (!issueCheckers[userId]) {
                this.startIssueChecker(userId);
            }

            const betText = ` Colour Bet Placed Successfully!\n\nGame: ${gameType}\nIssue: ${result.issueId}\nType: ${colour}\nAmount: ${amount.toLocaleString()} K`;

            await this.bot.editMessageText(betText, {
                chat_id: chatId,
                message_id: loadingMsg.message_id
            });
        } else {
            await this.bot.editMessageText(` ${colour} Bet Failed\n\nError: ${result.message}`, {
                chat_id: chatId,
                message_id: loadingMsg.message_id
            });
        }
    } catch (error) {
        console.error(` Colour bet error for user ${userId}:`, error);
        await this.bot.sendMessage(chatId, ` ${colour} Bet Error\n\nError: ${error.message}`);
    }
}

    async stopBot(chatId, userId) {
        try {
            console.log(` Stopping bot for user ${userId}`);

            if (autoBettingTasks[userId]) {
                delete autoBettingTasks[userId];
                console.log(` Auto betting task stopped for user ${userId}`);
            }

            if (waitingForResults[userId]) {
                delete waitingForResults[userId];
                console.log(` Waiting for results cleared for user ${userId}`);
            }

            if (issueCheckers[userId]) {
                delete issueCheckers[userId];
                console.log(` Issue checker stopped for user ${userId}`);
            }

            await this.saveBotSession(userId, false);
            console.log(` Bot session updated for user ${userId}`);

            const userSession = this.ensureUserSession(userId);
            let currentBalance = 0;
            let balanceText = "";

            if (userSession && userSession.loggedIn && userSession.apiInstance) {
                try {
                    currentBalance = await userSession.apiInstance.getBalance();
                    balanceText = `\nCurrent Balance: ${currentBalance.toLocaleString()} K`;
                } catch (balanceError) {
                    console.error(` Error getting balance for user ${userId}:`, balanceError);
                    balanceText = "\nCurrent Balance: Unable to check balance";
                }
            }

            const stopMessage = ` Bot Stopped!`;
            console.log(` Sending stop message to user ${userId}`);

            await this.bot.sendMessage(chatId, stopMessage, {
                reply_markup: this.getMainKeyboard()
            });

            console.log(` Bot successfully stopped for user ${userId}`);

        } catch (error) {
            console.error(` Error in stopBot for user ${userId}:`, error);

            try {
                await this.bot.sendMessage(chatId, " Bot stopped with some issues.\n\nPlease check if bot is still running.", {
                    reply_markup: this.getMainKeyboard()
                });
            } catch (sendError) {
                console.error(` Failed to send error message to user ${userId}:`, sendError);
            }
        }
    }

    startIssueChecker(userId) {
        if (issueCheckers[userId]) return;

        issueCheckers[userId] = true;
        console.log(` Started issue checker for user ${userId}`);

        const userSession = userSessions[userId];
        if (!userSession || !userSession.apiInstance) return;

        let lastCheckedIssue = '';

        const checkLoop = async () => {
            if (!issueCheckers[userId]) return;

            try {
                const currentIssue = await userSession.apiInstance.getCurrentIssue();

                if (currentIssue && currentIssue !== lastCheckedIssue) {
                    console.log(` Issue changed from ${lastCheckedIssue} to ${currentIssue}, checking results for user ${userId}`);

                    if (lastCheckedIssue) {
                        await this.checkSingleBetResult(userId, lastCheckedIssue);
                    }
                    lastCheckedIssue = currentIssue;
                }

                setTimeout(checkLoop, 3000);
            } catch (error) {
                console.error(` Issue checker error for user ${userId}:`, error);
                setTimeout(checkLoop, 10000);
            }
        };

        userSession.apiInstance.getCurrentIssue().then(issue => {
            if (issue) {
                lastCheckedIssue = issue;
                console.log(` Initial issue set to: ${issue} for user ${userId}`);
            }
            checkLoop();
        }).catch(error => {
            console.error(` Error getting initial issue for user ${userId}:`, error);
            setTimeout(checkLoop, 10000);
        });
    }

    async checkSingleBetResult(userId, issue) {
    try {
        console.log(` Checking bet result for user ${userId}, issue: ${issue}`);

        const userSession = userSessions[userId];
        if (!userSession || !userSession.apiInstance) {
            console.log(` No user session or API instance for user ${userId}`);
            return;
        }

        const platform = userSession.platform || 'CKLOTTERY';
        const gameType = userSession.gameType || 'WINGO';

        const pendingBet = await this.db.get(
            'SELECT platform, issue, bet_type, amount FROM pending_bets WHERE user_id = ? AND platform = ? AND issue = ?',
            [userId, platform, issue]
        );

        if (!pendingBet) {
            console.log(` No pending bet found for user ${userId}, issue ${issue}`);
            return;
        }

        console.log(` Found pending bet: ${JSON.stringify(pendingBet)}`);

        const betTypeStr = pendingBet.bet_type;
        const amount = pendingBet.amount;
        const contractAmount = Math.floor(amount * 0.98);

        const results = await userSession.apiInstance.getRecentResults(20);
        console.log(` Retrieved ${results.length} recent results for user ${userId}`);

        if (results.length === 0) {
            console.log(` No results found for user ${userId}`);
            return;
        }

        let betResult = "UNKNOWN";
        let profitLoss = 0;
        let resultNumber = "";
        let resultType = "";
        let resultColour = "";

        let resultFound = false;
        for (const result of results) {
            console.log(` Checking result: ${result.issueNumber} vs ${issue}`);

            if (result.issueNumber === issue) {
                resultFound = true;
                resultNumber = result.number || 'N/A';
                resultColour = result.colour || 'UNKNOWN';
                console.log(` Found matching result for issue ${issue}: number ${resultNumber}, colour ${resultColour}`);

                // Handle TRX 1 MIN results
                if (gameType === 'TRX_1MIN') {
                    if (['0','1','2','3','4'].includes(resultNumber)) {
                        resultType = "SMALL";
                    } else {
                        resultType = "BIG";
                    }
                } else {
                    // WINGO games
                    if (['0','1','2','3','4'].includes(resultNumber)) {
                        resultType = "SMALL";
                    } else {
                        resultType = "BIG";
                    }

                    if (['0','5'].includes(resultNumber)) {
                        resultColour = "VIOLET";
                    } else if (['1','3','7','9'].includes(resultNumber)) {
                        resultColour = "GREEN";
                    } else if (['2','4','6','8'].includes(resultNumber)) {
                        resultColour = "RED";
                    } else {
                        resultColour = "UNKNOWN";
                    }
                }

                console.log(` Result analysis - Type: ${resultType}, Colour: ${resultColour}`);

                // Calculate profit/loss based on bet type
                if (betTypeStr.includes("BIG") || betTypeStr.includes("SMALL")) {
                    // BIG/SMALL: 100 ထိုးရင် 196 ရ (အမြတ် 96)
                    if (betTypeStr.includes("BIG") && resultType === "BIG") {
                        betResult = "WIN";
                        // 🔥 FIX: Store TOTAL RETURN (196) instead of profit (96)
                        profitLoss = Math.floor(amount * 1.96); // 100 * 1.96 = 196
                        console.log(` BIG bet WON - Total Return: ${profitLoss} (Profit: ${profitLoss - amount})`);
                    } else if (betTypeStr.includes("SMALL") && resultType === "SMALL") {
                        betResult = "WIN";
                        // 🔥 FIX: Store TOTAL RETURN (196) instead of profit (96)
                        profitLoss = Math.floor(amount * 1.96); // 100 * 1.96 = 196
                        console.log(` SMALL bet WON - Total Return: ${profitLoss} (Profit: ${profitLoss - amount})`);
                    } else {
                        betResult = "LOSE";
                        profitLoss = -amount;
                        console.log(` BIG/SMALL bet LOST - Loss: ${amount}`);
                    }
                } else if (betTypeStr.includes("RED") || betTypeStr.includes("GREEN") || betTypeStr.includes("VIOLET")) {
                    // Colour bet calculations
                    if ((betTypeStr.includes("RED") && resultColour === "RED") ||
                        (betTypeStr.includes("GREEN") && resultColour === "GREEN") ||
                        (betTypeStr.includes("VIOLET") && resultColour === "VIOLET")) {
                        betResult = "WIN";
                        // 🔥 FIX: Store TOTAL RETURN (196) instead of profit (96)
                        profitLoss = Math.floor(amount * 1.96); // 100 * 1.96 = 196
                        console.log(` Colour bet WON (Full win) - Total Return: ${profitLoss} (Profit: ${profitLoss - amount})`);
                    } else if (betTypeStr.includes("RED") && resultNumber === '0' && gameType !== 'TRX_1MIN') {
                        betResult = "WIN";
                        // RedViolet: 147 total return (profit 47)
                        profitLoss = Math.floor(amount * 1.47); // 100 * 1.47 = 147
                        console.log(` RED bet WON - 0 (RedViolet) - Total Return: ${profitLoss} (Profit: ${profitLoss - amount})`);
                    } else if (betTypeStr.includes("GREEN") && resultNumber === '5' && gameType !== 'TRX_1MIN') {
                        betResult = "WIN";
                        // GreenViolet: 147 total return (profit 47)
                        profitLoss = Math.floor(amount * 1.47); // 100 * 1.47 = 147
                        console.log(` GREEN bet WON - 5 (GreenViolet) - Total Return: ${profitLoss} (Profit: ${profitLoss - amount})`);
                    } else {
                        betResult = "LOSE";
                        profitLoss = -amount;
                        console.log(` Colour bet LOST - Loss: ${amount}`);
                    }
                }
                break;
            }
        }

        if (!resultFound) {
            console.log(` Result not found for issue ${issue} in recent results`);
            return;
        }

        if (betResult === "UNKNOWN") {
            console.log(` Unknown bet result for issue ${issue}`);
            return;
        }

        // 🔥 Save to database
        await this.db.run(
            'INSERT INTO bet_history (user_id, platform, issue, bet_type, amount, result, profit_loss) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [userId, platform, issue, betTypeStr, amount, betResult, profitLoss]
        );
        console.log(` Bet history saved for user ${userId} - profit_loss: ${profitLoss}`);

        await this.db.run(
            'DELETE FROM pending_bets WHERE user_id = ? AND platform = ? AND issue = ?',
            [userId, platform, issue]
        );
        console.log(` Pending bet removed for user ${userId}`);

        // 🔥 Update total profit with actual profit (not total return)
        const actualProfit = betResult === "WIN" ? profitLoss - amount : profitLoss;
        
        const botSession = await this.getBotSession(userId);
        const totalProfitBefore = botSession.total_profit || 0;
        const newTotalProfit = totalProfitBefore + actualProfit;

        await this.updateBotStats(userId, actualProfit, newTotalProfit);
        console.log(` Bot stats updated for user ${userId}, new total profit: ${newTotalProfit}`);

        console.log(` Calling updateBetSequence for user ${userId} with result: ${betResult}`);
        await this.updateBetSequence(userId, betResult);

        waitingForResults[userId] = false;
        console.log(` Reset waitingForResults for user ${userId}`);

        console.log(` Sending result message to user ${userId}`);
        await this.sendResultMessage(userId, issue, betTypeStr, amount, betResult, profitLoss - amount, resultNumber, resultType, resultColour, newTotalProfit);

        console.log(` Bet result processed for user ${userId}: ${betResult} on issue ${issue}, Profit: ${profitLoss - amount}`);

    } catch (error) {
        console.error(` Error checking single bet result for user ${userId}, issue ${issue}:`, error);
        waitingForResults[userId] = false;
    }
}

    async sendResultMessage(userId, issue, betTypeStr, amount, betResult, profitLoss, resultNumber, resultType, resultColour, totalProfit = 0) {
        try {
            const userSession = userSessions[userId];
            if (!userSession) {
                console.log(` No user session for sending message to ${userId}`);
                return;
            }

            const chatId = userId;
            const gameType = userSession.gameType || 'WINGO';

            let message = "";

            if (betResult === "WIN") {
                message = `🚀 BET RESULT - WIN! \n\n`;
                
                message += `🏆 TOTAL PROFIT: ${totalProfit.toLocaleString()} K\n\n`;
            } else {
                message = `🚀 BET RESULT - LOSS! \n\n`;
                
                message += `💔 TOTAL PROFIT: ${totalProfit.toLocaleString()} K\n\n`;
            }

            if (userSession.loggedIn && userSession.apiInstance) {
                try {
                    const currentBalance = await userSession.apiInstance.getBalance();
                    message += ` `;
                    console.log(` Balance retrieved: ${currentBalance} for user ${userId}`);
                } catch (balanceError) {
                    console.error(` Error getting balance for result message:`, balanceError);
                    message += `\nCurrent Balance: Unable to check balance`;
                }
            }

            console.log(` Sending message to user ${userId}: ${message.substring(0, 100)}...`);

            await this.bot.sendMessage(chatId, message, { 
                disable_notification: false
            });

            console.log(` Result message sent successfully to user ${userId}`);

        } catch (error) {
            console.error(` Error sending result message to user ${userId}:`, error);

            try {
                const simpleMessage = betResult === "WIN" ? 
                    `🏆  WIN! ${betTypeStr} bet on issue ${issue}. Profit: +${profitLoss}K | Total: ${totalProfit}K` :
                    `💔  LOSE! ${betTypeStr} bet on issue ${issue}. Loss: -${amount}K | Total: ${totalProfit}K`;

                await this.bot.sendMessage(userId, simpleMessage);
                console.log(` Simple message sent as fallback to user ${userId}`);
            } catch (fallbackError) {
                console.error(` Even simple message failed for user ${userId}:`, fallbackError);
            }
        }
    }

    async updateBetSequence(userId, result) {
    try {
        const creaseMode = await this.getUserSetting(userId, 'crease_mode', 'none');
        const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
        const betSequence = await this.getUserSetting(userId, 'bet_sequence', '100,300,700,1600,3200,7600,16000,32000');
        const amounts = betSequence.split(',').map(x => parseInt(x.trim()));

        console.log(` Updating bet sequence for user ${userId}: currentIndex=${currentIndex}, result=${result}, creaseMode=${creaseMode}`);

        let newIndex;
        
        // Check crease mode
        if (creaseMode === 'loss') {
            // Loss Crease: Loss ဖြစ်ရင် step တိုး၊ Win ဖြစ်ရင် step 1 ပြန်
            if (result === "LOSE") {
                newIndex = currentIndex + 1;
                console.log(` Loss Crease - Loss detected, increasing bet: ${currentIndex} -> ${newIndex}`);
            } else {
                newIndex = 0; // WIN ရင် reset လုပ်မယ် (step 1)
                console.log(` Loss Crease - Win detected, resetting to step 1`);
            }
        } else if (creaseMode === 'win') {
            // Win Crease: Win ဖြစ်ရင် step တိုး၊ Loss ဖြစ်ရင် step 1 ပြန်
            if (result === "WIN") {
                newIndex = currentIndex + 1;
                console.log(` Win Crease - Win detected, increasing bet: ${currentIndex} -> ${newIndex}`);
            } else {
                newIndex = 0; // LOSS ရင် reset လုပ်မယ် (step 1)
                console.log(` Win Crease - Loss detected, resetting to step 1`);
            }
        } else {
            // Normal mode (no crease mode selected)
            // ဘယ်လိုရလဒ်ပဲဖြစ်ဖြစ် အမြဲတမ်း step 1 (first bet) ကိုပဲ ထိုးမယ်
            newIndex = 0;
            console.log(` Normal Mode - Always reset to step 1 (first bet amount: ${amounts[0]})`);
        }

        // Check if index exceeds sequence length
        if (newIndex >= amounts.length) {
            newIndex = 0;
            console.log(` Reached end of sequence, resetting to step 1`);
        }

        await this.saveUserSetting(userId, 'current_bet_index', newIndex);
        console.log(` Saved new bet index: ${newIndex} for user ${userId}`);

        return newIndex;

    } catch (error) {
        console.error(` Error updating bet sequence for user ${userId}:`, error);
        return 0;
    }
}

    async updateBotStats(userId, profit = 0, totalProfit = null) {
        try {
            const session = await this.getBotSession(userId);
            const newTotalBets = session.total_bets + 1;

            const newTotalProfit = totalProfit !== null ? totalProfit : session.total_profit + profit;

            let newSessionProfit = session.session_profit;
            let newSessionLoss = session.session_loss;

            if (profit > 0) {
                newSessionProfit += profit;
            } else {
                newSessionLoss += Math.abs(profit);
            }

            await this.saveBotSession(userId, true, newTotalBets, newTotalProfit, newSessionProfit, newSessionLoss);

        } catch (error) {
            console.error(` Error updating bot stats for user ${userId}:`, error);
        }
    }

    async runBot(chatId, userId) {
        try {
            const userSession = this.ensureUserSession(userId);

            if (!userSession.loggedIn) {
                await this.bot.sendMessage(chatId, "Please login to first!");
                return;
            }

            if (autoBettingTasks[userId]) {
                await this.bot.sendMessage(chatId, " Bot is already running!");
                return;
            }

            autoBettingTasks[userId] = true;
            waitingForResults[userId] = false;

            await this.resetSessionStats(userId);
            await this.saveBotSession(userId, true);

            const patternsData = await this.getFormulaPatterns(userId);
            const followInverse = await this.getUserSetting(userId, 'follow_inverse', 0);

            const randomMode = await this.getUserSetting(userId, 'random_betting', 'bot');
            let modeText;

            // Check if Follow Inverse is enabled - it overrides other modes
            if (followInverse) {
                modeText = "Follow Inverse ";
            } else {
                switch(randomMode) {
                    case 'big':
                        modeText = "Random BIG Only";
                        break;
                    case 'small':
                        modeText = "Random SMALL Only";
                        break;
                    case 'bot':
                        modeText = "Random Bot";
                        break;
                    case 'follow':
                        modeText = "Follow Bot";
                        break;
                    case 'bs_formula':
                        modeText = `BS Formula (${patternsData.bs_pattern || 'Not set'})`;
                        break;
                    case 'colour_formula':
                        modeText = `Colour Formula (${patternsData.colour_pattern || 'Not set'})`;
                        break;
                    default:
                        modeText = "Random Bot";
                }
            }

            const startMessage = ` Auto Bot Started!\n\nGame Type: ${userSession.gameType || 'WINGO'}\nMode: ${modeText}`;
            await this.bot.sendMessage(chatId, startMessage);

            this.startAutoBetting(userId);

        } catch (error) {
            console.error(` Error running bot for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, " Error starting bot.\n\nPlease try again.");
        }
    }

    startAutoBetting(userId) {
    const userSession = userSessions[userId];
    if (!userSession || !userSession.apiInstance) {
        console.log(` No user session or API instance for user ${userId}`);
        return;
    }

    let lastIssue = '';
    let consecutiveFailures = 0;
    const maxFailures = 3;

    const bettingLoop = async () => {
        if (!autoBettingTasks[userId]) {
            console.log(` Auto betting stopped for user ${userId}`);
            return;
        }

        try {
            if (waitingForResults[userId]) {
                console.log(` User ${userId} waiting for results, checking again in 3 seconds`);
                setTimeout(bettingLoop, 3000);
                return;
            }

            const currentIssue = await userSession.apiInstance.getCurrentIssue();
            console.log(` Current issue for user ${userId}: ${currentIssue}, last issue: ${lastIssue}`);

            if (currentIssue && currentIssue !== lastIssue) {
                console.log(` New issue detected: ${currentIssue} for user ${userId}`);

                let delay;
                if (userSession.gameType === 'WINGO_30S') {
                    delay = 2000;
                } else if (userSession.gameType === 'TRX_1MIN') {
                    delay = 5000; // 1 minute TRX delay
                } else if (userSession.gameType === 'WINGO_1MIN') {
                    delay = 5000; // 1 minute WINGO delay
                } else {
                    delay = 3000;
                }

                setTimeout(async () => {
                    try {
                        if (!autoBettingTasks[userId]) return;

                        if (!(await this.hasUserBetOnIssue(userId, userSession.platform, currentIssue))) {
                            console.log(` Placing bet for user ${userId} on issue ${currentIssue}`);
                            await this.placeAutoBet(userId, currentIssue);
                            lastIssue = currentIssue;
                            consecutiveFailures = 0;
                        } else {
                            console.log(` User ${userId} already bet on issue ${currentIssue}`);
                        }

                        setTimeout(bettingLoop, 2000);
                    } catch (error) {
                        console.error(` Error in betting timeout for user ${userId}:`, error);
                        setTimeout(bettingLoop, 5000);
                    }
                }, delay);
            } else {
                console.log(` Same issue or no issue for user ${userId}, checking again in 3 seconds`);
                setTimeout(bettingLoop, 3000);
            }
        } catch (error) {
            console.error(` Auto betting error for user ${userId}:`, error);
            consecutiveFailures++;

            if (consecutiveFailures >= maxFailures) {
                console.log(` Too many errors, stopping bot for user ${userId}`);
                this.bot.sendMessage(userId, " Auto Bot Stopped - Too many errors!").catch(console.error);
                delete autoBettingTasks[userId];
                delete waitingForResults[userId];
                this.saveBotSession(userId, false);
            } else {
                console.log(` Retrying after error for user ${userId} (${consecutiveFailures}/${maxFailures})`);
                setTimeout(bettingLoop, 5000);
            }
        }
    };

    console.log(` Starting auto betting loop for user ${userId}`);
    bettingLoop();
}

    // placeAutoBet function with Follow Inverse support
async placeAutoBet(userId, issue) {
    const userSession = userSessions[userId];
    if (!userSession || !userSession.loggedIn) {
        console.log(` User ${userId} not logged in for auto bet`);
        return;
    }

    waitingForResults[userId] = true;

    const followInverse = await this.getUserSetting(userId, 'follow_inverse', 0);
    const randomMode = await this.getUserSetting(userId, 'random_betting', 'bot');

    let betType, betTypeStr;

    console.log(` Auto betting for user ${userId}, mode: ${randomMode}, followInverse: ${followInverse}, game: ${userSession.gameType}`);

    try {
        // Check if Follow Inverse is enabled - highest priority
        if (followInverse) {
            const inverseResult = await this.getFollowInverseBetType(userSession.apiInstance);
            betType = inverseResult.betType;
            betTypeStr = inverseResult.betTypeStr;
            console.log(` Using Follow Inverse mode: ${betTypeStr}`);
        } else {
            switch(randomMode) {
                case 'big':
                    betType = 13;
                    betTypeStr = "BIG";
                    break;
                case 'small':
                    betType = 14;
                    betTypeStr = "SMALL";
                    break;
                case 'follow':
                    const followResult = await this.getFollowBetType(userSession.apiInstance);
                    betType = followResult.betType;
                    betTypeStr = followResult.betTypeStr;
                    break;
                case 'bs_formula':
                    const bsResult = await this.getBsFormulaBetType(userId);
                    betType = bsResult.betType;
                    betTypeStr = bsResult.betTypeStr;
                    break;
                case 'colour_formula':
                    const colourResult = await this.getColourFormulaBetType(userId);
                    betType = colourResult.betType;
                    betTypeStr = colourResult.betTypeStr;
                    break;
                default:
                    betType = Math.random() < 0.5 ? 13 : 14;
                    betTypeStr = betType === 13 ? "BIG" : "SMALL";
            }
        }

        console.log(` Selected bet type: ${betType} (${betTypeStr}) for user ${userId}`);


        let amount = await this.getCurrentBetAmount(userId);
        console.log(` Bet amount for user ${userId}: ${amount} (from sequence)`);

        // TRX နဲ့ WINGO နှစ်ခုလုံးအတွက် minimum 100
        if (amount < 100) {
            console.log(` Auto-bet amount ${amount} is below minimum, adjusting to 100`);
            amount = 100;
        }

        // amount က 100, 200, 300,... ဖြစ်ရမယ်
        if (amount % 100 !== 0) {
            const adjustedAmount = Math.floor(amount / 100) * 100;
            console.log(`Auto-bet amount ${amount} is not multiple of 100, adjusting to: ${adjustedAmount}`);
            amount = adjustedAmount;
        }

        const balance = await userSession.apiInstance.getBalance();

        if (amount > 0 && balance < amount) {
            console.log(` Insufficient balance for user ${userId}: ${balance} < ${amount}`);
            this.bot.sendMessage(userId, ` Insufficient Balance!\n\nNeed: ${amount.toLocaleString()} K\nAvailable: ${balance.toLocaleString()} K`).catch(console.error);
            delete autoBettingTasks[userId];
            waitingForResults[userId] = false;
            return;
        }

        const botSession = await this.getBotSession(userId);
        const profitTarget = await this.getUserSetting(userId, 'profit_target', 0);
        const lossTarget = await this.getUserSetting(userId, 'loss_target', 0);

        const netProfit = botSession.session_profit - botSession.session_loss;

        if (profitTarget > 0 && netProfit >= profitTarget) {
            console.log(` Profit target reached for user ${userId}: ${netProfit} >= ${profitTarget}`);
            this.bot.sendMessage(userId, ` Profit Target Reached!\n\nCurrent Profit: ${netProfit.toLocaleString()} K\nTarget: ${profitTarget.toLocaleString()} K\n\nAuto bot stopped automatically.`).catch(console.error);
            delete autoBettingTasks[userId];
            waitingForResults[userId] = false;
            await this.saveBotSession(userId, false);
            return;
        }

        if (lossTarget > 0 && botSession.session_loss >= lossTarget) {
            console.log(` Loss target reached for user ${userId}: ${botSession.session_loss} >= ${lossTarget}`);
            this.bot.sendMessage(userId, ` Loss Target Reached!\n\nCurrent Loss: ${botSession.session_loss.toLocaleString()} K\nTarget: ${lossTarget.toLocaleString()} K\n\nAuto bot stopped automatically.`).catch(console.error);
            delete autoBettingTasks[userId];
            waitingForResults[userId] = false;
            await this.saveBotSession(userId, false);
            return;
        }

        const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
        const betSequence = await this.getUserSetting(userId, 'bet_sequence', '');
        const amounts = betSequence.split(',').map(x => parseInt(x.trim()));
        const totalSteps = amounts.length;

        // Clean bet type string for display
        const cleanBetTypeStr = betTypeStr
            .replace(" (Colour Formula Converted)", "")
            .replace(" (Follow)", "")
            .replace(" (Random Fallback)", "")
            .replace(/\(.*?\)/g, "")
            .trim();
        
        const betMessage = `💡 ${issue}\n🧠 ${cleanBetTypeStr}\n⚡ ${amount.toLocaleString()} K`;
        await this.bot.sendMessage(userId, betMessage);

        console.log(` Placing bet for user ${userId}: ${cleanBetTypeStr} ${amount}K on ${issue} (Step ${currentIndex + 1}/${totalSteps})`);
        const result = await userSession.apiInstance.placeBet(amount, betType);

        if (result.success) {
            console.log(` Bet placed successfully for user ${userId}`);
            await this.savePendingBet(userId, userSession.platform, result.issueId, cleanBetTypeStr, amount);

            if (!issueCheckers[userId]) {
                console.log(` Starting issue checker for user ${userId}`);
                this.startIssueChecker(userId);
            }

        } else {
            console.log(` Bet failed for user ${userId}: ${result.message}`);

            if (result.message.includes('amount') || result.message.includes('betting')) {
                console.log(` Amount error detected, resetting bet sequence for user ${userId}`);
                await this.saveUserSetting(userId, 'current_bet_index', 0);

                const errorMessage = ` Bet Failed - Amount Error\n\nError: ${result.message}\n\nBet sequence has been reset to step 1.`;
                await this.bot.sendMessage(userId, errorMessage);
            } else {
                const errorMessage = ` Bet Failed\n\nError: ${result.message}`;
                await this.bot.sendMessage(userId, errorMessage);
            }

            waitingForResults[userId] = false;
        }
    } catch (error) {
        console.error(` Error in placeAutoBet for user ${userId}:`, error);
        waitingForResults[userId] = false;
    }
}

    async getFollowBetType(apiInstance) {
        try {
            const results = await apiInstance.getRecentResults(1);
            if (!results || results.length === 0) {
                const betType = Math.random() < 0.5 ? 13 : 14;
                return { betType, betTypeStr: betType === 13 ? "BIG" : "SMALL" };
            }

            const lastResult = results[0];
            const number = lastResult.number || '';

            if (['0','1','2','3','4'].includes(number)) {
                return { betType: 14, betTypeStr: "SMALL (Follow)" };
            } else {
                return { betType: 13, betTypeStr: "BIG (Follow)" };
            }
        } catch (error) {
            const betType = Math.random() < 0.5 ? 13 : 14;
            return { betType, betTypeStr: betType === 13 ? "BIG" : "SMALL" };
        }
    }

    async getCurrentBetAmount(userId) {
    try {
        const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
        const betSequence = await this.getUserSetting(userId, 'bet_sequence', '100,300,700,1600,3200,7600,16000,32000');
        const amounts = betSequence.split(',').map(x => parseInt(x.trim()));

        console.log(` Getting bet amount for user ${userId}: index=${currentIndex}, sequence=${betSequence}`);

        const actualIndex = currentIndex >= amounts.length ? 0 : currentIndex;
        let amount = amounts[actualIndex] || amounts[0] || 100;

        const userSession = userSessions[userId];
        if (userSession && userSession.gameType) {
            // TRX နဲ့ WINGO နှစ်ခုလုံးအတွက် minimum 100
            if (amount < 100) {
                console.log(` Adjusting amount from ${amount} to 100 (minimum for )`);
                amount = 100;
            }
            
            // amount က 100, 200, 300,... ဖြစ်ရမယ်
            if (amount % 100 !== 0) {
                const adjustedAmount = Math.floor(amount / 100) * 100;
                console.log(`Amount ${amount} is not multiple of 100, adjusting to: ${adjustedAmount}`);
                amount = adjustedAmount;
            }
        }

        if (currentIndex >= amounts.length) {
            await this.saveUserSetting(userId, 'current_bet_index', 0);
            console.log(` Corrected invalid index: ${currentIndex} -> 0`);
        }

        console.log(` Final bet amount: ${amount}K (index: ${actualIndex})`);
        return amount;

    } catch (error) {
        console.error(` Error getting current bet amount for ${userId}:`, error);
        return 100; // Default to 100 on error
    }
}

    async isGameIdAllowed(gameId) {
        try {
            const allowedIds = await this.getAllowedGameIds();
            const gameIdStr = String(gameId).trim();
            const allowedIdsStr = allowedIds.map(id => String(id).trim());
            return allowedIdsStr.includes(gameIdStr);
        } catch (error) {
            console.error(` Error checking if game ID ${gameId} is allowed:`, error);
            return false;
        }
    }

    async getAllowedGameIds() {
        try {
            const results = await this.db.all('SELECT game_id FROM allowed_game_ids ORDER BY added_at DESC');
            return results.map(row => row.game_id);
        } catch (error) {
            console.error(' Error getting allowed game IDs:', error);
            return [];
        }
    }

    async hasUserBetOnIssue(userId, platform, issue) {
        try {
            const result = await this.db.get(
                'SELECT issue FROM pending_bets WHERE user_id = ? AND platform = ? AND issue = ?',
                [userId, platform, issue]
            );
            return result !== undefined;
        } catch (error) {
            console.error(` Error checking if user ${userId} bet on issue ${issue}:`, error);
            return false;
        }
    }

    async savePendingBet(userId, platform, issue, betType, amount) {
        try {
            await this.db.run(
                'INSERT INTO pending_bets (user_id, platform, issue, bet_type, amount) VALUES (?, ?, ?, ?, ?)',
                [userId, platform, issue, betType, amount]
            );
            return true;
        } catch (error) {
            console.error(` Error saving pending bet for user ${userId}:`, error);
            return false;
        }
    }

    async saveUserCredentials(userId, phone, password, platform = 'CKLOTTERY') {
        try {
            await this.db.run(
                'INSERT OR REPLACE INTO users (user_id, phone, password, platform) VALUES (?, ?, ?, ?)',
                [userId, phone, password, platform]
            );
            return true;
        } catch (error) {
            console.error(` Error saving user credentials for ${userId}:`, error);
            return false;
        }
    }

    async saveUserSetting(userId, key, value) {
    try {
        const existing = await this.db.get('SELECT user_id FROM user_settings WHERE user_id = ?', [userId]);
        if (!existing) {
            await this.db.run('INSERT INTO user_settings (user_id) VALUES (?)', [userId]);
        }

        await this.db.run(`UPDATE user_settings SET ${key} = ? WHERE user_id = ?`, [value, userId]);
        return true;
    } catch (error) {
        console.error(` Error saving user setting for ${userId}, key ${key}:`, error);
        return false;
    }
}

// getUserSetting function ကို update လုပ်ပါ (အရင်ကရှိပြီးသားပါ)
async getUserSetting(userId, key, defaultValue = null) {
    try {
        const result = await this.db.get(`SELECT ${key} FROM user_settings WHERE user_id = ?`, [userId]);
        return result ? result[key] : defaultValue;
    } catch (error) {
        console.error(` Error getting user setting for ${userId}, key ${key}:`, error);
        return defaultValue;
    }
}

    async getCurrentBetSequenceIndex(userId) {
        try {
            const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
            return currentIndex;
        } catch (error) {
            console.error(` Error getting current bet sequence index for user ${userId}:`, error);
            return 0;
        }
    }

    async saveBotSession(userId, isRunning = false, totalBets = 0, totalProfit = 0, sessionProfit = 0, sessionLoss = 0) {
        try {
            await this.db.run(
                'INSERT OR REPLACE INTO bot_sessions (user_id, is_running, total_bets, total_profit, session_profit, session_loss, last_activity) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
                [userId, isRunning ? 1 : 0, totalBets, totalProfit, sessionProfit, sessionLoss]
            );
            console.log(` Bot session saved for user ${userId}, running: ${isRunning}`);
            return true;
        } catch (error) {
            console.error(` Error saving bot session for user ${userId}:`, error);
            return false;
        }
    }

    async getBotSession(userId) {
        try {
            const result = await this.db.get(
                'SELECT is_running, total_bets, total_profit, session_profit, session_loss FROM bot_sessions WHERE user_id = ?',
                [userId]
            );

            if (result) {
                return {
                    is_running: Boolean(result.is_running),
                    total_bets: result.total_bets || 0,
                    total_profit: result.total_profit || 0,
                    session_profit: result.session_profit || 0,
                    session_loss: result.session_loss || 0
                };
            }

            return { is_running: false, total_bets: 0, total_profit: 0, session_profit: 0, session_loss: 0 };
        } catch (error) {
            console.error(` Error getting bot session for user ${userId}:`, error);
            return { is_running: false, total_bets: 0, total_profit: 0, session_profit: 0, session_loss: 0 };
        }
    }

    async resetSessionStats(userId) {
        try {
            await this.saveBotSession(userId, false, 0, 0, 0, 0);
            return true;
        } catch (error) {
            console.error(` Error resetting session stats for user ${userId}:`, error);
            return false;
        }
    }

    async setRandomBig(chatId, userId) {
        try {
            await this.saveUserSetting(userId, 'random_betting', 'big');
            await this.clearFormulaPatterns(userId);
            await this.saveUserSetting(userId, 'follow_inverse', 0); // Disable inverse when setting random mode

            await this.bot.sendMessage(chatId, " Random Mode Set\n\nRandom BIG - Always bet BIG\n\nBot will now always bet BIG in auto mode.");
        } catch (error) {
            console.error(` Error setting random big for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, " Error setting random mode. Please try again.");
        }
    }

    async setRandomSmall(chatId, userId) {
        try {
            await this.saveUserSetting(userId, 'random_betting', 'small');
            await this.clearFormulaPatterns(userId);
            await this.saveUserSetting(userId, 'follow_inverse', 0); // Disable inverse when setting random mode

            await this.bot.sendMessage(chatId, " Random Mode Set\n\nRandom SMALL - Always bet SMALL\n\nBot will now always bet SMALL in auto mode.");
        } catch (error) {
            console.error(` Error setting random small for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, " Error setting random mode. Please try again.");
        }
    }

    async setRandomBot(chatId, userId) {
        try {
            await this.saveUserSetting(userId, 'random_betting', 'bot');
            await this.clearFormulaPatterns(userId);
            await this.saveUserSetting(userId, 'follow_inverse', 0); // Disable inverse when setting random mode

            await this.bot.sendMessage(chatId, " Random Mode Set\n\nRandom Bot - Random BIG/SMALL\n\nBot will now randomly choose between BIG and SMALL in auto mode.");
        } catch (error) {
            console.error(` Error setting random bot for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, " Error setting random mode. Please try again.");
        }
    }

    async setFollowBot(chatId, userId) {
        try {
            await this.saveUserSetting(userId, 'random_betting', 'follow');
            await this.clearFormulaPatterns(userId);
            await this.saveUserSetting(userId, 'follow_inverse', 0); // Disable inverse when setting follow mode

            await this.bot.sendMessage(chatId, " Random Mode Set\n\nFollow Bot - Follow Last Result\n\nBot will now follow the last game result in auto mode.");
        } catch (error) {
            console.error(` Error setting follow bot for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, " Error setting random mode. Please try again.");
        }
    }

    async getFormulaPatterns(userId) {
        try {
            const result = await this.db.get(
                'SELECT bs_pattern, colour_pattern, bs_current_index, colour_current_index FROM formula_patterns WHERE user_id = ?',
                [userId]
            );

            if (result) {
                return {
                    bs_pattern: result.bs_pattern || "",
                    colour_pattern: result.colour_pattern || "",
                    bs_current_index: result.bs_current_index || 0,
                    colour_current_index: result.colour_current_index || 0
                };
            }

            return { bs_pattern: "", colour_pattern: "", bs_current_index: 0, colour_current_index: 0 };
        } catch (error) {
            console.error(` Error getting formula patterns for user ${userId}:`, error);
            return { bs_pattern: "", colour_pattern: "", bs_current_index: 0, colour_current_index: 0 };
        }
    }

    async clearFormulaPatterns(userId, patternType = null) {
        try {
            if (patternType === 'bs') {
                await this.db.run('UPDATE formula_patterns SET bs_pattern = "", bs_current_index = 0 WHERE user_id = ?', [userId]);
            } else if (patternType === 'colour') {
                await this.db.run('UPDATE formula_patterns SET colour_pattern = "", colour_current_index = 0 WHERE user_id = ?', [userId]);
            } else {
                await this.db.run('UPDATE formula_patterns SET bs_pattern = "", colour_pattern = "", bs_current_index = 0, colour_current_index = 0 WHERE user_id = ?', [userId]);
            }
            return true;
        } catch (error) {
            console.error(` Error clearing formula patterns for user ${userId}:`, error);
            return false;
        }
    }

    async getBetHistory(userId, platform = null, limit = 10) {
        try {
            if (platform) {
                return await this.db.all(
                    'SELECT platform, issue, bet_type, amount, result, profit_loss, created_at FROM bet_history WHERE user_id = ? AND platform = ? ORDER BY created_at DESC LIMIT ?',
                    [userId, platform, limit]
                );
            } else {
                return await this.db.all(
                    'SELECT platform, issue, bet_type, amount, result, profit_loss, created_at FROM bet_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
                    [userId, limit]
                );
            }
        } catch (error) {
            console.error(` Error getting bet history for user ${userId}:`, error);
            return [];
        }
    }

    async showBotSettings(chatId, userId) {
    try {
        const userSession = this.ensureUserSession(userId);
        const randomMode = await this.getUserSetting(userId, 'random_betting', 'bot');
        const betSequence = await this.getUserSetting(userId, 'bet_sequence', '');
        const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
        const followInverse = await this.getUserSetting(userId, 'follow_inverse', 0);

        let defaultSequence;
        if (userSession.gameType === 'WINGO_30S') {
            defaultSequence = '100,300,700,1600,3200,7600,16000,32000';
        } else if (userSession.gameType === 'TRX_1MIN') {
            defaultSequence = '100,300,700,1600,3200,7600,16000,32000';
        } else if (userSession.gameType === 'WINGO_1MIN') {
            defaultSequence = '100,300,700,1600,3200,7600,16000,32000';
        } else {
            defaultSequence = '100,300,700,1600,3200,7600,16000,32000';
        }

            const currentAmount = await this.getCurrentBetAmount(userId);

            const patternsData = await this.getFormulaPatterns(userId);
            const bsPattern = patternsData.bs_pattern || "Not set";
            const colourPattern = patternsData.colour_pattern || "Not set";

            const profitTarget = await this.getUserSetting(userId, 'profit_target', 0);
            const lossTarget = await this.getUserSetting(userId, 'loss_target', 0);
            const gameType = userSession.gameType || 'WINGO';

            const botSession = await this.getBotSession(userId);

            let modeText;
            let formulaStatus = "";

            // Check if Follow Inverse is enabled first
            if (followInverse) {
                modeText = "Follow Inverse ";
                formulaStatus = "\nFollow Inverse: ACTIVE";
            } else {
                switch(randomMode) {
                    case 'big':
                        modeText = "Random BIG Only";
                        break;
                    case 'small':
                        modeText = "Random SMALL Only";
                        break;
                    case 'bot':
                        modeText = "Random Bot";
                        break;
                    case 'follow':
                        modeText = "Follow Bot";
                        break;
                    case 'bs_formula':
                        modeText = "BS Formula";
                        formulaStatus += `\nBS Formula: ACTIVE (${bsPattern})`;
                        break;
                    case 'colour_formula':
                        modeText = "Colour Formula";
                        formulaStatus += `\nColour Formula: ACTIVE (${colourPattern})`;
                        break;
                    default:
                        modeText = "Random Bot";
                }
            }

            if (bsPattern && bsPattern !== "Not set" && randomMode !== 'bs_formula' && !followInverse) {
                formulaStatus += `\nBS Formula: INACTIVE (${bsPattern})`;
            }
            if (colourPattern && colourPattern !== "Not set" && randomMode !== 'colour_formula' && !followInverse) {
                formulaStatus += `\nColour Formula: INACTIVE (${colourPattern})`;
            }

            const displaySequence = betSequence || defaultSequence;
            const amounts = displaySequence.split(',').map(x => {
                const num = parseInt(x.trim());
                return isNaN(num) ? 0 : num;
            });

            let formattedSequence = "";
            amounts.forEach((amount, index) => {
                if (index === currentIndex) {
                    formattedSequence += `${amount.toLocaleString()}`;
                } else {
                    formattedSequence += `${amount.toLocaleString()}`;
                }
                if (index < amounts.length - 1) {
                    formattedSequence += " -> ";
                }
            });

            const settingsText = `Current Settings:
Betting Mode: ${modeText}
Bet Sequence: ${formattedSequence}
Current Step: ${currentIndex + 1}/${amounts.length}
Current Bet: ${currentAmount.toLocaleString()} K
Bot Status: ${botSession.is_running ? 'RUNNING' : 'STOPPED'}${formulaStatus}

Profit/Loss Targets:
Profit Target: ${profitTarget > 0 ? profitTarget.toLocaleString() + ' K' : 'Disabled'}
Loss Target: ${lossTarget > 0 ? lossTarget.toLocaleString() + ' K' : 'Disabled'}

Choose your betting mode:`;

            await this.bot.sendMessage(chatId, settingsText, {
                reply_markup: this.getBotSettingsKeyboard()
            });
        } catch (error) {
            console.error(` Error showing bot settings for user ${userId}:`, error);
            console.error(' Error details:', error.stack);
            await this.bot.sendMessage(chatId, " Error loading bot settings. Please try again.");
        }
    }

    async showMyBets(chatId, userId) {
    const userSession = this.ensureUserSession(userId);

    if (!userSession.loggedIn) {
        await this.bot.sendMessage(chatId, "Please login to first!");
        return;
    }

    try {
        const platform = userSession.platform || 'CKLOTTERY';
        const myBets = await this.getBetHistory(userId, platform, 10);

        if (!myBets || myBets.length === 0) {
            await this.bot.sendMessage(chatId, "No bet history found for .");
            return;
        }

        const gameType = userSession.gameType || 'WINGO_30S';

        let betsText = `Your Recent Bets (${gameType})\n\n`;

        let totalProfit = 0;
        let winCount = 0;
        let loseCount = 0;

        myBets.forEach((bet, i) => {
            let resultText = "";

            if (bet.result === "WIN") {
                // WIN ဆိုရင် (+196) ပုံစံပြမယ်
                resultText = `WIN (+${bet.profit_loss.toLocaleString()})`;
                winCount++;
                totalProfit += bet.profit_loss;
            } else {
                // LOSE ဆိုရင် (-100) ပုံစံပြမယ်
                resultText = `LOSE (${bet.profit_loss.toLocaleString()})`;
                loseCount++;
                totalProfit += bet.profit_loss;
            }

            const timeStr = bet.created_at.split(' ')[1]?.substring(0, 5) || bet.created_at.substring(11, 16);
            betsText += `${i+1}. ${bet.issue} - ${bet.bet_type} - ${bet.amount.toLocaleString()}K - ${resultText}\n`;
        });

        await this.bot.sendMessage(chatId, betsText);
    } catch (error) {
        console.error(` Error showing my bets for user ${userId}:`, error);
        await this.bot.sendMessage(chatId, " Error getting bet history. Please try again.");
    }
}

    async showBotInfo(chatId, userId) {
    const userSession = this.ensureUserSession(userId);

    try {
        let userInfo = {};
        let balance = 0;
        if (userSession.loggedIn && userSession.apiInstance) {
            balance = await userSession.apiInstance.getBalance();
            userInfo = await userSession.apiInstance.getUserInfo();
        }

        const user_id_display = userInfo.userId || 'N/A';
        // 🔥 PHONE NUMBER MASKING - 09796572086 -> 097******86
        const phone = userSession.phone ? this.maskPhoneNumber(userSession.phone) : 'Not logged in';
        const gameType = userSession.gameType || 'WINGO';

        const botSession = await this.getBotSession(userId);
        const betSequence = await this.getUserSetting(userId, 'bet_sequence', '');
        const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
        const currentAmount = await this.getCurrentBetAmount(userId);

        const patternsData = await this.getFormulaPatterns(userId);
        const bsPattern = patternsData.bs_pattern || "";
        const colourPattern = patternsData.colour_pattern || "";

        const profitTarget = await this.getUserSetting(userId, 'profit_target', 0);
        const lossTarget = await this.getUserSetting(userId, 'loss_target', 0);
        
        // 🔥 NEW: Get crease mode
        const creaseMode = await this.getUserSetting(userId, 'crease_mode', 'none');
        
        // 🔥 NEW: Get follow inverse status
        const followInverse = await this.getUserSetting(userId, 'follow_inverse', 0);
        
        // Crease mode display text
        let creaseModeText = '';
        if (creaseMode === 'loss') {
            creaseModeText = 'Loss Crease';
        } else if (creaseMode === 'win') {
            creaseModeText = 'Win Crease';
        } else {
            creaseModeText = 'Normal';
        }
        
        // Follow inverse display text
        const inverseText = followInverse ? '✅ Enabled (Bet Opposite)' : '❌ Disabled';

        const netProfit = botSession.session_profit - botSession.session_loss;

        let modeText = "";
        if (followInverse) {
            modeText = "Follow Inverse ";
        } else if (bsPattern && bsPattern !== "") {
            modeText = `BS Formula: ${bsPattern}`;
        } else if (colourPattern && colourPattern !== "") {
            modeText = `Colour Formula: ${colourPattern}`;
        } else {
            const randomMode = await this.getUserSetting(userId, 'random_betting', 'bot');
            modeText = {
                'big': "Random BIG Only",
                'small': "Random SMALL Only", 
                'bot': "Random Bot",
                'follow': "Follow Bot"
            }[randomMode] || "Random Bot";
        }

        // 🔥 UPDATED Bot info text with crease mode and follow inverse
        const botInfoText = ` BOT INFORMATION

•User Information:
User ID: ${user_id_display}
Phone: ${phone}
Balance: ${balance.toLocaleString()} K
Game Type: ${gameType}

•Bot Settings:
Betting Mode: ${modeText}
Crease Mode: ${creaseModeText}
Bet Sequence: ${betSequence}
Current Bet: ${currentAmount.toLocaleString()} K (Step ${currentIndex + 1})
Bot Status: ${botSession.is_running ? 'RUNNING 🟢' : 'STOPPED 🔴'}

•Targets:
Profit Target: ${profitTarget > 0 ? profitTarget.toLocaleString() + ' K' : 'Disabled'}
Loss Target: ${lossTarget > 0 ? lossTarget.toLocaleString() + ' K' : 'Disabled'}`;

        await this.bot.sendMessage(chatId, botInfoText);

    } catch (error) {
        console.error(" Error in showBotInfo:", error);
        await this.bot.sendMessage(chatId, " Error loading bot information. Please try again.");
    }
}

    async showBsFormula(chatId, userId) {
        try {
            const patternsData = await this.getFormulaPatterns(userId);
            const bsPattern = patternsData.bs_pattern || "Not set";

            const message = ` BS Formula Settings\n\nCurrent Pattern: ${bsPattern}\n\nChoose an option:`;

            await this.bot.sendMessage(chatId, message, {
                reply_markup: this.getBsPatternKeyboard()
            });
        } catch (error) {
            console.error(` Error showing BS formula for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, " Error loading BS formula settings.");
        }
    }

    async showColourFormula(chatId, userId) {
        try {
            const patternsData = await this.getFormulaPatterns(userId);
            const colourPattern = patternsData.colour_pattern || "Not set";

            const message = ` Colour Formula Settings\n\nCurrent Pattern: ${colourPattern}\n\nChoose an option:`;

            await this.bot.sendMessage(chatId, message, {
                reply_markup: this.getColourPatternKeyboard()
            });
        } catch (error) {
            console.error(` Error showing Colour formula for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, " Error loading Colour formula settings.");
        }
    }

    async viewBsPattern(chatId, userId) {
        try {
            const patternsData = await this.getFormulaPatterns(userId);
            const bsPattern = patternsData.bs_pattern;
            const currentIndex = patternsData.bs_current_index;

            if (!bsPattern) {
                await this.bot.sendMessage(chatId, " No BS Pattern Set!\n\nPlease set a BS pattern first using 'Set BS Pattern'.");
                return;
            }

            const patternArray = bsPattern.split(',');
            let patternDisplay = "";

            patternArray.forEach((betType, index) => {
                if (index === currentIndex) {
                    patternDisplay += `${betType}`;
                } else {
                    patternDisplay += betType;
                }
                if (index < patternArray.length - 1) {
                    patternDisplay += " -> ";
                }
            });

            const patternInfo = ` Current BS Pattern\n\nPattern: ${patternDisplay}\nTotal Steps: ${patternArray.length}\nCurrent Step: ${currentIndex + 1}\n\nNext Bet: ${patternArray[currentIndex] === 'B' ? 'BIG' : 'SMALL'}`;

            await this.bot.sendMessage(chatId, patternInfo);

        } catch (error) {
            console.error(` Error viewing BS pattern for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, " Error viewing BS pattern. Please try again.");
        }
    }

    async viewColourPattern(chatId, userId) {
        try {
            const patternsData = await this.getFormulaPatterns(userId);
            const colourPattern = patternsData.colour_pattern;
            const currentIndex = patternsData.colour_current_index;

            if (!colourPattern) {
                await this.bot.sendMessage(chatId, " No Colour Pattern Set!\n\nPlease set a Colour pattern first using 'Set Colour Pattern'.");
                return;
            }

            const patternArray = colourPattern.split(',');
            let patternDisplay = "";

            patternArray.forEach((colour, index) => {
                if (index === currentIndex) {
                    patternDisplay += `${colour}`;
                } else {
                    patternDisplay += colour;
                }
                if (index < patternArray.length - 1) {
                    patternDisplay += " -> ";
                }
            });

            const colourNames = {
                'G': 'GREEN',
                'R': 'RED', 
                'V': 'VIOLET'
            };

            const patternInfo = ` Current Colour Pattern\n\nPattern: ${patternDisplay}\nTotal Steps: ${patternArray.length}\nCurrent Step: ${currentIndex + 1}\n\nNext Bet: ${colourNames[patternArray[currentIndex]] || patternArray[currentIndex]}`;

            await this.bot.sendMessage(chatId, patternInfo);

        } catch (error) {
            console.error(` Error viewing Colour pattern for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, " Error viewing Colour pattern. Please try again.");
        }
    }

    async handleSetBetSequence(chatId, userId, text) {
    try {
        const userSession = this.ensureUserSession(userId);
        const gameType = userSession.gameType || 'WINGO_30S';

        // Trim and clean input
        let betSequence = text.trim();
        
        // Remove any spaces (allow spaces between numbers)
        betSequence = betSequence.replace(/\s/g, '');
        
        // Check if only contains numbers, commas, and maybe Burmese numbers
        // Convert Burmese numbers to English numbers if any
        const burmeseToEnglish = {
            '၀': '0', '၁': '1', '၂': '2', '၃': '3', '၄': '4',
            '၅': '5', '၆': '6', '၇': '7', '၈': '8', '၉': '9'
        };
        
        let convertedSequence = '';
        for (let char of betSequence) {
            if (burmeseToEnglish[char]) {
                convertedSequence += burmeseToEnglish[char];
            } else {
                convertedSequence += char;
            }
        }
        
        betSequence = convertedSequence;
        
        // Check if contains only numbers, commas, and dots
        const validPattern = /^[\d,]+$/;
        if (!validPattern.test(betSequence)) {
            await this.bot.sendMessage(chatId, 
                `❌ Invalid format!`);
            return;
        }

        const amounts = betSequence.split(',').map(x => {
            const num = parseInt(x.trim());
            return isNaN(num) ? null : num;
        }).filter(x => x !== null);

        if (amounts.length === 0) {
            await this.bot.sendMessage(chatId, 
                `❌ Invalid bet sequence!\n\nPlease enter valid numbers separated by commas.\n\nExample: 100,300,700,1600`);
            return;
        }

        // Check minimum amount (100)
        const invalidAmounts = amounts.filter(amount => amount < 100);
        if (invalidAmounts.length > 0) {
            await this.bot.sendMessage(chatId, 
                `❌ Invalid bet amounts!`);
            return;
        }

        // Check if all amounts are positive
        if (amounts.some(amount => amount <= 0)) {
            await this.bot.sendMessage(chatId, 
                `❌ Invalid bet amounts!`);
            return;
        }

        // Check if amounts are multiples of 100
        const invalidMultiples = amounts.filter(amount => amount % 100 !== 0);
        if (invalidMultiples.length > 0) {
            await this.bot.sendMessage(chatId, 
                `❌ Invalid bet amounts!`);
            return;
        }

        // Generate validation message with recommended sequence
        let validationMessage = "";
        if (gameType === 'WINGO_30S') {
            const recommendedAmounts = [100, 300, 700, 1600, 3200, 7600, 16000, 32000];
            validationMessage = `\n\nWINGO 30S Recommended: ${recommendedAmounts.join(', ')}`;
        } else if (gameType === 'TRX_1MIN') {
            const recommendedAmounts = [100, 300, 700, 1600, 3200, 7600, 16000, 32000];
            validationMessage = `\n\nTRX 1MIN Recommended: ${recommendedAmounts.join(', ')}`;
        } else if (gameType === 'WINGO_1MIN') {
            const recommendedAmounts = [100, 300, 700, 1600, 3200, 7600, 16000, 32000];
            validationMessage = `\n\nWINGO 1MIN Recommended: ${recommendedAmounts.join(', ')}`;
        }

        // Save the bet sequence
        await this.saveUserSetting(userId, 'bet_sequence', betSequence);
        await this.saveUserSetting(userId, 'current_bet_index', 0);

        const currentAmount = amounts[0];

        const successMessage = `✅ Bet Sequence Updated!\n\nGame Type: ${gameType}\nNew Sequence: ${betSequence}\nCurrent Bet: ${currentAmount.toLocaleString()} K (Step 1)${validationMessage}\n\nBot will now use this sequence for auto betting.`;

        await this.bot.sendMessage(chatId, successMessage, {
            reply_markup: this.getBotSettingsKeyboard()
        });

        userSession.step = 'main';

    } catch (error) {
        console.error(` Error setting bet sequence for user ${userId}:`, error);
        await this.bot.sendMessage(chatId, 
            `❌ Error setting bet sequence.`);
    }
}

    async handleSetProfitTarget(chatId, userId, text) {
        try {
            const userSession = this.ensureUserSession(userId);

            const profitTarget = parseInt(text.trim());

            if (isNaN(profitTarget) || profitTarget < 0) {
                await this.bot.sendMessage(chatId, " Invalid profit target!\n\nPlease enter a valid positive number.\nEnter 0 to disable profit target.");
                return;
            }

            await this.saveUserSetting(userId, 'profit_target', profitTarget);

            let message;
            if (profitTarget === 0) {
                message = " Profit Target Disabled!";
            } else {
                message = ` Profit Target Set!\n\nTarget: ${profitTarget.toLocaleString()} K\n\nBot will automatically stop when profit reaches ${profitTarget.toLocaleString()} K.`;
            }

            await this.bot.sendMessage(chatId, message, {
                reply_markup: this.getBotSettingsKeyboard()
            });

            userSession.step = 'main';

        } catch (error) {
            console.error(` Error setting profit target for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, " Error setting profit target.\n\nPlease try again.");
        }
    }

    async handleSetLossTarget(chatId, userId, text) {
        try {
            const userSession = this.ensureUserSession(userId);

            const lossTarget = parseInt(text.trim());

            if (isNaN(lossTarget) || lossTarget < 0) {
                await this.bot.sendMessage(chatId, " Invalid loss target!");
                return;
            }

            await this.saveUserSetting(userId, 'loss_target', lossTarget);

            let message;
            if (lossTarget === 0) {
                message = " Loss Target Disabled!";
            } else {
                message = ` Loss Target Set!\n\nTarget: ${lossTarget.toLocaleString()} K\n\nBot will automatically stop when loss reaches ${lossTarget.toLocaleString()} K.`;
            }

            await this.bot.sendMessage(chatId, message, {
                reply_markup: this.getBotSettingsKeyboard()
            });

            userSession.step = 'main';

        } catch (error) {
            console.error(` Error setting loss target for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, " Error setting loss target.\n\nPlease try again.");
        }
    }

    async handleSetBsPattern(chatId, userId, text) {
        try {
            const userSession = this.ensureUserSession(userId);

            const pattern = text.trim().toUpperCase();
            const validPattern = /^[BS,]+$/.test(pattern);

            if (!validPattern || pattern.length === 0) {
                await this.bot.sendMessage(chatId, " Invalid BS Pattern!");
                return;
            }

            const patternArray = pattern.split(',').map(p => p.trim()).filter(p => p === 'B' || p === 'S');

            if (patternArray.length === 0) {
                await this.bot.sendMessage(chatId, " Invalid BS Pattern!");
                return;
            }

            const cleanPattern = patternArray.join(',');

            await this.saveBsPattern(userId, cleanPattern);

            await this.saveUserSetting(userId, 'random_betting', 'bs_formula');
            await this.saveUserSetting(userId, 'follow_inverse', 0); // Disable inverse when using formula

            const successMessage = ` BS Pattern Set Successfully!\n\nPattern: ${cleanPattern}\nLength: ${patternArray.length} steps\nCurrent Index: 1\n\nBot will now use BS Formula pattern for auto betting.`;

            await this.bot.sendMessage(chatId, successMessage, {
                reply_markup: this.getBsPatternKeyboard()
            });

            userSession.step = 'main';

        } catch (error) {
            console.error(` Error setting BS pattern for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, " Error setting BS pattern.\n\nPlease try again.");
        }
    }

    async saveBsPattern(userId, pattern) {
        try {
            const existing = await this.db.get('SELECT user_id FROM formula_patterns WHERE user_id = ?', [userId]);

            if (existing) {
                await this.db.run(
                    'UPDATE formula_patterns SET bs_pattern = ?, bs_current_index = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                    [pattern, userId]
                );
            } else {
                await this.db.run(
                    'INSERT INTO formula_patterns (user_id, bs_pattern, bs_current_index) VALUES (?, ?, 0)',
                    [userId, pattern]
                );
            }
            return true;
        } catch (error) {
            console.error(` Error saving BS pattern for user ${userId}:`, error);
            return false;
        }
    }

    async handleSetColourPattern(chatId, userId, text) {
        try {
            const userSession = this.ensureUserSession(userId);

            const pattern = text.trim().toUpperCase();
            const validPattern = /^[GRV,]+$/.test(pattern);

            if (!validPattern || pattern.length === 0) {
                await this.bot.sendMessage(chatId, " Invalid Colour Pattern!");
                return;
            }

            const patternArray = pattern.split(',').map(p => p.trim()).filter(p => p === 'G' || p === 'R' || p === 'V');

            if (patternArray.length === 0) {
                await this.bot.sendMessage(chatId, " Invalid Colour Pattern!");
                return;
            }

            const cleanPattern = patternArray.join(',');

            await this.saveColourPattern(userId, cleanPattern);

            await this.saveUserSetting(userId, 'random_betting', 'colour_formula');
            await this.saveUserSetting(userId, 'follow_inverse', 0); // Disable inverse when using formula

            const successMessage = ` Colour Pattern Set Successfully!\n\nPattern: ${cleanPattern}\nLength: ${patternArray.length} steps\nCurrent Index: 1\n\nBot will now use Colour Formula pattern for auto betting.`;

            await this.bot.sendMessage(chatId, successMessage, {
                reply_markup: this.getColourPatternKeyboard()
            });

            userSession.step = 'main';

        } catch (error) {
            console.error(` Error setting Colour pattern for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, " Error setting Colour pattern.\n\nPlease try again.");
        }
    }

    async saveColourPattern(userId, pattern) {
        try {
            const existing = await this.db.get('SELECT user_id FROM formula_patterns WHERE user_id = ?', [userId]);

            if (existing) {
                await this.db.run(
                    'UPDATE formula_patterns SET colour_pattern = ?, colour_current_index = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                    [pattern, userId]
                );
            } else {
                await this.db.run(
                    'INSERT INTO formula_patterns (user_id, colour_pattern, colour_current_index) VALUES (?, ?, 0)',
                    [userId, pattern]
                );
            }
            return true;
        } catch (error) {
            console.error(` Error saving Colour pattern for user ${userId}:`, error);
            return false;
        }
    }

    async clearBsPattern(chatId, userId) {
        try {
            await this.clearFormulaPatterns(userId, 'bs');
            await this.saveUserSetting(userId, 'random_betting', 'bot');

            await this.bot.sendMessage(chatId, " BS Pattern Cleared!", {
                reply_markup: this.getBsPatternKeyboard()
            });

        } catch (error) {
            console.error(` Error clearing BS pattern for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, " Error clearing BS pattern. Please try again.");
        }
    }

    async clearColourPattern(chatId, userId) {
        try {
            await this.clearFormulaPatterns(userId, 'colour');
            await this.saveUserSetting(userId, 'random_betting', 'bot');

            await this.bot.sendMessage(chatId, " Colour Pattern Cleared!", {
                reply_markup: this.getColourPatternKeyboard()
            });

        } catch (error) {
            console.error(` Error clearing Colour pattern for user ${userId}:`, error);
            await this.bot.sendMessage(chatId, " Error clearing Colour pattern. Please try again.");
        }
    }

    async handleAddGameId(msg, match) {
        const chatId = msg.chat.id;
        const userId = String(chatId);

        if (userId !== ADMIN_USER_ID) {
            await this.bot.sendMessage(chatId, "You are not authorized to use this command.");
            return;
        }

        const gameIdsInput = match[1];
        const gameIds = gameIdsInput.split(',').map(id => id.trim()).filter(id => /^\d+$/.test(id));

        if (gameIds.length === 0) {
            await this.bot.sendMessage(chatId, " Invalid format! Use: /aid game_id1,game_id2\nExample: /aid 102310,864480");
            return;
        }

        try {
            for (const gameId of gameIds) {
                await this.db.run(
                    'INSERT OR REPLACE INTO allowed_game_ids (game_id, added_by) VALUES (?, ?)',
                    [gameId, userId]
                );
            }

            await this.bot.sendMessage(chatId, ` Game IDs added successfully!\n\nAdded: ${gameIds.join(', ')}\nTotal: ${gameIds.length} game IDs`);

        } catch (error) {
            console.error(` Error adding game IDs:`, error);
            await this.bot.sendMessage(chatId, " Failed to add game IDs. Please try again.");
        }
    }

    async handleRemoveGameId(msg, match) {
        const chatId = msg.chat.id;
        const userId = String(chatId);

        if (userId !== ADMIN_USER_ID) {
            await this.bot.sendMessage(chatId, "You are not authorized to use this command.");
            return;
        }

        const gameId = match[1];
        try {
            await this.db.run('DELETE FROM allowed_game_ids WHERE game_id = ?', [gameId]);
            await this.bot.sendMessage(chatId, ` Game ID '${gameId}' removed successfully!`);
        } catch (error) {
            console.error(` Error removing game ID ${gameId}:`, error);
            await this.bot.sendMessage(chatId, " Failed to remove game ID.");
        }
    }

    async handleListGameIds(msg) {
        const chatId = msg.chat.id;
        const userId = String(chatId);

        if (userId !== ADMIN_USER_ID) {
            await this.bot.sendMessage(chatId, "You are not authorized to use this command.");
            return;
        }

        try {
            const gameIds = await this.getAllowedGameIds();
            if (gameIds.length === 0) {
                await this.bot.sendMessage(chatId, "No game IDs found for .");
                return;
            }

            let gameIdsText = " Allowed Game IDs:\n\n";
            gameIds.forEach((gameId, i) => {
                gameIdsText += `${i+1}. ${gameId}\n`;
            });

            gameIdsText += `\nTotal: ${gameIds.length} game IDs\n`;
            await this.bot.sendMessage(chatId, gameIdsText);
        } catch (error) {
            console.error(` Error listing game IDs:`, error);
            await this.bot.sendMessage(chatId, " Error getting game IDs.");
        }
    }

    async handleGameIdStats(msg) {
        const chatId = msg.chat.id;
        const userId = String(chatId);

        if (userId !== ADMIN_USER_ID) {
            await this.bot.sendMessage(chatId, "You are not authorized to use this command.");
            return;
        }

        try {
            const gameIds = await this.getAllowedGameIds();
            const totalIds = gameIds.length;

            let statsText = ` Game ID Statistics\n\nTotal Allowed Game IDs: ${totalIds}\n\nRecent Game IDs:\n`;

            const recentIds = gameIds.slice(0, 10);
            recentIds.forEach((gameId, i) => {
                statsText += `${i+1}. ${gameId}\n`;
            });

            if (totalIds > 10) {
                statsText += `\n... and ${totalIds - 10} more`;
            }

            statsText += `\n\nLast Updated: ${getMyanmarTime()}`;

            await this.bot.sendMessage(chatId, statsText);
        } catch (error) {
            console.error(` Error getting game ID stats:`, error);
            await this.bot.sendMessage(chatId, " Error getting game ID statistics.");
        }
    }

    async handleBroadcastMessage(msg, match) {
        const chatId = msg.chat.id;
        const userId = String(chatId);

        if (userId !== ADMIN_USER_ID) {
            await this.bot.sendMessage(chatId, "You are not authorized to use this command.");
            return;
        }

        const message = match[1];
        if (!message) {
            await this.bot.sendMessage(chatId, "Please provide a message to broadcast.\nUsage: /broadcast Your message here");
            return;
        }

        try {
            const users = await this.db.all('SELECT user_id FROM users');
            const totalUsers = users.length;

            if (totalUsers === 0) {
                await this.bot.sendMessage(chatId, "No users found to broadcast for .");
                return;
            }

            const loadingMsg = await this.bot.sendMessage(chatId, `Broadcasting message to ${totalUsers}  users...\n\n0/${totalUsers} (0%)`);

            let successCount = 0;
            let failCount = 0;

            for (let i = 0; i < users.length; i++) {
                const user = users[i];
                try {
                    await this.bot.sendMessage(user.user_id, `📢 ** BROADCAST MESSAGE** 📢\n\n${message}\n\n_From Admin_`, {
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true
                    });
                    successCount++;

                    if (i % 10 === 0 || i === users.length - 1) {
                        const progress = Math.floor((i + 1) / totalUsers * 100);
                        await this.bot.editMessageText(
                            `Broadcasting message to ${totalUsers}  users...\n\n${i + 1}/${totalUsers} (${progress}%)\n✅ Success: ${successCount}\n❌ Failed: ${failCount}`,
                            {
                                chat_id: chatId,
                                message_id: loadingMsg.message_id
                            }
                        );
                    }

                    await new Promise(resolve => setTimeout(resolve, 100));

                } catch (error) {
                    failCount++;
                    console.error(` Failed to send broadcast to user ${user.user_id}:`, error.message);
                }
            }

            const resultText = `📢 ** BROADCAST COMPLETED** 📢\n\n✅ Successfully sent to: ${successCount} users\n❌ Failed to send: ${failCount} users\n📊 Total  users: ${totalUsers}\n📝 Message length: ${message.length} characters\n⏰ Sent at: ${getMyanmarTime()}`;

            await this.bot.editMessageText(resultText, {
                chat_id: chatId,
                message_id: loadingMsg.message_id,
                parse_mode: 'Markdown'
            });

        } catch (error) {
            console.error(' Broadcast error:', error);
            await this.bot.sendMessage(chatId, ` Broadcast failed: ${error.message}`);
        }
    }

    async handleBroadcastActive(msg, match) {
        const chatId = msg.chat.id;
        const userId = String(chatId);

        if (userId !== ADMIN_USER_ID) {
            await this.bot.sendMessage(chatId, "You are not authorized to use this command.");
            return;
        }

        const message = match[1];
        if (!message) {
            await this.bot.sendMessage(chatId, "Please provide a message to broadcast.\nUsage: /msg Your message here");
            return;
        }

        try {
            const activeUsers = await this.db.all(`
                SELECT DISTINCT user_id 
                FROM bot_sessions 
                WHERE is_running = 1 
                OR last_activity > datetime('now', '-1 hour')
            `);

            const totalActiveUsers = activeUsers.length;

            if (totalActiveUsers === 0) {
                await this.bot.sendMessage(chatId, "No active  users found.");
                return;
            }

            const loadingMsg = await this.bot.sendMessage(chatId, `Broadcasting to ${totalActiveUsers} active  users...\n\n0/${totalActiveUsers} (0%)`);

            let successCount = 0;
            let failCount = 0;

            for (let i = 0; i < activeUsers.length; i++) {
                const user = activeUsers[i];
                try {
                    await this.bot.sendMessage(user.user_id, `${message}`, {
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true
                    });
                    successCount++;

                    if (i % 5 === 0 || i === activeUsers.length - 1) {
                        const progress = Math.floor((i + 1) / totalActiveUsers * 100);
                        await this.bot.editMessageText(
                            `Broadcasting to ${totalActiveUsers} active  users...\n\n${i + 1}/${totalActiveUsers} (${progress}%)\n✅ Success: ${successCount}\n❌ Failed: ${failCount}`,
                            {
                                chat_id: chatId,
                                message_id: loadingMsg.message_id
                            }
                        );
                    }

                    await new Promise(resolve => setTimeout(resolve, 150));

                } catch (error) {
                    failCount++;
                    console.error(` Failed to send to active user ${user.user_id}:`, error.message);
                }
            }

            const resultText = `📢** ACTIVE BROADCAST COMPLETED**\n\n✅ Successfully sent to: ${successCount} active users\n❌ Failed to send: ${failCount} users\nTotal active  users: ${totalActiveUsers}\nSent at: ${getMyanmarTime()}`;

            await this.bot.editMessageText(resultText, {
                chat_id: chatId,
                message_id: loadingMsg.message_id,
                parse_mode: 'Markdown'
            });

        } catch (error) {
            console.error(' Active broadcast error:', error);
            await this.bot.sendMessage(chatId, ` Active broadcast failed: ${error.message}`);
        }
    }
}

console.log(" Auto Bot starting...");
console.log("Platform:  ONLY");
console.log("Game ID Restriction System: ENABLED");
console.log("Admin Commands: /aid, /rid, /ids, /gats");
console.log("Admin Broadcast: /broadcast, /msg");
console.log(`Admin User ID: ${ADMIN_USER_ID}`);
console.log("Features: Wait for Win/Loss before next bet");
console.log("Modes: BIG Only, SMALL Only, Random Bot, Follow Bot");
console.log("FOLLOW INVERSE MODE: Bet opposite of last result");
console.log("BS Formula Pattern Betting System (B,S only)");
console.log("Colour Formula Pattern Betting System (G,R,V only)");
console.log("Available Game Types:");
console.log("  • WINGO 1 MIN - TypeId: 1 (Supports BIG/SMALL + Colour)");
console.log("  • WINGO 30S - TypeId: 30 (Supports BIG/SMALL + Colour)");
console.log("  • TRX 1 MIN - TypeId: 13 (Supports BIG/SMALL only)");
console.log("Bet Sequences:");
console.log("  • WINGO 1 MIN: 100,300,700,1600,3200,7600,16000,32000");
console.log("  • WINGO 30S: 100,200,400,800,1600,3200,6400,12800");
console.log("  • TRX 1 MIN: 100,300,700,1600,3200,7600,16000,32000");
console.log("Minimum Bet Amount: 100 for all games");
console.log("Profit/Loss Target System");
console.log("Auto Statistics Tracking");
console.log("Colour Betting Support: WINGO 1 MIN and WINGO 30S only");
console.log("Win/Loss Messages: ENABLED");
console.log("Myanmar Time System: ENABLED");
console.log("Press Ctrl+C to stop.");
const bot = new AutoLotteryBot();

process.on('SIGINT', () => {
    console.log(' Bot shutting down...');
    process.exit();
});

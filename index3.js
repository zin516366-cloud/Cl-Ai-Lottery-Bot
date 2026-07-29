const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const crypto = require('crypto');

// Bot configuration
const BOT_TOKEN = "8775347275:AAGQb372daJfle2svH1Q7aXY8AftIHYHXbE";
const CHANNEL_USERNAME = "@https://t.me/xearningfreehack";
const CHANNEL_LINK = "https://t.me/xearningfreehack";
const ADMIN_USER_ID = "8370471165";

// API endpoints
const API_ENDPOINTS = {
    "777": "https://api.bigwinqaz.com/api/webapi/"
};

// Colour Bet Types
const COLOUR_BET_TYPES = {
    "RED": 10,
    "GREEN": 11,
    "VIOLET": 12
};

// Database setup
const DB_NAME = "auto_bot.db";

// Global storage
const userSessions = {};
const issueCheckers = {};
const autoBettingTasks = {};
const waitingForResults = {};
const processedIssues = {};

// Myanmar time function (without moment-timezone)
const getMyanmarTime = () => {
    const now = new Date();
    // Myanmar is UTC+6:30
    const myanmarOffset = 6.5 * 60 * 60 * 1000; // 6.5 hours in milliseconds
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
                platform TEXT DEFAULT '777',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER PRIMARY KEY,
                bet_amount INTEGER DEFAULT 100,
                auto_login BOOLEAN DEFAULT 1,
                bet_sequence TEXT DEFAULT '100,300,700,1600,3200,7600,16000,32000',
                current_bet_index INTEGER DEFAULT 0,
                platform TEXT DEFAULT '777',
                auto_betting BOOLEAN DEFAULT 0,
                random_betting TEXT DEFAULT 'bot',
                profit_target INTEGER DEFAULT 0,
                loss_target INTEGER DEFAULT 0,
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
            )`,
            `CREATE TABLE IF NOT EXISTS sl_patterns (
                user_id INTEGER PRIMARY KEY,
                pattern TEXT DEFAULT '1,2,3,4,5',
                current_sl INTEGER DEFAULT 1,
                current_index INTEGER DEFAULT 0,
                wait_loss_count INTEGER DEFAULT 0,
                bet_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS sl_bet_sessions (
                user_id INTEGER PRIMARY KEY,
                is_wait_mode BOOLEAN DEFAULT 0,
                wait_bet_type TEXT DEFAULT '',
                wait_issue TEXT DEFAULT '',
                wait_amount INTEGER DEFAULT 0,
                wait_total_profit INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        tables.forEach(table => {
            this.db.run(table, (err) => {
                if (err) {
                    console.error('Error creating table:', err);
                }
            });
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
    constructor(platform = '777') {
        this.platform = platform;
        this.baseUrl = API_ENDPOINTS[platform];
        this.token = '';
        this.headers = {
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json;charset=UTF-8",
            "Origin": "https://www.bigwinqaz.com",
            "Referer": "https://www.bigwinqaz.com/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        };
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
            const body = {
                "phonetype": -1,
                "language": 0,
                "logintype": "mobile",
                "random": "9078efc98754430e92e51da59eb2563c",
                "username": `95${phone}`,
                "pwd": password,
                "timestamp": Math.floor(Date.now() / 1000)
            };

            body.signature = this.signMd5(body);

            const response = await axios.post(`${this.baseUrl}Login`, body, {
                headers: this.headers,
                timeout: 30000
            });

            if (response.status === 200) {
                const result = response.data;
                if (result.msgCode === 0) {
                    const tokenData = result.data || {};
                    this.token = `${tokenData.tokenHeader || ''}${tokenData.token || ''}`;
                    this.headers.Authorization = this.token;
                    return { success: true, message: "Login successful", token: this.token };
                } else {
                    return { success: false, message: result.msg || "Login failed", token: "" };
                }
            } else {
                return { success: false, message: `API connection failed: ${response.status}`, token: "" };
            }
        } catch (error) {
            return { success: false, message: `Login error: ${error.message}`, token: "" };
        }
    }

    async getCurrentIssue() {
        try {
            const body = {
                "typeId": 1,
                "language": 0,
                "random": "b05034ba4a2642009350ee863f29e2e9",
                "timestamp": Math.floor(Date.now() / 1000)
            };
            body.signature = this.signMd5(body);

            const response = await axios.post(`${this.baseUrl}GetGameIssue`, body, {
                headers: this.headers,
                timeout: 10000
            });

            if (response.status === 200) {
                const result = response.data;
                if (result.msgCode === 0) {
                    return result.data?.issueNumber || '';
                }
            }
            return "";
        } catch (error) {
            return "";
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
                if (result.msgCode === 0) {
                    return result.data?.amount || 0;
                }
            }
            return 0;
        } catch (error) {
            return 0;
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
                if (result.msgCode === 0) {
                    return result.data || {};
                }
            }
            return {};
        } catch (error) {
            return {};
        }
    }

    async placeBet(amount, betType) {
    try {
        const issueId = await this.getCurrentIssue();
        if (!issueId) {
            return { success: false, message: "Failed to get current issue", issueId: "", potentialProfit: 0 };
        }

        // Platform-specific bet amount calculation
        let requestBody;
        
        if (this.platform === '6lottery') {
            // 6 Lottery - use total amount directly in amount field
            requestBody = {
                "typeId": 1,
                "issuenumber": issueId,
                "language": 0,
                "gameType": 0, // Colour bets always use gameType 0
                "amount": amount, // Total amount directly
                "betCount": 1,   // Always 1 for 6 Lottery
                "selectType": betType,
                "random": this.randomKey(),
                "timestamp": Math.floor(Date.now() / 1000)
            };
        } else {
            // 777 platform calculation (original)
            const baseAmount = amount < 10000 ? 10 : Math.pow(10, amount.toString().length - 2);
            const betCount = Math.floor(amount / baseAmount);
            const isColourBet = [10, 11, 12].includes(betType);
            
            requestBody = {
                "typeId": 1,
                "issuenumber": issueId,
                "language": 0,
                "gameType": isColourBet ? 0 : 2,
                "amount": baseAmount,
                "betCount": betCount,
                "selectType": betType,
                "random": this.randomKey(),
                "timestamp": Math.floor(Date.now() / 1000)
            };
        }

        requestBody.signature = this.signMd5(requestBody);

        console.log(`Betting details - Platform: ${this.platform}, Amount: ${amount}, Type: ${betType}`);
        console.log('Request Body:', JSON.stringify(requestBody));

        const response = await axios.post(`${this.baseUrl}GameBetting`, requestBody, {
            headers: this.headers,
            timeout: 10000
        });

        console.log('API Response:', JSON.stringify(response.data));

        if (response.status === 200) {
            const result = response.data;
            if (result.code === 0 || result.msgCode === 0) {
                let potentialProfit;
                if (betType === 10) { // RED
                    potentialProfit = Math.floor(amount * 0.96);
                } else if (betType === 11) { // GREEN
                    potentialProfit = Math.floor(amount * 0.96);
                } else if (betType === 12) { // VIOLET
                    potentialProfit = Math.floor(amount * 0.44);
                } else {
                    potentialProfit = Math.floor(amount * 0.96);
                }
                
                return { success: true, message: "Bet placed successfully", issueId, potentialProfit, actualAmount: amount };
            } else {
                const errorMsg = result.msg || 'Bet failed';
                console.log('API Error:', errorMsg, 'Full response:', result);
                return { success: false, message: errorMsg, issueId, potentialProfit: 0 };
            }
        }
        return { success: false, message: `API connection failed: ${response.status}`, issueId, potentialProfit: 0 };
    } catch (error) {
        console.log('Betting Error:', error.message);
        return { success: false, message: `Bet error: ${error.message}`, issueId: "", potentialProfit: 0 };
    }
}

    async getRecentResults(count = 10) {
        try {
            const body = {
                "pageNo": 1,
                "pageSize": count,
                "language": 0,
                "typeId": 1,
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
                if (result.msgCode === 0) {
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
        } catch (error) {
            return [];
        }
    }
}

class AutoLotteryBot {
    constructor() {
        this.bot = new TelegramBot(BOT_TOKEN, { polling: true });
        this.db = new Database();
        this.setupHandlers();
        console.log("Auto Lottery Bot initialized successfully!");
    }

    setupHandlers() {
        // Start command
        this.bot.onText(/\/start/, (msg) => this.handleStart(msg));

        // Admin commands
        this.bot.onText(/\/aid (.+)/, (msg, match) => this.handleAddGameId(msg, match));
        this.bot.onText(/\/rid (.+)/, (msg, match) => this.handleRemoveGameId(msg, match));
        this.bot.onText(/\/ids/, (msg) => this.handleListGameIds(msg));
        this.bot.onText(/\/gats/, (msg) => this.handleGameIdStats(msg));
        this.bot.onText(/\/broadcast (.+)/, (msg, match) => this.handleBroadcastMessage(msg, match));
        this.bot.onText(/\/msg (.+)/, (msg, match) => this.handleBroadcastActive(msg, match));

        // Callback queries
        this.bot.on('callback_query', (query) => this.handleCallbackQuery(query));

        // Message handler
        this.bot.on('message', (msg) => {
            if (msg.text && !msg.text.startsWith('/')) {
                this.handleMessage(msg);
            }
        });

        // Error handler
        this.bot.on('polling_error', (error) => {
            console.error('Polling error:', error);
        });
    }

    async handleStart(msg) {
        const chatId = msg.chat.id;
        const userId = String(chatId);
        
        console.log(`User ${userId} started the bot`);

        // Initialize user session
        userSessions[userId] = {
            step: 'main',
            phone: '',
            password: '',
            platform: '777',
            loggedIn: false,
            apiInstance: null
        };

        const welcomeText = `Auto Lottery Bot

Welcome ${msg.from.first_name}!

Auto Bot Features:
- Random BIG Betting
- Random SMALL Betting  
- Random BIG/SMALL Betting
- Follow Bot (Follow Last Result)
- BS Formula Pattern Betting (B,S only)
- Colour Formula Pattern Betting (G,R,V only)
- SL Layer Pattern Betting
- Bot Statistics Tracking
- Auto Result Checking
- Profit/Loss Targets
- Colour Betting (RED, GREEN, VIOLET)

Platform Support:
- 777 Big Win  

Manual Features:
- Real-time Balance
- Game Results & History

Press Run Bot to start auto betting!`;

        await this.bot.sendMessage(chatId, welcomeText, {
            reply_markup: this.getMainKeyboard()
        });
    }

    getMainKeyboard() {
        return {
            keyboard: [
                [{ text: "Login" }],
                [{ text: "Balance" }, { text: "Results" }],
                [{ text: "Bet BIG" }, { text: "Bet SMALL" }],
                [{ text: "Bet RED" }, { text: "Bet GREEN" }, { text: "Bet VIOLET" }],
                [{ text: "Bot Settings" }, { text: "My Bets" }],
                [{ text: "SL Layer" }, { text: "Bot Info" }],
                [{ text: "Run Bot" }, { text: "Stop Bot" }]
            ],
            resize_keyboard: true
        };
    }

    getBotSettingsKeyboard() {
        return {
            keyboard: [
                [{ text: "Random BIG" }, { text: "Random SMALL" }],
                [{ text: "Random Bot" }, { text: "Follow Bot" }],
                [{ text: "BS Formula" }, { text: "Colour Formula" }],
                [{ text: "Bot Stats" }, { text: "Set Bet Sequence" }],
                [{ text: "Profit Target" }, { text: "Loss Target" }],
                [{ text: "Reset Stats" }, { text: "Main Menu" }]
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

    getSlLayerKeyboard() {
        return {
            keyboard: [
                [{ text: "Set SL Pattern" }, { text: "View SL Pattern" }],
                [{ text: "Reset SL Pattern" }, { text: "SL Stats" }],
                [{ text: "Main Menu" }]
            ],
            resize_keyboard: true
        };
    }

    async handleCallbackQuery(query) {
        const chatId = query.message.chat.id;
        const userId = String(chatId);

        console.log(`Callback query: ${query.data} from user ${userId}`);

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

        console.log(`User ${userId} sent: ${text}`);

        if (!userSessions[userId]) {
            userSessions[userId] = {
                step: 'main',
                phone: '',
                password: '',
                platform: '777',
                loggedIn: false,
                apiInstance: null
            };
        }

        const userSession = userSessions[userId];

        // Handle different steps
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

            case 'set_sl_pattern':
                await this.handleSetSlPattern(chatId, userId, text);
                break;

            default:
                // Handle button commands
                await this.handleButtonCommand(chatId, userId, text);
        }
    }

    async handleButtonCommand(chatId, userId, text) {
        console.log(`Handling button command: '${text}' for user ${userId}`);

        const userSession = userSessions[userId];

        // Main Menu buttons
        switch (text) {
            case "Login":
                await this.handleBigwinLogin(chatId, userId);
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

            case "SL Layer":
                await this.showSlLayer(chatId, userId);
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

            // Login menu buttons
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

            // Bot Settings buttons
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

            case "BS Formula":
                await this.showBsFormula(chatId, userId);
                break;

            case "Colour Formula":
                await this.showColourFormula(chatId, userId);
                break;

            case "Bot Stats":
                await this.showBotStats(chatId, userId);
                break;

            case "Set Bet Sequence":
                userSession.step = 'set_bet_sequence';
                const currentSequence = await this.getUserSetting(userId, 'bet_sequence', '100,300,700,1600,3200,7600,16000,32000');
                await this.bot.sendMessage(chatId, `Current bet sequence: ${currentSequence}\nEnter new bet sequence (comma separated e.g., 100,300,700,1600,3200,7600,16000,32000):`);
                break;

            case "Profit Target":
                userSession.step = 'set_profit_target';
                const currentProfitTarget = await this.getUserSetting(userId, 'profit_target', 0);
                await this.bot.sendMessage(chatId, `Set Profit Target\n\nCurrent target: ${currentProfitTarget.toLocaleString()} K\n\nPlease enter the profit target amount (in K):\nExample: 1000 (for 1000 K profit target)\nEnter 0 to disable profit target`);
                break;

            case "Loss Target":
                userSession.step = 'set_loss_target';
                const currentLossTarget = await this.getUserSetting(userId, 'loss_target', 0);
                await this.bot.sendMessage(chatId, `Set Loss Target\n\nCurrent target: ${currentLossTarget.toLocaleString()} K\n\nPlease enter the loss target amount (in K):\nExample: 500 (for 500 K loss target)\nEnter 0 to disable loss target`);
                break;

            case "Reset Stats":
                await this.resetBotStats(chatId, userId);
                break;

            case "Main Menu":
                userSession.step = 'main';
                await this.bot.sendMessage(chatId, "Main Menu", {
                    reply_markup: this.getMainKeyboard()
                });
                break;

            // BS Formula buttons
            case "Set BS Pattern":
                userSession.step = 'set_bs_pattern';
                await this.bot.sendMessage(chatId, "Set BS Pattern for BS Formula Mode\n\nEnter your BS pattern using ONLY B for BIG and S for SMALL:\n\nExamples:\n- B,S,B,B\n- S,S,B\n- B,B,B,S\n\nEnter your BS pattern:");
                break;

            case "View BS Pattern":
                await this.viewBsPattern(chatId, userId);
                break;

            case "Clear BS Pattern":
                await this.clearBsPattern(chatId, userId);
                break;

            case "Bot Settings":
                await this.showBotSettings(chatId, userId);
                break;

            // Colour Formula buttons
            case "Set Colour Pattern":
                userSession.step = 'set_colour_pattern';
                await this.bot.sendMessage(chatId, "Set Colour Pattern for Colour Formula Mode\n\nEnter your Colour pattern using ONLY:\n- G for GREEN\n- R for RED\n- V for VIOLET\n\nExamples:\n- R,G,V,R\n- G,V,R\n- R,R,G\n\nEnter your Colour pattern:");
                break;

            case "View Colour Pattern":
                await this.viewColourPattern(chatId, userId);
                break;

            case "Clear Colour Pattern":
                await this.clearColourPattern(chatId, userId);
                break;

            // SL Layer buttons
            case "Set SL Pattern":
                userSession.step = 'set_sl_pattern';
                await this.bot.sendMessage(chatId, "Set SL Pattern\n\nEnter your SL pattern (comma separated numbers 1-5):\nExample: 2,1,3 (Starts from SL 2 with WAIT BOT)\nExample: 2,1 (Starts from SL 2 with WAIT BOT)\nExample: 1,2,3 (Starts from SL 1 with BETTING)\n\nEnter your SL pattern:");
                break;

            case "View SL Pattern":
                await this.viewSlPattern(chatId, userId);
                break;

            case "Reset SL Pattern":
                await this.resetSlPattern(chatId, userId);
                break;

            case "SL Stats":
                await this.showSlStats(chatId, userId);
                break;

            default:
                console.log(`Unknown command: '${text}'`);
                await this.bot.sendMessage(chatId, "Please use the buttons below to navigate.", {
                    reply_markup: this.getMainKeyboard()
                });
        }
    }

    async handleBigwinLogin(chatId, userId) {
        const userSession = userSessions[userId];
        userSession.step = 'login';
        userSession.platform = '777';
        userSession.apiInstance = new LotteryAPI('777');

        const loginGuide = `777 Big Win Login

Please follow these steps:

1. Click 'Enter Phone' and send your phone number
2. Click 'Enter Password' and send your password  
3. Click 'Login Now' to authenticate

Your credentials will be saved for future use!`;

        await this.bot.sendMessage(chatId, loginGuide, {
            reply_markup: this.getLoginKeyboard()
        });
    }

    async processLogin(chatId, userId) {
        const userSession = userSessions[userId];
        
        if (!userSession.phone || !userSession.password) {
            await this.bot.sendMessage(chatId, "Please enter phone number and password first!", {
                reply_markup: this.getLoginKeyboard()
            });
            return;
        }

        const loadingMsg = await this.bot.sendMessage(chatId, "Logging in... Please wait.");

        try {
            const result = await userSession.apiInstance.login(userSession.phone, userSession.password);
            
            if (result.success) {
                const userInfo = await userSession.apiInstance.getUserInfo();
                const gameId = userInfo.userId || '';
                
                // Check if game ID is allowed
                if (!await this.isGameIdAllowed(gameId)) {
                    await this.bot.editMessageText(`Login Failed!\n\nGame ID: ${gameId}\nStatus: NOT ALLOWED\n\nPlease contact admin: @trilionx2`, {
                        chat_id: chatId,
                        message_id: loadingMsg.message_id
                    });
                    return;
                }

                userSession.loggedIn = true;
                userSession.step = 'main';

                const balance = await userSession.apiInstance.getBalance();

                await this.saveUserCredentials(userId, userSession.phone, userSession.password, userSession.platform);
                await this.saveUserSetting(userId, 'auto_login', 1);

                const platformName = '777 Big Win';
                
                const successText = `Login Successful!

Platform: ${platformName}
Game ID: ${gameId}
Account: ${userSession.phone}
Balance: ${balance.toLocaleString()} K

Status: VERIFIED`;

                await this.bot.editMessageText(successText, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });

                await this.bot.sendMessage(chatId, "Choose an option:", {
                    reply_markup: this.getMainKeyboard()
                });
            } else {
                await this.bot.editMessageText(`Login failed: ${result.message}`, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
            }
        } catch (error) {
            await this.bot.editMessageText(`Login error: ${error.message}`, {
                chat_id: chatId,
                message_id: loadingMsg.message_id
            });
        }
    }

    async handleBalance(chatId, userId) {
        const userSession = userSessions[userId];
        
        if (!userSession.loggedIn) {
            await this.bot.sendMessage(chatId, "Please login first!");
            return;
        }

        try {
            const balance = await userSession.apiInstance.getBalance();
            const userInfo = await userSession.apiInstance.getUserInfo();
            const user_id_display = userInfo.userId || 'N/A';

            const currentAmount = await this.getCurrentBetAmount(userId);
            const betSequence = await this.getUserSetting(userId, 'bet_sequence', '100,300,700,1600,3200,7600,16000,32000');
            const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);

            const platformName = '777 Big Win';

            const balanceText = `Account Information

Platform: ${platformName}
User ID: ${user_id_display}
Balance: ${balance.toLocaleString()} K
Status: LOGGED IN

Last update: ${getMyanmarTime()}`;

            await this.bot.sendMessage(chatId, balanceText);
        } catch (error) {
            await this.bot.sendMessage(chatId, `Error getting balance: ${error.message}`);
        }
    }

    async handleResults(chatId, userId) {
        const userSession = userSessions[userId];
        const platformName = '777 Big Win';

        try {
            let results;
            if (userSession.apiInstance) {
                results = await userSession.apiInstance.getRecentResults(10);
            } else {
                const api = new LotteryAPI(userSession.platform || '777');
                results = await api.getRecentResults(10);
            }

            if (!results || results.length === 0) {
                await this.bot.sendMessage(chatId, "No recent results available.");
                return;
            }

            let resultsText = `Recent Game Results - ${platformName}\n\n`;
            results.forEach((result, i) => {
                const issueNo = result.issueNumber || 'N/A';
                const number = result.number || 'N/A';
                const resultType = ['0','1','2','3','4'].includes(number) ? "SMALL" : "BIG";
                const colour = result.colour || 'UNKNOWN';

                resultsText += `${i+1}. ${issueNo} - ${number} - ${resultType} ${colour}\n`;
            });

            resultsText += `\nLast updated: ${getMyanmarTime()}`;

            await this.bot.sendMessage(chatId, resultsText);
        } catch (error) {
            await this.bot.sendMessage(chatId, `Error getting results: ${error.message}`);
        }
    }

    async placeBetHandler(chatId, userId, betType) {
        const userSession = userSessions[userId];
        
        if (!userSession.loggedIn) {
            await this.bot.sendMessage(chatId, "Please login first!");
            return;
        }

        try {
            const currentIssue = await userSession.apiInstance.getCurrentIssue();
            if (!currentIssue) {
                await this.bot.sendMessage(chatId, "Cannot get current game issue. Please try again.");
                return;
            }

            if (await this.hasUserBetOnIssue(userId, userSession.platform, currentIssue)) {
                await this.bot.sendMessage(chatId, `Wait for next period\n\nYou have already placed a bet on issue ${currentIssue}.\nPlease wait for the next game period to place another bet.`);
                return;
            }

            const amount = await this.getCurrentBetAmount(userId);
            const betTypeStr = betType === 13 ? "BIG" : "SMALL";
            const betSequence = await this.getUserSetting(userId, 'bet_sequence', '100,300,700,1600,3200,7600,16000,32000');
            const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);

            const balance = await userSession.apiInstance.getBalance();
            if (balance < amount) {
                await this.bot.sendMessage(chatId, `Insufficient balance! You have ${balance.toLocaleString()} K but need ${amount.toLocaleString()} K`);
                return;
            }

            const platformName = '777 Big Win';

            const loadingMsg = await this.bot.sendMessage(chatId, `Placing ${betTypeStr} bet...\nPlatform: ${platformName}\nIssue: ${currentIssue}\nAmount: ${amount.toLocaleString()} K (Step ${currentIndex + 1})`);

            const result = await userSession.apiInstance.placeBet(amount, betType);
            
            if (result.success) {
                await this.savePendingBet(userId, userSession.platform, result.issueId, betTypeStr, amount);
                
                if (!issueCheckers[userId]) {
                    this.startIssueChecker(userId);
                }

                const betText = `Bet Placed Successfully!

Platform: ${platformName}
Issue: ${result.issueId}
Type: ${betTypeStr}
Amount: ${amount.toLocaleString()} K (Step ${currentIndex + 1})`;

                await this.bot.editMessageText(betText, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
            } else {
                await this.bot.editMessageText(`Bet failed: ${result.message}`, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
            }
        } catch (error) {
            await this.bot.sendMessage(chatId, `Bet error: ${error.message}`);
        }
    }

    async placeColourBet(chatId, userId, colour) {
        const userSession = userSessions[userId];
        
        if (!userSession.loggedIn) {
            await this.bot.sendMessage(chatId, "Please login first!");
            return;
        }

        try {
            const currentIssue = await userSession.apiInstance.getCurrentIssue();
            if (!currentIssue) {
                await this.bot.sendMessage(chatId, "Cannot get current game issue. Please try again.");
                return;
            }

            if (await this.hasUserBetOnIssue(userId, userSession.platform, currentIssue)) {
                await this.bot.sendMessage(chatId, `Wait for next period\n\nYou have already placed a bet on issue ${currentIssue}.\nPlease wait for the next game period to place another bet.`);
                return;
            }

            const amount = await this.getCurrentBetAmount(userId);
            const betType = COLOUR_BET_TYPES[colour];
            const betSequence = await this.getUserSetting(userId, 'bet_sequence', '100,300,700,1600,3200,7600,16000,32000');
            const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);

            const balance = await userSession.apiInstance.getBalance();
            if (balance < amount) {
                await this.bot.sendMessage(chatId, `Insufficient balance! You have ${balance.toLocaleString()} K but need ${amount.toLocaleString()} K`);
                return;
            }

            // Calculate potential profit based on colour
            let potentialProfit;
            let payoutRate;
            if (colour === "RED" || colour === "GREEN") {
                potentialProfit = Math.floor(amount * 0.96);
                payoutRate = "1.96x";
            } else if (colour === "VIOLET") {
                potentialProfit = Math.floor(amount * 0.44);
                payoutRate = "1.44x";
            }

            const platformName = '777 Big Win';

            const loadingMsg = await this.bot.sendMessage(chatId, `Placing ${colour} bet...\nPlatform: ${platformName}\nIssue: ${currentIssue}\nAmount: ${amount.toLocaleString()} K (Step ${currentIndex + 1})\nPayout: ${payoutRate}\nPotential Profit: +${potentialProfit.toLocaleString()} K`);

            const result = await userSession.apiInstance.placeBet(amount, betType);
            
            if (result.success) {
                const betTypeStr = `${colour}`;
                await this.savePendingBet(userId, userSession.platform, result.issueId, betTypeStr, amount);
                
                if (!issueCheckers[userId]) {
                    this.startIssueChecker(userId);
                }

                const betText = `Colour Bet Placed Successfully!

Platform: ${platformName}
Issue: ${result.issueId}
Type: ${colour}
Amount: ${amount.toLocaleString()} K (Step ${currentIndex + 1})`;

                await this.bot.editMessageText(betText, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
            } else {
                await this.bot.editMessageText(`${colour} bet failed: ${result.message}`, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
            }
        } catch (error) {
            await this.bot.sendMessage(chatId, `${colour} bet error: ${error.message}`);
        }
    }

    async showBotSettings(chatId, userId) {
        try {
            const randomMode = await this.getUserSetting(userId, 'random_betting', 'bot');
            const betSequence = await this.getUserSetting(userId, 'bet_sequence', '100,300,700,1600,3200,7600,16000,32000');
            const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
            const currentAmount = await this.getCurrentBetAmount(userId);
            
            // Formula patterns
            const patternsData = await this.getFormulaPatterns(userId);
            const bsPattern = patternsData.bs_pattern || "Not set";
            const colourPattern = patternsData.colour_pattern || "Not set";
            
            // SL Pattern
            const slPatternData = await this.getSlPattern(userId);
            const slPattern = slPatternData.pattern || "Not set";
            
            // Profit/Loss Target
            const profitTarget = await this.getUserSetting(userId, 'profit_target', 0);
            const lossTarget = await this.getUserSetting(userId, 'loss_target', 0);

            const botSession = await this.getBotSession(userId);

            // Mode names
            let modeText;
            let formulaStatus = "";
            
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
                default:
                    modeText = "Random Bot";
            }
            
            // Formula patterns status
            if (bsPattern && bsPattern !== "Not set") {
                formulaStatus += `\n- BS Formula: ACTIVE (${bsPattern})`;
            }
            if (colourPattern && colourPattern !== "Not set") {
                formulaStatus += `\n- Colour Formula: ACTIVE (${colourPattern})`;
            }
            
            // SL Layer status
            let slStatus = "";
            if (slPattern && slPattern !== "Not set" && slPattern !== "1,2,3,4,5") {
                slStatus = `\n- SL Layer: READY (${slPattern})`;
            }
            
            // Formula mode text
            if (formulaStatus) {
                if (bsPattern && bsPattern !== "Not set") {
                    modeText = "BS Formula ";
                } else if (colourPattern && colourPattern !== "Not set") {
                    modeText = "Colour Formula ";
                }
            }

            const settingsText = `Bot Settings

Current Settings:
- Betting Mode: ${modeText}
- Bet Sequence: ${betSequence}
- Current Bet: ${currentAmount.toLocaleString()} K (Step ${currentIndex + 1})
- Bot Status: ${botSession.is_running ? 'RUNNING' : 'STOPPED'}${formulaStatus}${slStatus}

Profit/Loss Targets:
- Profit Target: ${profitTarget > 0 ? profitTarget.toLocaleString() + ' K' : 'Disabled'}
- Loss Target: ${lossTarget > 0 ? lossTarget.toLocaleString() + ' K' : 'Disabled'}

Bot Statistics:
- Session Profit: ${botSession.session_profit.toLocaleString()} K
- Session Loss: ${botSession.session_loss.toLocaleString()} K
- Net Profit: ${(botSession.session_profit - botSession.session_loss).toLocaleString()} K

Choose your betting mode:`;

            await this.bot.sendMessage(chatId, settingsText, {
                reply_markup: this.getBotSettingsKeyboard()
            });
        } catch (error) {
            await this.bot.sendMessage(chatId, "Error loading bot settings. Please try again.");
        }
    }

    async showMyBets(chatId, userId) {
        const userSession = userSessions[userId];
        
        if (!userSession.loggedIn) {
            await this.bot.sendMessage(chatId, "Please login first!");
            return;
        }

        try {
            const platform = userSession.platform || '777';
            const myBets = await this.getBetHistory(userId, platform, 10);
            
            if (!myBets || myBets.length === 0) {
                await this.bot.sendMessage(chatId, "No bet history found.");
                return;
            }

            const platformName = '777 Big Win';

            let betsText = `Your Recent Bets - ${platformName}\n\n`;
            myBets.forEach((bet, i) => {
                const resultText = bet.result === "WIN" ? 
                    `WIN (+${(bet.amount + bet.profit_loss).toLocaleString()}K)` : 
                    `LOSE (-${bet.amount.toLocaleString()}K)`;
                
                const timeStr = bet.created_at.split(' ')[1]?.substring(0, 5) || bet.created_at.substring(11, 16);
                betsText += `${i+1}. ${bet.issue} - ${bet.bet_type} - ${bet.amount.toLocaleString()}K - ${resultText}\n`;
            });

            await this.bot.sendMessage(chatId, betsText);
        } catch (error) {
            await this.bot.sendMessage(chatId, "Error getting bet history. Please try again.");
        }
    }

    async showSlLayer(chatId, userId) {
        const slPatternData = await this.getSlPattern(userId);
        const patternsData = await this.getFormulaPatterns(userId);
        
        const patternText = slPatternData.pattern;
        const currentSl = slPatternData.current_sl;
        
        const bsPatternActive = Boolean(patternsData.bs_pattern);
        const colourPatternActive = Boolean(patternsData.colour_pattern);
        
        // Auto Activation Status
        const activationStatus = [];
        let readyForSl = true;
        
        if (!slPatternData.pattern || slPatternData.pattern === '1,2,3,4,5') {
            activationStatus.push("SL Pattern not set");
            readyForSl = false;
        } else {
            activationStatus.push("SL Pattern ready");
        }
        
        if (!bsPatternActive && !colourPatternActive) {
            activationStatus.push("BS/Colour Pattern not set");
            readyForSl = false;
        } else {
            activationStatus.push("BS/Colour Pattern ready");
        }
        
        if (!bsPatternActive && !colourPatternActive) {
            const slInfo = `SL Layer Bot System

Auto Activation System

How it works:
1. Set your SL Pattern here
2. Set BS Pattern or Colour Pattern in Bot Settings  
3. Press Run Bot
4. System automatically chooses SL Layer or Normal Bot

Current Status:
${activationStatus.join('\n')}

SL Layer will activate automatically when all conditions are met!`;
            
            await this.bot.sendMessage(chatId, slInfo, {
                reply_markup: this.getSlLayerKeyboard()
            });
        } else {
            const activePatternType = bsPatternActive ? "BS Formula" : "Colour Formula";
            const activePattern = bsPatternActive ? patternsData.bs_pattern : patternsData.colour_pattern;
            
            const overallStatus = readyForSl ? "READY FOR SL LAYER" : "Not Ready";
            
            const slInfo = `SL Layer Bot System - ${overallStatus}

${activePatternType} Mode: ACTIVE - ${activePattern}
SL Layer: ${readyForSl ? 'Activate' : 'Cannot Activate'}

Activation Status:
${activationStatus.join('\n')}

Current SL Pattern: ${patternText}
Current SL Level: ${currentSl}

Manage your SL Pattern:`;
            
            await this.bot.sendMessage(chatId, slInfo, {
                reply_markup: this.getSlLayerKeyboard()
            });
        }
    }

    async runBot(chatId, userId) {
        const userSession = userSessions[userId];
        
        if (!userSession.loggedIn) {
            await this.bot.sendMessage(chatId, "Please login first!");
            return;
        }

        if (autoBettingTasks[userId]) {
            await this.bot.sendMessage(chatId, "Bot is already running!");
            return;
        }

        // Formula patterns
        const patternsData = await this.getFormulaPatterns(userId);
        const bsPattern = patternsData.bs_pattern || "";
        const colourPattern = patternsData.colour_pattern || "";

        // SL Pattern
        const slPatternData = await this.getSlPattern(userId);
        const slPattern = slPatternData.pattern || "";

        const randomMode = await this.getUserSetting(userId, 'random_betting', 'bot');
        
        // Check if SL Layer should be activated
        const useSlLayer = Boolean(
            slPattern && 
            slPattern !== "" && 
            slPattern !== "1,2,3,4,5" && 
            (bsPattern || colourPattern)
        );
        
        // Mode names
        let modeText;
        let formulaStatus = "";
        
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
            default:
                modeText = "Random Bot";
        }
        
        // Formula patterns status
        if (bsPattern && bsPattern !== "") {
            formulaStatus += `\n- BS Formula Pattern: ${bsPattern}`;
            modeText = "BS Formula ";
        }
        if (colourPattern && colourPattern !== "") {
            formulaStatus += `\n- Colour Formula Pattern: ${colourPattern}`;
            modeText = "Colour Formula ";
        }

        // SL Layer status
        let slStatus = "";
        if (useSlLayer) {
            slStatus = `\n- SL Layer: ACTIVE (${slPattern})`;
            modeText = "SL Layer Bot";
        }

        autoBettingTasks[userId] = true;
        waitingForResults[userId] = false;

        await this.resetSessionStats(userId);
        await this.saveBotSession(userId, true);

        const betSequence = await this.getUserSetting(userId, 'bet_sequence', '100,300,700,1600,3200,7600,16000,32000');
        const currentAmount = await this.getCurrentBetAmount(userId);
        
        // Profit/Loss Target
        const profitTarget = await this.getUserSetting(userId, 'profit_target', 0);
        const lossTarget = await this.getUserSetting(userId, 'loss_target', 0);

        let targetInfo = "";
        if (profitTarget > 0) {
            targetInfo += `\n- Profit Target: ${profitTarget.toLocaleString()} K`;
        }
        if (lossTarget > 0) {
            targetInfo += `\n- Loss Target: ${lossTarget.toLocaleString()} K`;
        }

        const platformName = '777 Big Win';

        const startMessage = `Auto Bot Started!`;

        await this.bot.sendMessage(chatId, startMessage);

        if (useSlLayer) {
            // Start SL Bot
            await this.resetSlPattern(userId);
            this.startSlBetting(userId);
        } else {
            // Start Normal Bot
            this.startAutoBetting(userId);
        }
    }

    async stopBot(chatId, userId) {
        if (autoBettingTasks[userId]) {
            delete autoBettingTasks[userId];
        }
        if (waitingForResults[userId]) {
            delete waitingForResults[userId];
        }
        if (issueCheckers[userId]) {
            delete issueCheckers[userId];
        }

        await this.db.run('DELETE FROM pending_bets WHERE user_id = ?', [userId]);
        await this.saveBotSession(userId, false);

        await this.bot.sendMessage(chatId, `Auto Bot Stopped!`);
    }

    async setRandomBig(chatId, userId) {
        await this.saveUserSetting(userId, 'random_betting', 'big');
        await this.clearFormulaPatterns(userId);
        
        await this.bot.sendMessage(chatId, "Random Mode Set\n\n- Random BIG - Always bet BIG\n\nBot will now always bet BIG in auto mode.");
    }

    async setRandomSmall(chatId, userId) {
        await this.saveUserSetting(userId, 'random_betting', 'small');
        await this.clearFormulaPatterns(userId);
        
        await this.bot.sendMessage(chatId, "Random Mode Set\n\n- Random SMALL - Always bet SMALL\n\nBot will now always bet SMALL in auto mode.");
    }

    async setRandomBot(chatId, userId) {
        await this.saveUserSetting(userId, 'random_betting', 'bot');
        await this.clearFormulaPatterns(userId);
        
        await this.bot.sendMessage(chatId, "Random Mode Set\n\n- Random Bot - Random BIG/SMALL\n\nBot will now randomly choose between BIG and SMALL in auto mode.");
    }

    async setFollowBot(chatId, userId) {
        await this.saveUserSetting(userId, 'random_betting', 'follow');
        await this.clearFormulaPatterns(userId);
        
        await this.bot.sendMessage(chatId, "Random Mode Set\n\n- Follow Bot - Follow Last Result\n\nBot will now follow the last game result in auto mode.");
    }

    async handleSetBetSequence(chatId, userId, text) {
        try {
            const amounts = text.split(',').map(x => parseInt(x.trim()));
            if (amounts.length === 0 || amounts.some(isNaN)) {
                await this.bot.sendMessage(chatId, "Please enter valid numbers separated by commas (e.g., 100,300,700,1600,3200,7600,16000,32000)");
                return;
            }

            if (amounts.some(amount => amount < 10)) {
                await this.bot.sendMessage(chatId, "Minimum bet amount is 10 K");
                return;
            }

            const betSequence = amounts.join(',');
            await this.saveUserSetting(userId, 'bet_sequence', betSequence);
            await this.saveUserSetting(userId, 'current_bet_index', 0);

            userSessions[userId].step = 'main';
            await this.bot.sendMessage(chatId, `Bet sequence set to: ${betSequence}\nStarting from first amount: ${amounts[0]} K`, {
                reply_markup: this.getMainKeyboard()
            });
        } catch (error) {
            await this.bot.sendMessage(chatId, "Please enter valid numbers separated by commas (e.g., 100,300,700,1600,3200,7600,16000,32000)");
        }
    }

    async handleSetProfitTarget(chatId, userId, text) {
        try {
            const targetAmount = parseInt(text.trim());
            if (isNaN(targetAmount) || targetAmount < 0) {
                await this.bot.sendMessage(chatId, "Please enter a positive number or 0 to disable");
                return;
            }
                
            await this.saveUserSetting(userId, 'profit_target', targetAmount);
            userSessions[userId].step = 'main';
            
            const botSession = await this.getBotSession(userId);
            const netProfit = botSession.session_profit - botSession.session_loss;
            
            if (targetAmount === 0) {
                await this.bot.sendMessage(chatId, "Profit Target Disabled!\n\nBot will run continuously until manually stopped.", {
                    reply_markup: this.getBotSettingsKeyboard()
                });
            } else {
                const progress = Math.min(100, Math.round((netProfit / targetAmount) * 100));
                await this.bot.sendMessage(chatId, `Profit Target Set!\n\nTarget: ${targetAmount.toLocaleString()} K (${netProfit.toLocaleString()}/${targetAmount.toLocaleString()} K)\n\nBot will automatically stop when profit reaches ${targetAmount.toLocaleString()} K`, {
                    reply_markup: this.getBotSettingsKeyboard()
                });
            }
        } catch (error) {
            await this.bot.sendMessage(chatId, "Please enter a valid number (e.g., 1000 for 1000 K target)");
        }
    }

    async handleSetLossTarget(chatId, userId, text) {
        try {
            const targetAmount = parseInt(text.trim());
            if (isNaN(targetAmount) || targetAmount < 0) {
                await this.bot.sendMessage(chatId, "Please enter a positive number or 0 to disable");
                return;
            }
                
            await this.saveUserSetting(userId, 'loss_target', targetAmount);
            userSessions[userId].step = 'main';
            
            const botSession = await this.getBotSession(userId);
            const progress = Math.min(100, Math.round((botSession.session_loss / targetAmount) * 100));
            
            if (targetAmount === 0) {
                await this.bot.sendMessage(chatId, "Loss Target Disabled!\n\nBot will run continuously until manually stopped.", {
                    reply_markup: this.getBotSettingsKeyboard()
                });
            } else {
                await this.bot.sendMessage(chatId, `Loss Target Set!\n\nTarget: ${targetAmount.toLocaleString()} K (${botSession.session_loss.toLocaleString()}/${targetAmount.toLocaleString()} K)\n\nBot will automatically stop when loss reaches ${targetAmount.toLocaleString()} K`, {
                    reply_markup: this.getBotSettingsKeyboard()
                });
            }
        } catch (error) {
            await this.bot.sendMessage(chatId, "Please enter a valid number (e.g., 500 for 500 K target)");
        }
    }

    async handleSetBsPattern(chatId, userId, text) {
        const pattern = text.trim().toUpperCase();
        
        // Validate BS pattern - only B and S allowed
        const validChars = ['B', 'S', ','];
        const isValid = pattern.split('').every(char => validChars.includes(char) || char === ' ');
        
        if (isValid) {
            const cleanPattern = pattern.split(',').map(p => p.trim()).filter(p => p).join(',');
            
            if (await this.saveFormulaPatterns(userId, cleanPattern, '')) {
                userSessions[userId].step = 'main';
                await this.bot.sendMessage(chatId, `BS Pattern Set Successfully!\n\nBS Pattern: ${cleanPattern}\n\nBot will now follow this BS pattern in BS Formula mode.`, {
                    reply_markup: this.getBsPatternKeyboard()
                });
            } else {
                await this.bot.sendMessage(chatId, "Error saving BS pattern. Please try again.");
            }
        } else {
            await this.bot.sendMessage(chatId, "Invalid BS pattern! Use only B (BIG), S (SMALL) and commas.\nExamples: B,S,B,B or S,S,B\nPlease enter a valid BS pattern:");
        }
    }

    async handleSetColourPattern(chatId, userId, text) {
        const pattern = text.trim().toUpperCase();
        
        // Validate Colour pattern - only G, R, V allowed
        const validChars = ['G', 'R', 'V', ','];
        const isValid = pattern.split('').every(char => validChars.includes(char) || char === ' ');
        
        if (isValid) {
            const cleanPattern = pattern.split(',').map(p => p.trim()).filter(p => p).join(',');
            
            if (await this.saveFormulaPatterns(userId, '', cleanPattern)) {
                userSessions[userId].step = 'main';
                await this.bot.sendMessage(chatId, `Colour Pattern Set Successfully!\n\nColour Pattern: ${cleanPattern}\n\nBot will now follow this Colour pattern in Colour Formula mode.`, {
                    reply_markup: this.getColourPatternKeyboard()
                });
            } else {
                await this.bot.sendMessage(chatId, "Error saving Colour pattern. Please try again.");
            }
        } else {
            await this.bot.sendMessage(chatId, "Invalid Colour pattern! Use only G (GREEN), R (RED), V (VIOLET) and commas.\nExamples: R,G,V,R or G,V,R\nPlease enter a valid Colour pattern:");
        }
    }

    async handleSetSlPattern(chatId, userId, text) {
        const pattern = text.trim();
        
        try {
            const numbers = pattern.split(',').map(x => parseInt(x.trim()));
            if (numbers.length === 0 || numbers.some(isNaN) || numbers.some(num => num < 1 || num > 5)) {
                await this.bot.sendMessage(chatId, "Invalid pattern! Use only numbers 1-5 separated by commas.\nExample: 1,2,3,4,5\nPlease enter a valid pattern:");
                return;
            }

            if (await this.saveSlPattern(userId, pattern)) {
                userSessions[userId].step = 'main';
                await this.bot.sendMessage(chatId, `SL Pattern Set Successfully!\n\nPattern: ${pattern}\n\nPattern saved and ready for use with SL Bot.`, {
                    reply_markup: this.getMainKeyboard()
                });
            } else {
                await this.bot.sendMessage(chatId, "Error saving SL pattern. Please try again.");
            }
        } catch (error) {
            await this.bot.sendMessage(chatId, "Invalid pattern format! Use only numbers 1-5 separated by commas.\nExample: 1,2,3,4,5\nPlease enter a valid pattern:");
        }
    }

    async showBsFormula(chatId, userId) {
        const patternsData = await this.getFormulaPatterns(userId);
        const bsPattern = patternsData.bs_pattern || "Not set";
        
        const bsInfo = `BS Formula Pattern Mode

Current BS Pattern: ${bsPattern}

To use BS Formula Mode:
1. Set your BS Pattern first (B,S only)
2. Bot will follow the pattern automatically
3. Pattern will loop until cleared

How to create BS pattern:
- Use B for BIG, S for SMALL ONLY
- Separate with commas: B,S,B,B
- Only B and S allowed - no colours

Choose an option to manage your BS pattern:`;

        await this.bot.sendMessage(chatId, bsInfo, {
            reply_markup: this.getBsPatternKeyboard()
        });
    }

    async showColourFormula(chatId, userId) {
        const patternsData = await this.getFormulaPatterns(userId);
        const colourPattern = patternsData.colour_pattern || "Not set";
        
        const colourInfo = `Colour Formula Pattern Mode

Current Colour Pattern: ${colourPattern}

To use Colour Formula Mode:
1. Set your Colour Pattern first (G,R,V only)
2. Bot will follow the pattern automatically
3. Pattern will loop until cleared

How to create Colour pattern:
- Use G for GREEN, R for RED, V for VIOLET ONLY
- Separate with commas: G,R,V,R
- Only G, R, and V allowed - no BIG/SMALL

Choose an option to manage your Colour pattern:`;

        await this.bot.sendMessage(chatId, colourInfo, {
            reply_markup: this.getColourPatternKeyboard()
        });
    }

    async viewBsPattern(chatId, userId) {
        const patternsData = await this.getFormulaPatterns(userId);
        
        if (patternsData.bs_pattern) {
            await this.bot.sendMessage(chatId, `Current BS Pattern: ${patternsData.bs_pattern}\nCurrent Position: ${patternsData.bs_current_index + 1}`);
        } else {
            await this.bot.sendMessage(chatId, "No BS Pattern Set");
        }
    }

    async viewColourPattern(chatId, userId) {
        const patternsData = await this.getFormulaPatterns(userId);
        
        if (patternsData.colour_pattern) {
            await this.bot.sendMessage(chatId, `Current Colour Pattern: ${patternsData.colour_pattern}\nCurrent Position: ${patternsData.colour_current_index + 1}`);
        } else {
            await this.bot.sendMessage(chatId, "No Colour Pattern Set");
        }
    }

    async viewSlPattern(chatId, userId) {
        const slPatternData = await this.getSlPattern(userId);
        const slSession = await this.getSlBetSession(userId);
        const patternsData = await this.getFormulaPatterns(userId);
        
        const patternText = slPatternData.pattern;
        const currentSl = slPatternData.current_sl;
        const currentIndex = slPatternData.current_index;
        const waitLossCount = slPatternData.wait_loss_count;
        const betCount = slPatternData.bet_count;
        
        const patternList = patternText.split(',').map(x => parseInt(x.trim()));
        
        let patternDisplay = "";
        patternList.forEach((waitLimit, i) => {
            if (i === currentIndex) {
                patternDisplay += `SL${i+1}(${waitLimit}L) `;
            } else {
                patternDisplay += `SL${i+1}(${waitLimit}L) `;
            }
        });
        
        const modeStatus = slSession.is_wait_mode ? "WAIT MODE" : `SL ${currentSl} MODE`;
        
        const bsStatus = patternsData.bs_pattern ? "Active" : "Inactive";
        const colourStatus = patternsData.colour_pattern ? "Active" : "Inactive";
        
        await this.bot.sendMessage(chatId, `Current SL Pattern

BS Pattern Mode: ${bsStatus}
Colour Pattern Mode: ${colourStatus}
SL Pattern: ${patternText}
Current Mode: ${modeStatus}
Progress: ${patternDisplay}

Current Stats:
- Wait Loss Count: ${waitLossCount}/${patternList[currentIndex] || patternList[patternList.length - 1]}
- Bet Count: ${betCount}/3`);
    }

    async clearBsPattern(chatId, userId) {
        await this.clearFormulaPatterns(userId, 'bs');
        await this.bot.sendMessage(chatId, "BS Pattern cleared successfully!", {
            reply_markup: this.getBsPatternKeyboard()
        });
    }

    async clearColourPattern(chatId, userId) {
        await this.clearFormulaPatterns(userId, 'colour');
        await this.bot.sendMessage(chatId, "Colour Pattern cleared successfully!", {
            reply_markup: this.getColourPatternKeyboard()
        });
    }

    async resetSlPattern(chatId, userId) {
        if (await this.resetSlPatternDb(userId)) {
            await this.saveSlBetSession(userId, false, '', '', 0, 0);
            await this.bot.sendMessage(chatId, "SL Pattern reset successfully!");
        } else {
            await this.bot.sendMessage(chatId, "Error resetting SL pattern.");
        }
    }

    async showBotStats(chatId, userId) {
        const botSession = await this.getBotSession(userId);
        
        // Profit/Loss Target
        const profitTarget = await this.getUserSetting(userId, 'profit_target', 0);
        const lossTarget = await this.getUserSetting(userId, 'loss_target', 0);
        
        const netProfit = botSession.session_profit - botSession.session_loss;
        
        // Target progress calculation
        let profitProgress = "N/A";
        let lossProgress = "N/A";
        
        if (profitTarget > 0) {
            const progress = Math.min(100, Math.round((netProfit / profitTarget) * 100));
            profitProgress = `${progress}% (${netProfit.toLocaleString()}/${profitTarget.toLocaleString()} K)`;
        }
        
        if (lossTarget > 0) {
            const progress = Math.min(100, Math.round((botSession.session_loss / lossTarget) * 100));
            lossProgress = `${progress}% (${botSession.session_loss.toLocaleString()}/${lossTarget.toLocaleString()} K)`;
        }
        
        const statsText = `Bot Statistics

Session Data:
- Session Profit: ${botSession.session_profit.toLocaleString()} K
- Session Loss: ${botSession.session_loss.toLocaleString()} K
- Net Profit: ${netProfit.toLocaleString()} K
- Total Bets: ${botSession.total_bets}
- Status: ${botSession.is_running ? 'RUNNING' : 'STOPPED'}

Profit/Loss Targets:
- Profit Target: ${profitTarget > 0 ? profitTarget.toLocaleString() + ' K' : 'Disabled'}
- Progress: ${profitProgress}
- Loss Target: ${lossTarget > 0 ? lossTarget.toLocaleString() + ' K' : 'Disabled'}
- Progress: ${lossProgress}

Session statistics reset when bot starts`;

        await this.bot.sendMessage(chatId, statsText, {
            reply_markup: this.getBotSettingsKeyboard()
        });
    }

    async showSlStats(chatId, userId) {
        await this.viewSlPattern(chatId, userId);
    }

    async resetBotStats(chatId, userId) {
        await this.resetSessionStats(userId);
        await this.bot.sendMessage(chatId, "Bot session statistics reset to zero!", {
            reply_markup: this.getBotSettingsKeyboard()
        });
    }

    async showBotInfo(chatId, userId) {
    const userSession = userSessions[userId];
    
    try {
        let userInfo = {};
        let balance = 0;
        if (userSession.loggedIn && userSession.apiInstance) {
            balance = await userSession.apiInstance.getBalance();
            userInfo = await userSession.apiInstance.getUserInfo();
        }

        const user_id_display = userInfo.userId || 'N/A';
        const phone = userSession.phone || 'Not logged in';
        
        const platformName = '777 Big Win';
        
        const botSession = await this.getBotSession(userId);
        const betSequence = await this.getUserSetting(userId, 'bet_sequence', '100,300,700,1600,3200,7600,16000,32000');
        const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
        const currentAmount = await this.getCurrentBetAmount(userId);
        
        // Formula patterns
        const patternsData = await this.getFormulaPatterns(userId);
        const bsPattern = patternsData.bs_pattern || "";
        const colourPattern = patternsData.colour_pattern || "";
        const bsCurrentIndex = patternsData.bs_current_index || 0;
        const colourCurrentIndex = patternsData.colour_current_index || 0;
        
        // SL Pattern
        const slPatternData = await this.getSlPattern(userId);
        const slPattern = slPatternData.pattern || "";
        const currentSl = slPatternData.current_sl || 1;
        const currentBetCount = slPatternData.bet_count || 0;
        const waitLossCount = slPatternData.wait_loss_count || 0;
        
        // SL Session
        const slSession = await this.getSlBetSession(userId);
        
        // Profit/Loss Target
        const profitTarget = await this.getUserSetting(userId, 'profit_target', 0);
        const lossTarget = await this.getUserSetting(userId, 'loss_target', 0);

        // Determine betting mode text with combined info
        let modeText = "";
        let formulaInfo = "";
        let slInfo = "";
        
        // Check if SL Layer is active
        const isSlLayerActive = slPattern && slPattern !== "" && slPattern !== "1,2,3,4,5";
        
        // Formula pattern information
        if (bsPattern && bsPattern !== "") {
            const patternArray = bsPattern.split(',');
            const currentPos = bsCurrentIndex + 1;
            const totalPos = patternArray.length;
            const currentBet = patternArray[bsCurrentIndex] || "END";
            
            formulaInfo = `BS Formula: ${bsPattern}\nPosition: ${currentPos}/${totalPos} (${currentBet})`;
            modeText = `BS Formula + ${isSlLayerActive ? "SL Layer" : "Normal"}`;
            
        } else if (colourPattern && colourPattern !== "") {
            const patternArray = colourPattern.split(',');
            const currentPos = colourCurrentIndex + 1;
            const totalPos = patternArray.length;
            const currentBet = patternArray[colourCurrentIndex] || "END";
            
            formulaInfo = `Colour Formula: ${colourPattern}\nPosition: ${currentPos}/${totalPos} (${currentBet})`;
            modeText = `Colour Formula + ${isSlLayerActive ? "SL Layer" : "Normal"}`;
        } else {
            const randomMode = await this.getUserSetting(userId, 'random_betting', 'bot');
            modeText = {
                'big': "Random BIG Only",
                'small': "Random SMALL Only", 
                'bot': "Random Bot",
                'follow': "Follow Bot"
            }[randomMode] || "Random Bot";
        }
        
        // 🟢 FIX: SL Layer information ကို မှန်ကန်စွာ ပြပါ
        if (isSlLayerActive) {
            const patternList = slPattern.split(',').map(x => parseInt(x.trim()));
            const currentIndexSL = slPatternData.current_index || 0;
            const currentWaitLossLimit = patternList[currentIndexSL] || patternList[patternList.length - 1];
            const nextSl = patternList[(currentIndexSL + 1) % patternList.length];
            
            // 🟢 FIX: Bet Count နဲ့ Wait Loss ကို စစ်ဆေးပါ
            const displayBetCount = slSession.is_wait_mode ? 0 : currentBetCount;
            
            slInfo = `SL Layer: ${slPattern}\nCurrent SL: ${currentSl}\nMode: ${slSession.is_wait_mode ? "WAIT BOT" : "BETTING"}\nBet Count: ${displayBetCount}/3\nWait Loss: ${waitLossCount}/${currentWaitLossLimit}`;
        }

        const netProfit = botSession.session_profit - botSession.session_loss;
        
        // Build the bot info text
        let botInfoText = `BOT INFORMATION

User Info:
- User ID: ${user_id_display}
- Phone: ${phone}
- Platform: ${platformName}
- Balance: ${balance.toLocaleString()} K

Bot Settings:
- Betting Mode: ${modeText}
- Bet Sequence: ${betSequence}
- Current Bet: ${currentAmount.toLocaleString()} K (Step ${currentIndex + 1})
- Bot Status: ${botSession.is_running ? 'RUNNING' : 'STOPPED'}`;

        // Add Formula info if available
        if (formulaInfo) {
            botInfoText += `\n\nFormula Pattern:\n${formulaInfo}`;
        }
        
        // Add SL Layer info if available
        if (slInfo) {
            botInfoText += `\n\nSL Pattern:\n${slInfo}`;
        }
        
        // Add targets and statistics
        botInfoText += `\n\nProfit/Loss Targets:
- Profit Target: ${profitTarget > 0 ? profitTarget.toLocaleString() + ' K' : 'Disabled'}
- Loss Target: ${lossTarget > 0 ? lossTarget.toLocaleString() + ' K' : 'Disabled'}

Bot Statistics:
- Session Profit: ${botSession.session_profit.toLocaleString()} K
- Session Loss: ${botSession.session_loss.toLocaleString()} K
- Net Profit: ${netProfit.toLocaleString()} K
- Total Bets: ${botSession.total_bets}

Last Update: ${getMyanmarTime()}`;

        await this.bot.sendMessage(chatId, botInfoText);
        
    } catch (error) {
        console.error("Error in showBotInfo:", error);
        await this.bot.sendMessage(chatId, "Error loading bot information. Please try again.");
    }
}

    // Database helper methods
    async saveUserCredentials(userId, phone, password, platform = '777') {
        await this.db.run(
            'INSERT OR REPLACE INTO users (user_id, phone, password, platform) VALUES (?, ?, ?, ?)',
            [userId, phone, password, platform]
        );
    }

    async getUserCredentials(userId) {
        return await this.db.get(
            'SELECT phone, password, platform FROM users WHERE user_id = ?',
            [userId]
        );
    }

    async saveUserSetting(userId, key, value) {
        // Check if user exists in settings
        const existing = await this.db.get('SELECT user_id FROM user_settings WHERE user_id = ?', [userId]);
        if (!existing) {
            await this.db.run('INSERT INTO user_settings (user_id) VALUES (?)', [userId]);
        }

        await this.db.run(`UPDATE user_settings SET ${key} = ? WHERE user_id = ?`, [value, userId]);
    }

    async getUserSetting(userId, key, defaultValue = null) {
        try {
            const result = await this.db.get(`SELECT ${key} FROM user_settings WHERE user_id = ?`, [userId]);
            return result ? result[key] : defaultValue;
        } catch (error) {
            return defaultValue;
        }
    }

    async getCurrentBetAmount(userId) {
        try {
            const betSequence = await this.getUserSetting(userId, 'bet_sequence', '100,300,700,1600,3200,7600,16000,32000');
            const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
            
            const amounts = betSequence.split(',').map(x => parseInt(x.trim()));
            
            if (currentIndex < amounts.length) {
                return amounts[currentIndex];
            } else {
                const amount = amounts[0] || 100;
                await this.saveUserSetting(userId, 'current_bet_index', 0);
                return amount;
            }
        } catch (error) {
            return 100;
        }
    }

    async updateBetSequence(userId, result) {
        try {
            const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
            const betSequence = await this.getUserSetting(userId, 'bet_sequence', '100,300,700,1600,3200,7600,16000,32000');
            const amounts = betSequence.split(',').map(x => parseInt(x.trim()));

            let newIndex;
            if (result === "WIN") {
                newIndex = 0;
            } else {
                newIndex = currentIndex + 1;
                if (newIndex >= amounts.length) {
                    newIndex = 0;
                }
            }

            await this.saveUserSetting(userId, 'current_bet_index', newIndex);
            return newIndex;
        } catch (error) {
            return 0;
        }
    }

    async savePendingBet(userId, platform, issue, betType, amount) {
        await this.db.run(
            'INSERT INTO pending_bets (user_id, platform, issue, bet_type, amount) VALUES (?, ?, ?, ?, ?)',
            [userId, platform, issue, betType, amount]
        );
    }

    async hasUserBetOnIssue(userId, platform, issue) {
        const result = await this.db.get(
            'SELECT issue FROM pending_bets WHERE user_id = ? AND platform = ? AND issue = ?',
            [userId, platform, issue]
        );
        return result !== undefined;
    }

    async getBetHistory(userId, platform = null, limit = 10) {
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
    }

    async saveBotSession(userId, isRunning = false, totalBets = 0, totalProfit = 0, sessionProfit = 0, sessionLoss = 0) {
        await this.db.run(
            'INSERT OR REPLACE INTO bot_sessions (user_id, is_running, total_bets, total_profit, session_profit, session_loss, last_activity) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
            [userId, isRunning ? 1 : 0, totalBets, totalProfit, sessionProfit, sessionLoss]
        );
    }

    async getBotSession(userId) {
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
    }

    async resetSessionStats(userId) {
        await this.saveBotSession(userId, false, 0, 0, 0, 0);
    }

    async updateBotStats(userId, profit = 0) {
        const session = await this.getBotSession(userId);
        const newTotalBets = session.total_bets + 1;
        const newTotalProfit = session.total_profit + profit;
        
        let newSessionProfit = session.session_profit;
        let newSessionLoss = session.session_loss;
        
        if (profit > 0) {
            newSessionProfit += profit;
        } else {
            newSessionLoss += Math.abs(profit);
        }
        
        await this.saveBotSession(userId, true, newTotalBets, newTotalProfit, newSessionProfit, newSessionLoss);
    }

    async getFormulaPatterns(userId) {
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
    }

    async saveFormulaPatterns(userId, bsPattern = "", colourPattern = "") {
        const existing = await this.db.get('SELECT user_id FROM formula_patterns WHERE user_id = ?', [userId]);
        
        if (existing) {
            await this.db.run(
                'UPDATE formula_patterns SET bs_pattern = ?, colour_pattern = ?, bs_current_index = 0, colour_current_index = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                [bsPattern, colourPattern, userId]
            );
        } else {
            await this.db.run(
                'INSERT INTO formula_patterns (user_id, bs_pattern, colour_pattern) VALUES (?, ?, ?)',
                [userId, bsPattern, colourPattern]
            );
        }
        return true;
    }

    async clearFormulaPatterns(userId, patternType = null) {
        if (patternType === 'bs') {
            await this.db.run('UPDATE formula_patterns SET bs_pattern = "", bs_current_index = 0 WHERE user_id = ?', [userId]);
        } else if (patternType === 'colour') {
            await this.db.run('UPDATE formula_patterns SET colour_pattern = "", colour_current_index = 0 WHERE user_id = ?', [userId]);
        } else {
            await this.db.run('UPDATE formula_patterns SET bs_pattern = "", colour_pattern = "", bs_current_index = 0, colour_current_index = 0 WHERE user_id = ?', [userId]);
        }
        return true;
    }

    async getSlPattern(userId) {
        const result = await this.db.get(
            'SELECT pattern, current_sl, current_index, wait_loss_count, bet_count FROM sl_patterns WHERE user_id = ?',
            [userId]
        );
        
        if (result) {
            let pattern = result.pattern || '';
            if (pattern === '1,2,3,4,5') {
                pattern = '';
            }
            
            return {
                pattern: pattern,
                current_sl: result.current_sl || 1,
                current_index: result.current_index || 0,
                wait_loss_count: result.wait_loss_count || 0,
                bet_count: result.bet_count || 0
            };
        }
        
        return { pattern: '', current_sl: 1, current_index: 0, wait_loss_count: 0, bet_count: 0 };
    }

    async saveSlPattern(userId, pattern) {
        console.log(`Saving SL pattern for user ${userId}, pattern: ${pattern}`);
        
        if (!pattern || typeof pattern !== 'string') {
            console.log("Pattern is empty or not string");
            return false;
        }
        
        const cleanedPattern = pattern.trim();
        if (!cleanedPattern) {
            console.log("Pattern is empty after cleaning");
            return false;
        }
        
        try {
            const numbers = cleanedPattern.split(',').map(x => parseInt(x.trim()));
            if (!numbers.every(num => 1 <= num && num <= 5)) {
                console.log("Pattern numbers not in range 1-5");
                return false;
            }
            
            let currentSl, currentIndex, isWaitMode;
            
            if (cleanedPattern === "2,1,3") {
                currentSl = 2;
                currentIndex = 0;
                isWaitMode = true;
                console.log("2,1,3 pattern detected - Starting from SL 2 with WAIT BOT mode");
            } else if (cleanedPattern === "2,1") {
                currentSl = 2;
                currentIndex = 0;
                isWaitMode = true;
                console.log("2,1 pattern detected - Starting from SL 2 with WAIT BOT mode");
            } else {
                currentSl = numbers[0];
                currentIndex = 0;
                isWaitMode = currentSl >= 2;
            }
            
            await this.saveSlBetSession(userId, isWaitMode, '', '', 0, 0);
            await this.updateSlPattern(userId, currentSl, currentIndex, 0, 0);
            
            const existing = await this.db.get('SELECT user_id FROM sl_patterns WHERE user_id = ?', [userId]);
            
            if (existing) {
                await this.db.run(
                    'UPDATE sl_patterns SET pattern = ?, current_sl = ?, current_index = ?, wait_loss_count = 0, bet_count = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                    [cleanedPattern, currentSl, currentIndex, userId]
                );
            } else {
                await this.db.run(
                    'INSERT INTO sl_patterns (user_id, pattern, current_sl, current_index, wait_loss_count, bet_count) VALUES (?, ?, ?, ?, 0, 0)',
                    [userId, cleanedPattern, currentSl, currentIndex]
                );
            }
            
            console.log(`SL pattern successfully saved: ${cleanedPattern}, starting from SL ${currentSl}`);
            return true;
            
        } catch (error) {
            console.log(`Overall error in saveSlPattern: ${error}`);
            return false;
        }
    }

    async updateSlPattern(userId, currentSl = null, currentIndex = null, waitLossCount = null, betCount = null) {
    try {
        const updateFields = [];
        const updateValues = [];
        
        if (currentSl !== null) {
            updateFields.push("current_sl = ?");
            updateValues.push(currentSl);
        }
        
        if (currentIndex !== null) {
            updateFields.push("current_index = ?");
            updateValues.push(currentIndex);
        }
        
        if (waitLossCount !== null) {
            updateFields.push("wait_loss_count = ?");
            updateValues.push(waitLossCount);
        }
        
        if (betCount !== null) {
            updateFields.push("bet_count = ?");
            updateValues.push(betCount);
            console.log(`DEBUG: Updating bet_count to ${betCount}`);
        }
        
        if (updateFields.length > 0) {
            updateFields.push("updated_at = CURRENT_TIMESTAMP");
            updateValues.push(userId);
            
            const query = `UPDATE sl_patterns SET ${updateFields.join(', ')} WHERE user_id = ?`;
            console.log(`DEBUG: Updating SL Pattern - Query: ${query}, Values: [${updateValues}]`);
            
            const result = await this.db.run(query, updateValues);
            console.log(`DEBUG: SL Pattern update result - Changes: ${result.changes}`);
            
            // Verify the update
            const updatedPattern = await this.getSlPattern(userId);
            console.log(`DEBUG: After update - Bet Count: ${updatedPattern.bet_count}, SL: ${updatedPattern.current_sl}`);
        }
        
        return true;
    } catch (error) {
        console.log(`ERROR updating SL pattern: ${error}`);
        return false;
    }
}
    async resetSlPatternDb(userId) {
    try {
        const result = await this.db.get('SELECT pattern FROM sl_patterns WHERE user_id = ?', [userId]);
        const currentPattern = result ? result.pattern : '1,2,3,4,5';
        
        console.log(`Resetting pattern: ${currentPattern} for user ${userId}`);
        
        let currentSl, currentIndex, isWaitMode, betCount;
        
        if (currentPattern === "2,1,3") {
            currentSl = 2;
            currentIndex = 0;
            isWaitMode = true;
            betCount = 0;
            console.log("2,1,3 pattern - setting WAIT MODE");
        } else if (currentPattern === "2,1") {
            currentSl = 2;
            currentIndex = 0;
            isWaitMode = true;
            betCount = 0;
            console.log("2,1 pattern - setting WAIT MODE");
        } else {
            const numbers = currentPattern.split(',').map(x => parseInt(x.trim()));
            currentSl = numbers[0];
            currentIndex = 0;
            isWaitMode = currentSl >= 2;
            betCount = 0;
            console.log(`Normal pattern ${currentPattern} - WAIT MODE: ${isWaitMode}`);
        }
        
        // 🟢 FIX: Reset bet_count to 0
        await this.db.run(
            'INSERT OR REPLACE INTO sl_patterns (user_id, pattern, current_sl, current_index, wait_loss_count, bet_count) VALUES (?, ?, ?, ?, 0, ?)',
            [userId, currentPattern, currentSl, currentIndex, betCount]
        );
        
        await this.db.run(
            'INSERT OR REPLACE INTO sl_bet_sessions (user_id, is_wait_mode, wait_bet_type, wait_issue, wait_amount, wait_total_profit) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, isWaitMode ? 1 : 0, '', '', 0, 0]
        );
        
        await this.db.run('DELETE FROM pending_bets WHERE user_id = ?', [userId]);
        
        console.log(`SL pattern reset complete - SL: ${currentSl}, Wait Mode: ${isWaitMode}, Bet Count: ${betCount}`);
        return true;
        
    } catch (error) {
        console.log(`Error in resetSlPattern: ${error}`);
        return false;
    }
}

    async getSlBetSession(userId) {
        const result = await this.db.get(
            'SELECT is_wait_mode, wait_bet_type, wait_issue, wait_amount, wait_total_profit FROM sl_bet_sessions WHERE user_id = ?',
            [userId]
        );
        
        if (result) {
            return {
                is_wait_mode: Boolean(result.is_wait_mode),
                wait_bet_type: result.wait_bet_type || '',
                wait_issue: result.wait_issue || '',
                wait_amount: result.wait_amount || 0,
                wait_total_profit: result.wait_total_profit || 0
            };
        }
        
        return { is_wait_mode: false, wait_bet_type: '', wait_issue: '', wait_amount: 0, wait_total_profit: 0 };
    }

    async saveSlBetSession(userId, isWaitMode = false, waitBetType = '', waitIssue = '', waitAmount = 0, waitTotalProfit = 0) {
        await this.db.run(
            'INSERT OR REPLACE INTO sl_bet_sessions (user_id, is_wait_mode, wait_bet_type, wait_issue, wait_amount, wait_total_profit, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
            [userId, isWaitMode ? 1 : 0, waitBetType, waitIssue, waitAmount, waitTotalProfit]
        );
        return true;
    }

    async isGameIdAllowed(gameId) {
        const allowedIds = await this.getAllowedGameIds();
        const gameIdStr = String(gameId).trim();
        const allowedIdsStr = allowedIds.map(id => String(id).trim());
        return allowedIdsStr.includes(gameIdStr);
    }

    async getAllowedGameIds() {
        const results = await this.db.all('SELECT game_id FROM allowed_game_ids ORDER BY added_at DESC');
        return results.map(row => row.game_id);
    }

    // Admin command handlers
    async handleAddGameId(msg, match) {
        const chatId = msg.chat.id;
        const userId = String(chatId);

        if (userId !== ADMIN_USER_ID) {
            await this.bot.sendMessage(chatId, "You are not authorized to use this command.");
            return;
        }

        const gameIdsInput = match[1];
        
        // Multiple game IDs support
        const gameIds = gameIdsInput.split(',').map(id => id.trim()).filter(id => /^\d+$/.test(id));
        
        if (gameIds.length === 0) {
            await this.bot.sendMessage(chatId, "Invalid format! Use: /aid game_id1,game_id2\nExample: /aid 102310,864480");
            return;
        }

        try {
            for (const gameId of gameIds) {
                await this.db.run(
                    'INSERT OR REPLACE INTO allowed_game_ids (game_id, added_by) VALUES (?, ?)',
                    [gameId, userId]
                );
            }
            
            await this.bot.sendMessage(chatId, `Game IDs added successfully!\n\nAdded: ${gameIds.join(', ')}\nTotal: ${gameIds.length} game IDs`);
            
        } catch (error) {
            await this.bot.sendMessage(chatId, "Failed to add game IDs. Please try again.");
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
            await this.bot.sendMessage(chatId, `Game ID '${gameId}' removed successfully!`);
        } catch (error) {
            await this.bot.sendMessage(chatId, "Failed to remove game ID.");
        }
    }

    async handleListGameIds(msg) {
        const chatId = msg.chat.id;
        const userId = String(chatId);

        if (userId !== ADMIN_USER_ID) {
            await this.bot.sendMessage(chatId, "You are not authorized to use this command.");
            return;
        }

        const gameIds = await this.getAllowedGameIds();
        if (gameIds.length === 0) {
            await this.bot.sendMessage(chatId, "No game IDs found.");
            return;
        }

        let gameIdsText = "Allowed Game IDs:\n\n";
        gameIds.forEach((gameId, i) => {
            gameIdsText += `${i+1}. ${gameId}\n`;
        });

        gameIdsText += `\nTotal: ${gameIds.length} game IDs\n`;
        await this.bot.sendMessage(chatId, gameIdsText);
    }

    async handleGameIdStats(msg) {
        const chatId = msg.chat.id;
        const userId = String(chatId);

        if (userId !== ADMIN_USER_ID) {
            await this.bot.sendMessage(chatId, "You are not authorized to use this command.");
            return;
        }

        const gameIds = await this.getAllowedGameIds();
        const totalIds = gameIds.length;

        let statsText = `Game ID Statistics\n\nTotal Allowed Game IDs: ${totalIds}\n\nRecent Game IDs:\n`;

        const recentIds = gameIds.slice(0, 10);
        recentIds.forEach((gameId, i) => {
            statsText += `${i+1}. ${gameId}\n`;
        });

        if (totalIds > 10) {
            statsText += `\n... and ${totalIds - 10} more`;
        }

        statsText += `\n\nLast Updated: ${getMyanmarTime()}`;

        await this.bot.sendMessage(chatId, statsText);
    }

    // Admin broadcast message to all users
    async handleBroadcastMessage(msg, match) {
        const chatId = msg.chat.id;
        const userId = String(chatId);

        if (userId !== ADMIN_USER_ID) {
            await this.bot.sendMessage(chatId, "You are not authorized to use this command.");
            return;
        }

        const message = match[1];
        if (!message) {
            await this.bot.sendMessage(chatId, "Usage: /broadcast your_message_here\nExample: /broadcast Hello all users!");
            return;
        }

        try {
            // Get all users from database
            const allUsers = await this.db.all('SELECT DISTINCT user_id FROM users');
            
            if (allUsers.length === 0) {
                await this.bot.sendMessage(chatId, "No users found in database.");
                return;
            }

            const loadingMsg = await this.bot.sendMessage(chatId, `Starting broadcast to ${allUsers.length} users...`);

            let successCount = 0;
            let failCount = 0;
            const failedUsers = [];

            // Send message to each user
            for (const user of allUsers) {
                try {
                    await this.bot.sendMessage(user.user_id, `Admin Broadcast\n\n${message}\n\nThis is an automated message from admin`);
                    successCount++;
                    
                    // Add small delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.error(`Failed to send to user ${user.user_id}:`, error.message);
                    failCount++;
                    failedUsers.push(user.user_id);
                }
            }

            // Send broadcast result to admin
            const resultText = `Broadcast Completed

Success: ${successCount} users
Failed: ${failCount} users
Total: ${allUsers.length} users

${failCount > 0 ? `\nFailed users: ${failedUsers.slice(0, 10).join(', ')}${failedUsers.length > 10 ? '...' : ''}` : ''}

Message: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`;

            await this.bot.editMessageText(resultText, {
                chat_id: chatId,
                message_id: loadingMsg.message_id
            });

        } catch (error) {
            console.error('Broadcast error:', error);
            await this.bot.sendMessage(chatId, `Broadcast failed: ${error.message}`);
        }
    }

    // Broadcast to active users only
    async handleBroadcastActive(msg, match) {
        const chatId = msg.chat.id;
        const userId = String(chatId);

        if (userId !== ADMIN_USER_ID) {
            await this.bot.sendMessage(chatId, "You are not authorized to use this command.");
            return;
        }

        const message = match[1];
        if (!message) {
            await this.bot.sendMessage(chatId, "Usage: /msg your_message_here\nExample: /msg Important update for active users!");
            return;
        }

        try {
            // Get active users (users who have used the bot recently)
            const activeUsers = await this.db.all(`
                SELECT DISTINCT user_id FROM bot_sessions 
                WHERE last_activity > datetime('now', '-7 days')
                UNION 
                SELECT DISTINCT user_id FROM users 
                WHERE created_at > datetime('now', '-7 days')
            `);
            
            if (activeUsers.length === 0) {
                await this.bot.sendMessage(chatId, "No active users found in the last 7 days.");
                return;
            }

            const loadingMsg = await this.bot.sendMessage(chatId, `Starting broadcast to ${activeUsers.length} active users...`);

            let successCount = 0;
            let failCount = 0;

            for (const user of activeUsers) {
                try {
                    await this.bot.sendMessage(user.user_id, `\n${message}\n`);
                    successCount++;
                    
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.error(`Failed to send to active user ${user.user_id}:`, error.message);
                    failCount++;
                }
            }

            const resultText = `Active Users Broadcast Completed

Success: ${successCount} users
Failed: ${failCount} users
Total Active: ${activeUsers.length} users

Message: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`;

            await this.bot.editMessageText(resultText, {
                chat_id: chatId,
                message_id: loadingMsg.message_id
            });

        } catch (error) {
            console.error('Active broadcast error:', error);
            await this.bot.sendMessage(chatId, `Active broadcast failed: ${error.message}`);
        }
    }

    // Auto betting loop
    startAutoBetting(userId) {
        const userSession = userSessions[userId];
        if (!userSession || !userSession.apiInstance) return;

        let lastIssue = "";
        let consecutiveFailures = 0;
        const maxFailures = 3;

        const bettingLoop = async () => {
            if (!autoBettingTasks[userId]) return;

            try {
                if (waitingForResults[userId]) {
                    setTimeout(bettingLoop, 5000);
                    return;
                }

                const currentIssue = await userSession.apiInstance.getCurrentIssue();
                
                if (currentIssue && currentIssue !== lastIssue) {
                    console.log(`New issue detected: ${currentIssue} for user ${userId}`);
                    
                    setTimeout(async () => {
                        if (!(await this.hasUserBetOnIssue(userId, userSession.platform, currentIssue))) {
                            await this.placeAutoBet(userId, currentIssue);
                            lastIssue = currentIssue;
                            consecutiveFailures = 0;
                        } else {
                            console.log(`User ${userId} already bet on issue ${currentIssue}`);
                        }
                        bettingLoop();
                    }, 3000);
                } else {
                    setTimeout(bettingLoop, 5000);
                }
            } catch (error) {
                console.error(`Auto betting error for user ${userId}:`, error);
                consecutiveFailures++;
                if (consecutiveFailures >= maxFailures) {
                    this.bot.sendMessage(userId, "Auto Bot Stopped - Too many errors!").catch(console.error);
                    delete autoBettingTasks[userId];
                    delete waitingForResults[userId];
                    this.saveBotSession(userId, false);
                } else {
                    setTimeout(bettingLoop, 10000);
                }
            }
        };

        bettingLoop();
    }

    // SL Betting loop
    startSlBetting(userId) {
        const userSession = userSessions[userId];
        if (!userSession || !userSession.apiInstance) return;

        let lastIssue = "";
        let consecutiveFailures = 0;
        const maxFailures = 3;

        const bettingLoop = async () => {
            if (!autoBettingTasks[userId]) return;

            try {
                if (waitingForResults[userId]) {
                    setTimeout(bettingLoop, 5000);
                    return;
                }

                const currentIssue = await userSession.apiInstance.getCurrentIssue();
                
                if (currentIssue && currentIssue !== lastIssue) {
                    console.log(`New issue detected: ${currentIssue} for user ${userId} in SL Bot`);
                    
                    setTimeout(async () => {
                        if (!(await this.hasUserBetOnIssue(userId, userSession.platform, currentIssue))) {
                            await this.placeSlBet(userId, currentIssue);
                            lastIssue = currentIssue;
                            consecutiveFailures = 0;
                        } else {
                            console.log(`User ${userId} already bet on issue ${currentIssue} in SL Bot`);
                        }
                        bettingLoop();
                    }, 5000);
                } else {
                    setTimeout(bettingLoop, 5000);
                }
            } catch (error) {
                console.error(`SL betting error for user ${userId}:`, error);
                consecutiveFailures++;
                if (consecutiveFailures >= maxFailures) {
                    this.bot.sendMessage(userId, "SL Bot Stopped - Too many errors!").catch(console.error);
                    delete autoBettingTasks[userId];
                    delete waitingForResults[userId];
                } else {
                    setTimeout(bettingLoop, 10000);
                }
            }
        };

        bettingLoop();
    }

    async placeAutoBet(userId, issue) {
        const userSession = userSessions[userId];
        if (!userSession.loggedIn) return;

        waitingForResults[userId] = true;

        const randomMode = await this.getUserSetting(userId, 'random_betting', 'bot');
        
        // Formula patterns
        const patternsData = await this.getFormulaPatterns(userId);
        const bsPattern = patternsData.bs_pattern || "";
        const colourPattern = patternsData.colour_pattern || "";
        
        let betType, betTypeStr, betModeInfo = "";

        // BS Formula Pattern Mode - Priority 1
        if (bsPattern && bsPattern !== "") {
            const patternArray = bsPattern.split(',').map(p => p.trim());
            const currentIndex = patternsData.bs_current_index || 0;
            
            if (currentIndex < patternArray.length) {
                const patternChar = patternArray[currentIndex].toUpperCase();
                if (patternChar === 'B') {
                    betType = 13;
                    betTypeStr = "BIG (BS Formula)";
                } else if (patternChar === 'S') {
                    betType = 14;
                    betTypeStr = "SMALL (BS Formula)";
                } else {
                    betType = Math.random() < 0.5 ? 13 : 14;
                    betTypeStr = betType === 13 ? "BIG" : "SMALL";
                }
                
                const newIndex = (currentIndex + 1) % patternArray.length;
                await this.db.run(
                    'UPDATE formula_patterns SET bs_current_index = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                    [newIndex, userId]
                );
                
                betModeInfo = `\nPattern: ${bsPattern} (Position: ${currentIndex + 1})`;
            } else {
                betType = Math.random() < 0.5 ? 13 : 14;
                betTypeStr = betType === 13 ? "BIG" : "SMALL";
            }
        }
        // Colour Formula Pattern Mode - Priority 2
        else if (colourPattern && colourPattern !== "") {
            const patternArray = colourPattern.split(',').map(p => p.trim());
            const currentIndex = patternsData.colour_current_index || 0;
            
            if (currentIndex < patternArray.length) {
                const patternChar = patternArray[currentIndex].toUpperCase();
                if (patternChar === 'R') {
                    betType = COLOUR_BET_TYPES["RED"];
                    betTypeStr = "RED (Colour Formula)";
                } else if (patternChar === 'G') {
                    betType = COLOUR_BET_TYPES["GREEN"];
                    betTypeStr = "GREEN (Colour Formula)";
                } else if (patternChar === 'V') {
                    betType = COLOUR_BET_TYPES["VIOLET"];
                    betTypeStr = "VIOLET (Colour Formula)";
                } else {
                    const colours = ["RED", "GREEN", "VIOLET"];
                    const randomColour = colours[Math.floor(Math.random() * colours.length)];
                    betType = COLOUR_BET_TYPES[randomColour];
                    betTypeStr = `${randomColour}`;
                }
                
                const newIndex = (currentIndex + 1) % patternArray.length;
                await this.db.run(
                    'UPDATE formula_patterns SET colour_current_index = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                    [newIndex, userId]
                );
                
                betModeInfo = `\nPattern: ${colourPattern} (Position: ${currentIndex + 1})`;
            } else {
                const colours = ["RED", "GREEN", "VIOLET"];
                const randomColour = colours[Math.floor(Math.random() * colours.length)];
                betType = COLOUR_BET_TYPES[randomColour];
                betTypeStr = `${randomColour}`;
            }
        }
        // Normal Random Modes - Priority 3
        else if (randomMode === 'big') {
            betType = 13;
            betTypeStr = "BIG";
            betModeInfo = "\nMode: Random BIG Only";
        } else if (randomMode === 'small') {
            betType = 14;
            betTypeStr = "SMALL";
            betModeInfo = "\nMode: Random SMALL Only";
        } else if (randomMode === 'follow') {
            const followResult = await this.getFollowBetType(userSession.apiInstance);
            betType = followResult.betType;
            betTypeStr = followResult.betTypeStr;
            betModeInfo = "\nMode: Follow Bot";
        } else {
            betType = Math.random() < 0.5 ? 13 : 14;
            betTypeStr = betType === 13 ? "BIG" : "SMALL";
            betModeInfo = "\nMode: Random Bot";
        }

        const amount = await this.getCurrentBetAmount(userId);
        const balance = await userSession.apiInstance.getBalance();

        if (amount > 0 && balance < amount) {
            this.bot.sendMessage(userId, `Insufficient Balance!\n\nNeed: ${amount.toLocaleString()} K\nAvailable: ${balance.toLocaleString()} K`).catch(console.error);
            delete autoBettingTasks[userId];
            delete waitingForResults[userId];
            return;
        }

        try {
            const result = await userSession.apiInstance.placeBet(amount, betType);
            
            if (result.success) {
                await this.savePendingBet(userId, userSession.platform, result.issueId, betTypeStr, amount);
                await this.updateBotStats(userId);
                
                if (!issueCheckers[userId]) {
                    this.startIssueChecker(userId);
                }

                const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
                const betText = `Auto Bet Placed!\n\nIssue: ${result.issueId}\nType: ${betTypeStr}\nAmount: ${amount.toLocaleString()} K (Step ${currentIndex + 1})`;

                this.bot.sendMessage(userId, betText).catch(console.error);
            } else {
                this.bot.sendMessage(userId, `Auto Bet Failed\n\nError: ${result.message}`).catch(console.error);
                waitingForResults[userId] = false;
            }
        } catch (error) {
            console.error(`Auto bet placement error:`, error);
            waitingForResults[userId] = false;
        }
    }

 async placeSlBet(userId, issue) {
    const userSession = userSessions[userId];
    if (!userSession.loggedIn) return;

    if (!autoBettingTasks[userId]) return;

    waitingForResults[userId] = true;

    const slPatternData = await this.getSlPattern(userId);
    const slSession = await this.getSlBetSession(userId);
    const patternsData = await this.getFormulaPatterns(userId);

    const currentSl = slPatternData.current_sl;
    const currentBetCount = slPatternData.bet_count;
    const waitLossCount = slPatternData.wait_loss_count;

    console.log(`DEBUG: SL Bot Bet - Current Bet Count: ${currentBetCount}, SL: ${currentSl}, Wait Mode: ${slSession.is_wait_mode}`);

    // SL Pattern List
    const patternList = slPatternData.pattern.split(',').map(x => parseInt(x.trim()));
    const currentWaitLossLimit = patternList[slPatternData.current_index] || patternList[patternList.length - 1];

    // Check if Bet Limit Reached (3 bets)
    if (!slSession.is_wait_mode && currentBetCount >= 3) {
        console.log(`DEBUG: Bet Count limit reached (${currentBetCount}/3), moving to next SL level`);
        
        // Move to next SL level
        const currentIndex = slPatternData.current_index;
        const newIndex = (currentIndex + 1) % patternList.length;
        const newSl = patternList[newIndex];
        
        // Check if new SL requires Wait Mode
        const isNewWaitMode = newSl >= 2;
        
        console.log(`DEBUG: Moving from SL ${currentSl} to SL ${newSl}, Wait Mode: ${isNewWaitMode}`);
        
        // Reset wait loss count and bet count
        await this.saveSlBetSession(userId, isNewWaitMode, '', '', 0, 0);
        await this.updateSlPattern(userId, newSl, newIndex, 0, 0);

        // Send notification
        const modeText = isNewWaitMode ? "WAIT BOT" : "BETTING";
        const changeMessage = `SL LEVEL CHANGED!

SL Layer: ${slPatternData.pattern}
From SL ${currentSl} to SL ${newSl}
New Mode: ${modeText}
Bet Count: 0/3
Wait Loss: 0/${newSl}`;

        await this.bot.sendMessage(userId, changeMessage);
        waitingForResults[userId] = false;
        return;
    }

    const currentMainIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
    const betSequence = await this.getUserSetting(userId, 'bet_sequence', '100,300,700,1600,3200,7600,16000,32000');
    const amounts = betSequence.split(',').map(x => parseInt(x.trim()));

    let currentAmount;
    if (currentMainIndex < amounts.length) {
        currentAmount = amounts[currentMainIndex];
    } else {
        currentAmount = amounts[0] || 100;
        await this.saveUserSetting(userId, 'current_bet_index', 0);
    }

    console.log(`SL BOT BET PLACEMENT - Wait Mode: ${slSession.is_wait_mode}, Current Bet Count: ${currentBetCount}, Amount: ${currentAmount}K, SL: ${currentSl}`);

    if (slSession.is_wait_mode) {
        // WAIT MODE - No actual betting, just wait for results
        console.log(`WAIT BOT MODE - SL ${currentSl} - Wait Loss: ${waitLossCount}/${currentWaitLossLimit}`);
        
        // Determine which pattern to use for display
        let nextBet, currentPatternIndex, formulaType;
        if (patternsData.bs_pattern) {
            const result = await this.getNextFormulaBet(userId, 'bs');
            nextBet = result.nextBet;
            currentPatternIndex = result.currentIndex;
            formulaType = "BS Formula";
        } else if (patternsData.colour_pattern) {
            const result = await this.getNextFormulaBet(userId, 'colour');
            nextBet = result.nextBet;
            currentPatternIndex = result.currentIndex;
            formulaType = "Colour Formula";
        } else {
            nextBet = null;
            formulaType = "Auto";
        }

        let betTypeStr;
        if (nextBet) {
            if (nextBet === 'B') {
                betTypeStr = `BIG (${formulaType} - WAIT)`;
            } else if (nextBet === 'S') {
                betTypeStr = `SMALL (${formulaType} - WAIT)`;
            } else if (nextBet === 'R') {
                betTypeStr = `RED (${formulaType} - WAIT)`;
            } else if (nextBet === 'G') {
                betTypeStr = `GREEN (${formulaType} - WAIT)`;
            } else if (nextBet === 'V') {
                betTypeStr = `VIOLET (${formulaType} - WAIT)`;
            } else {
                betTypeStr = `UNKNOWN (${formulaType} - WAIT)`;
            }
        } else {
            const fallback = await this.getFollowBetType(userSession.apiInstance);
            betTypeStr = `${fallback.betTypeStr} (WAIT)`;
        }

        // Save pending bet for result checking (amount = 0 for wait mode)
        await this.savePendingBet(userId, userSession.platform, issue, betTypeStr, 0);

        if (!issueCheckers[userId]) {
            this.startIssueChecker(userId);
        }

        const waitMessage = `SL Bot - Wait Mode

SL Level: ${currentSl}
Issue: ${issue}
Type: Waiting for result...
Wait Loss: ${waitLossCount}/${currentWaitLossLimit}
`;

        await this.bot.sendMessage(userId, waitMessage);
        waitingForResults[userId] = false;
    } else {
        // BETTING MODE - Actual betting
        console.log(`BETTING MODE - SL ${currentSl} - Bet Count: ${currentBetCount}/3`);
        
        let betType, betTypeStr, currentPatternIndex, formulaType;

        // Determine which pattern to use
        if (patternsData.bs_pattern) {
            const result = await this.getNextFormulaBet(userId, 'bs');
            const nextBet = result.nextBet;
            currentPatternIndex = result.currentIndex;
            formulaType = "BS Formula";
            
            if (nextBet === 'B') {
                betType = 13;
                betTypeStr = `BIG (${formulaType})`;
            } else if (nextBet === 'S') {
                betType = 14;
                betTypeStr = `SMALL (${formulaType})`;
            } else {
                const fallback = await this.getFollowBetType(userSession.apiInstance);
                betType = fallback.betType;
                betTypeStr = fallback.betTypeStr;
            }
        } else if (patternsData.colour_pattern) {
            const result = await this.getNextFormulaBet(userId, 'colour');
            const nextBet = result.nextBet;
            currentPatternIndex = result.currentIndex;
            formulaType = "Colour Formula";
            
            if (nextBet === 'R') {
                betType = COLOUR_BET_TYPES["RED"];
                betTypeStr = `RED (${formulaType})`;
            } else if (nextBet === 'G') {
                betType = COLOUR_BET_TYPES["GREEN"];
                betTypeStr = `GREEN (${formulaType})`;
            } else if (nextBet === 'V') {
                betType = COLOUR_BET_TYPES["VIOLET"];
                betTypeStr = `VIOLET (${formulaType})`;
            } else {
                const colours = ["RED", "GREEN", "VIOLET"];
                const randomColour = colours[Math.floor(Math.random() * colours.length)];
                betType = COLOUR_BET_TYPES[randomColour];
                betTypeStr = randomColour;
            }
        } else {
            const fallback = await this.getFollowBetType(userSession.apiInstance);
            betType = fallback.betType;
            betTypeStr = fallback.betTypeStr;
        }

        const amount = currentAmount;
        const balance = await userSession.apiInstance.getBalance();

        if (amount > 0 && balance < amount) {
            this.bot.sendMessage(userId, `Insufficient Balance!\n\nNeed: ${amount.toLocaleString()} K\nAvailable: ${balance.toLocaleString()} K`).catch(console.error);
            delete autoBettingTasks[userId];
            delete waitingForResults[userId];
            return;
        }

        try {
            const result = await userSession.apiInstance.placeBet(amount, betType);
            
            if (result.success) {
                // Increment bet count
                const nextBetCount = currentBetCount + 1;
                console.log(`DEBUG: Bet placed - Bet Count: ${currentBetCount} -> ${nextBetCount}`);
                
                await this.updateSlPattern(userId, null, null, null, nextBetCount);
                
                await this.savePendingBet(userId, userSession.platform, result.issueId, betTypeStr, amount);
                await this.updateBotStats(userId);
                
                if (!issueCheckers[userId]) {
                    this.startIssueChecker(userId);
                }

                const betMessage = `SL Bot - Active Bet

SL Level: ${currentSl}
Issue: ${result.issueId}
Type: ${betTypeStr}
Amount: ${amount.toLocaleString()} K
Bet Count: ${nextBetCount}/3
`;

                await this.bot.sendMessage(userId, betMessage);
            } else {
                await this.bot.sendMessage(userId, `SL Bot Bet Failed\n\nError: ${result.message}`);
                waitingForResults[userId] = false;
            }
        } catch (error) {
            console.error(`SL bet placement error:`, error);
            waitingForResults[userId] = false;
        }
    }
}

async checkSlBetResult(userId, issue, betTypeStr, amount, platform, result, profitLoss) {
    try {
        console.log(`DEBUG: SL Bet Result Check - Issue: ${issue}, Result: ${result}, BetType: ${betTypeStr}`);

        const slPatternData = await this.getSlPattern(userId);
        const slSession = await this.getSlBetSession(userId);

        const currentSl = slPatternData.current_sl;
        const currentBetCount = slPatternData.bet_count;
        const waitLossCount = slPatternData.wait_loss_count;

        console.log(`DEBUG: Current SL: ${currentSl}, Bet Count: ${currentBetCount}, Wait Loss: ${waitLossCount}, Wait Mode: ${slSession.is_wait_mode}`);

        const botSession = await this.getBotSession(userId);
        const totalProfit = botSession.total_profit;

        // Pattern list
        const patternList = slPatternData.pattern.split(',').map(x => parseInt(x.trim()));
        const currentIndex = slPatternData.current_index;
        const currentWaitLossLimit = patternList[currentIndex] || patternList[patternList.length - 1];

        // Bet sequence update
        const currentMainIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
        const betSequence = await this.getUserSetting(userId, 'bet_sequence', '100,300,700,1600,3200,7600,16000,32000');
        const amounts = betSequence.split(',').map(x => parseInt(x.trim()));

        if (!slSession.is_wait_mode) {
            if (result === "WIN") {
                const newMainIndex = await this.updateBetSequence(userId, "WIN");
                console.log(`WIN - Sequence reset to Step 1`);
            } else {
                const newMainIndex = await this.updateBetSequence(userId, "LOSE");
                const nextAmount = amounts[newMainIndex] || amounts[0];
                console.log(`LOSE - Next bet: Step ${newMainIndex + 1} (${nextAmount}K)`);
            }
        }

        // 🔥 MAIN LOGIC: SL Pattern Processing
        let newBetCount = currentBetCount;
        let newWaitLossCount = waitLossCount;
        let slChanged = false;
        let newSl = currentSl;
        let newIndex = currentIndex;
        let isNewWaitMode = slSession.is_wait_mode;

        if (slSession.is_wait_mode) {
            // ===== WAIT MODE =====
            console.log(`WAIT MODE Processing - SL ${currentSl}, Wait Loss: ${waitLossCount}/${currentWaitLossLimit}`);
            
            if (result === "WIN") {
                // WIN in Wait Mode: Reset wait loss count (stay in Wait Mode)
                newWaitLossCount = 0;
                isNewWaitMode = true;
                console.log(`WAIT MODE WIN - Wait Loss Reset to 0, staying in WAIT MODE`);
                
                await this.bot.sendMessage(userId, `WAIT BOT - WIN!\n\nWait Loss Reset: 0/${currentWaitLossLimit}\nStill in WAIT MODE for SL ${currentSl}`);
            } else {
                // LOSS in Wait Mode: Increment wait loss count
                newWaitLossCount = waitLossCount + 1;
                console.log(`WAIT MODE LOSS - Wait Loss: ${waitLossCount} -> ${newWaitLossCount}`);
                
                // Check if wait loss limit reached
                if (newWaitLossCount >= currentWaitLossLimit) {
                    // Wait limit reached → Move to next SL
                    const nextIndex = (currentIndex + 1) % patternList.length;
                    newIndex = nextIndex;
                    newSl = patternList[nextIndex];
                    
                    // Check if new SL is wait mode (SL >= 2)
                    isNewWaitMode = newSl >= 2;
                    
                    // Reset counts for new SL
                    newWaitLossCount = 0;
                    newBetCount = 0;
                    slChanged = true;
                    
                    console.log(`WAIT LIMIT REACHED! Moving from SL ${currentSl} to SL ${newSl}, Wait Mode: ${isNewWaitMode}`);
                    
                    await this.bot.sendMessage(userId, `WAIT LIMIT REACHED!\n\nSL ${currentSl} -> SL ${newSl}\nMode: ${isNewWaitMode ? 'WAIT BOT' : 'BETTING'}\nCounts Reset`);
                } else {
                    // Still in wait mode
                    isNewWaitMode = true;
                    await this.bot.sendMessage(userId, `WAIT BOT - LOSS!\n\nWait Loss: ${newWaitLossCount}/${currentWaitLossLimit}\nStill in WAIT MODE for SL ${currentSl}`);
                }
            }
        } else {
            // ===== BETTING MODE =====
            console.log(`BETTING MODE Processing - SL ${currentSl}, Bet Count: ${currentBetCount}/3`);
            
            if (result === "WIN") {
                // WIN in Betting Mode → Reset everything back to first SL
                newSl = patternList[0];
                newIndex = 0;
                newBetCount = 0;
                newWaitLossCount = 0;
                
                // First SL is always BETTING mode (SL 1)
                isNewWaitMode = newSl >= 2;
                slChanged = true;
                
                console.log(`BETTING WIN! Reset to SL ${newSl}, Wait Mode: ${isNewWaitMode}`);
                
                // Reset formula patterns
                const patternsData = await this.getFormulaPatterns(userId);
                if (patternsData.bs_pattern) {
                    await this.db.run('UPDATE formula_patterns SET bs_current_index = 0 WHERE user_id = ?', [userId]);
                }
                if (patternsData.colour_pattern) {
                    await this.db.run('UPDATE formula_patterns SET colour_current_index = 0 WHERE user_id = ?', [userId]);
                }
                
                await this.bot.sendMessage(userId, `BET RESULT - WIN!\n\nResetting to SL ${newSl}\nMode: ${isNewWaitMode ? 'WAIT BOT' : 'BETTING'}\nBet Count: 0/3\nWait Loss: 0/${newSl}`);
                
            } else {
                // LOSS in Betting Mode
                newBetCount = currentBetCount; // Keep the same (already incremented in placeSlBet)
                
                // Check if bet count reached 3
                if (newBetCount >= 3) {
                    // 3 bets completed → Move to next SL
                    const nextIndex = (currentIndex + 1) % patternList.length;
                    newIndex = nextIndex;
                    newSl = patternList[nextIndex];
                    
                    // Check if new SL is wait mode (SL >= 2)
                    isNewWaitMode = newSl >= 2;
                    
                    // Reset counts for new SL
                    newWaitLossCount = 0;
                    newBetCount = 0;
                    slChanged = true;
                    
                    console.log(`3 BETS COMPLETED! Moving from SL ${currentSl} to SL ${newSl}, Wait Mode: ${isNewWaitMode}`);
                    
                    await this.bot.sendMessage(userId, `SL LEVEL CHANGED!\n\nBet Count: 3/3 reached\nSL ${currentSl} -> SL ${newSl}\nMode: ${isNewWaitMode ? 'WAIT BOT' : 'BETTING'}\nCounts Reset`);
                } else {
                    // Still in betting mode
                    isNewWaitMode = false;
                    await this.bot.sendMessage(userId, `BET RESULT - LOSE!\n\nBet Count: ${newBetCount}/3\nContinuing BETTING MODE for SL ${currentSl}`);
                }
            }
        }

        // Save updated SL pattern
        if (slChanged || newWaitLossCount !== waitLossCount || newBetCount !== currentBetCount) {
            await this.saveSlBetSession(userId, isNewWaitMode, '', '', 0, 0);
            await this.updateSlPattern(userId, newSl, newIndex, newWaitLossCount, newBetCount);
            console.log(`DEBUG: SL Pattern Updated - SL: ${newSl}, Index: ${newIndex}, Wait Loss: ${newWaitLossCount}, Bet Count: ${newBetCount}`);
        }

        await this.checkProfitLossTargets(userId, botSession);

        if (waitingForResults[userId]) {
            waitingForResults[userId] = false;
        }

    } catch (error) {
        console.error(`Error processing SL bet result: ${error}`);
        if (waitingForResults[userId]) {
            waitingForResults[userId] = false;
        }
    }
}

async processSkipBetForSlChange(userId, issue, platform) {
    try {
        console.log(`Processing SKIP bet - User: ${userId}, Issue: ${issue}`);

        const userSession = userSessions[userId];
        const results = await userSession.apiInstance.getRecentResults(5);
        
        let actualResult = "UNKNOWN";
        
        // Get the actual result for this issue
        for (const result of results) {
            if (result.issueNumber === issue) {
                const number = result.number || 'N/A';
                if (['0','1','2','3','4'].includes(number)) {
                    actualResult = "SMALL";
                } else {
                    actualResult = "BIG";
                }
                break;
            }
        }

        const slPatternData = await this.getSlPattern(userId);
        const slSession = await this.getSlBetSession(userId);
        
        const currentSl = slPatternData.current_sl;
        const currentBetCount = slPatternData.bet_count;
        const waitLossCount = slPatternData.wait_loss_count;
        const patternList = slPatternData.pattern.split(',').map(x => parseInt(x.trim()));
        const currentIndex = slPatternData.current_index;
        const currentWaitLossLimit = patternList[currentIndex] || patternList[patternList.length - 1];

        console.log(`DEBUG: SKIP Processing - SL: ${currentSl}, Bet Count: ${currentBetCount}, Wait Loss: ${waitLossCount}`);

        // SKIP bet is treated as LOSS for SL progression
        let newSl = currentSl;
        let newIndex = currentIndex;
        let newWaitLossCount = waitLossCount;
        let newBetCount = currentBetCount;
        let isNewWaitMode = slSession.is_wait_mode;
        let slChanged = false;

        if (slSession.is_wait_mode) {
            // In WAIT MODE, SKIP = LOSS
            newWaitLossCount = waitLossCount + 1;
            
            if (newWaitLossCount >= currentWaitLossLimit) {
                // Move to next SL
                newIndex = (currentIndex + 1) % patternList.length;
                newSl = patternList[newIndex];
                isNewWaitMode = newSl >= 2;
                newWaitLossCount = 0;
                newBetCount = 0;
                slChanged = true;
            }
        } else {
            // In BETTING MODE, SKIP = LOSS
            if (newBetCount >= 3) {
                // Move to next SL
                newIndex = (currentIndex + 1) % patternList.length;
                newSl = patternList[newIndex];
                isNewWaitMode = newSl >= 2;
                newWaitLossCount = 0;
                newBetCount = 0;
                slChanged = true;
            }
        }

        if (slChanged) {
            await this.saveSlBetSession(userId, isNewWaitMode, '', '', 0, 0);
            await this.updateSlPattern(userId, newSl, newIndex, newWaitLossCount, newBetCount);
            
            await this.bot.sendMessage(userId, `SL LEVEL CHANGED!\n\nSL ${currentSl} -> SL ${newSl}\nMode: ${isNewWaitMode ? 'WAIT BOT' : 'BETTING'}\nCounts Reset`);
        } else {
            // Update wait loss or bet count
            await this.updateSlPattern(userId, null, null, newWaitLossCount, newBetCount);
            
            if (slSession.is_wait_mode) {
                await this.bot.sendMessage(userId, `WAIT BOT - SKIP (LOSS)\n\nWait Loss: ${newWaitLossCount}/${currentWaitLossLimit}`);
            } else {
                await this.bot.sendMessage(userId, `BETTING MODE - SKIP (LOSS)\n\nBet Count: ${newBetCount}/3`);
            }
        }
        
        // Remove the pending bet
        await this.db.run(
            'DELETE FROM pending_bets WHERE user_id = ? AND platform = ? AND issue = ?',
            [userId, platform, issue]
        );

        if (waitingForResults[userId]) {
            waitingForResults[userId] = false;
        }

    } catch (error) {
        console.error(`Error processing SKIP bet:`, error);
        if (waitingForResults[userId]) {
            waitingForResults[userId] = false;
        }
    }
}

    async checkSlBetResult(userId, issue, betTypeStr, amount, platform, result, profitLoss) {
    try {
        console.log(`DEBUG: SL Bet Result Check Started - Issue: ${issue}, User: ${userId}, Result: ${result}, BetType: ${betTypeStr}`);

        const slPatternData = await this.getSlPattern(userId);
        const slSession = await this.getSlBetSession(userId);

        const currentSl = slPatternData.current_sl;
        const currentBetCount = slPatternData.bet_count;
        const waitLossCount = slPatternData.wait_loss_count;

        console.log(`DEBUG: SL: ${currentSl}, Current Bet Count: ${currentBetCount}, Wait Loss Count: ${waitLossCount}, Wait Mode: ${slSession.is_wait_mode}`);

        const botSession = await this.getBotSession(userId);
        const totalProfit = botSession.total_profit;

        // Get current bet sequence information
        const currentMainIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
        const betSequence = await this.getUserSetting(userId, 'bet_sequence', '100,300,700,1600,3200,7600,16000,32000');
        const amounts = betSequence.split(',').map(x => parseInt(x.trim()));

        console.log(`BEFORE Sequence Update - Current Index: ${currentMainIndex}, Current Amount: ${amounts[currentMainIndex] || amounts[0]}K`);

        let sequenceInfo = "";
        if (!slSession.is_wait_mode) {
            if (result === "WIN") {
                const newMainIndex = await this.updateBetSequence(userId, "WIN");
                sequenceInfo = `Sequence Reset: Back to Step 1`;
                console.log(`WIN - Sequence reset to Step 1 (10K)`);
            } else {
                const newMainIndex = await this.updateBetSequence(userId, "LOSE");
                const nextAmount = amounts[newMainIndex] || amounts[0];
                sequenceInfo = `Next Bet: Step ${newMainIndex + 1} (${nextAmount.toLocaleString()} K)`;
                console.log(`LOSE - Next bet will be: Step ${newMainIndex + 1} (${nextAmount}K)`);
            }
        } else {
            sequenceInfo = "Status: Wait Bot Mode - Sequence Frozen";
            console.log(`WAIT BOT MODE - Sequence frozen`);
        }

        // 🟢 FIX: Bet Count နဲ့ Wait Loss Count ကို မှန်ကန်စွာ ပြောင်းလဲပါ
        let newBetCount = currentBetCount;
        let newWaitLossCount = waitLossCount;

        if (slSession.is_wait_mode) {
            // Wait Bot Mode
            if (result === "WIN") {
                // Win ရင် Wait Loss Count = 0 ပြန်စမယ်
                newWaitLossCount = 0;
                console.log(`DEBUG: WAIT BOT WIN - Wait Loss Count reset to 0`);
            } else {
                // Loss ရင် Wait Loss Count +1 တိုးမယ်
                newWaitLossCount = waitLossCount + 1;
                console.log(`DEBUG: WAIT BOT LOSS - Wait Loss Count updated: ${waitLossCount} -> ${newWaitLossCount}`);
            }
        } else {
            // 🟢 FIX: Betting Mode
            if (result === "WIN") {
                // Win ရင် Bet Count ကို 0 ပြန်စမယ်
                newBetCount = 0;
                console.log(`DEBUG: BETTING WIN - Bet Count reset to 0`);
                
                // Win ရင် SL ကို ပထမဆုံး SL ကို ပြန်သွားမယ်
                const patternList = slPatternData.pattern.split(',').map(x => parseInt(x.trim()));
                const firstSl = patternList[0];
                const isWaitMode = firstSl >= 2;
                
                await this.saveSlBetSession(userId, isWaitMode, '', '', 0, 0);
                await this.updateSlPattern(userId, firstSl, 0, 0, 0);
                
                // Formula patterns ကို ပြန်စမယ်
                const patternsData = await this.getFormulaPatterns(userId);
                if (patternsData.bs_pattern) {
                    await this.db.run(
                        'UPDATE formula_patterns SET bs_current_index = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                        [userId]
                    );
                }
                if (patternsData.colour_pattern) {
                    await this.db.run(
                        'UPDATE formula_patterns SET colour_current_index = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                        [userId]
                    );
                }
                
                const modeText = isWaitMode ? "WAIT BOT" : "BETTING";
                const winMessage = `BET RESULT - WIN!

PROFIT: ${totalProfit.toLocaleString()} K
SL Level Changed: Back to SL ${firstSl}
Mode: ${modeText}
Bet Count: 0/3`;

                await this.bot.sendMessage(userId, winMessage);
                return;
            } else {
                // Loss ရင် Bet Count ကို မပြင်ဘူး (placeSlBet မှာ +1 လုပ်ပြီးသား)
                newBetCount = currentBetCount;
                console.log(`DEBUG: BETTING LOSS - Bet Count remains: ${currentBetCount}`);
                
                // 🟢 FIX: LOSS Message for Betting Mode with CORRECT bet count
                const lossMessage = `BET RESULT - LOSE

PROFIT: ${totalProfit.toLocaleString()} K
Bet Count: ${newBetCount}/3`;

                await this.bot.sendMessage(userId, lossMessage);

                // Check if bet count reached 3
                if (newBetCount >= 3) {
                    const patternList = slPatternData.pattern.split(',').map(x => parseInt(x.trim()));
                    const currentIndex = slPatternData.current_index;
                    const newIndex = (currentIndex + 1) % patternList.length;
                    const newSl = patternList[newIndex];

                    const isWaitMode = newSl >= 2;
                    await this.saveSlBetSession(userId, isWaitMode, '', '', 0, 0);
                    await this.updateSlPattern(userId, newSl, newIndex, 0, 0);

                    const modeText = isWaitMode ? "WAIT BOT" : "BETTING";
                    await this.bot.sendMessage(
                        userId, 
                        `SL LEVEL CHANGED!\n\nBet Count: ${newBetCount}/3 reached\nMoving from SL ${currentSl} to SL ${newSl}\nNew Mode: ${modeText}`
                    );
                }
            }
        }

        // Update SL pattern with new counts (for Wait Mode only)
        if (slSession.is_wait_mode) {
            await this.updateSlPattern(userId, null, null, newWaitLossCount, newBetCount);
            
            // Check if wait loss limit reached
            const patternList = slPatternData.pattern.split(',').map(x => parseInt(x.trim()));
            const currentIndex = slPatternData.current_index;
            const currentWaitLossLimit = patternList[currentIndex] || patternList[patternList.length - 1];
            
            if (newWaitLossCount >= currentWaitLossLimit) {
                // Wait limit reached, switch to BETTING mode
                await this.saveSlBetSession(userId, false, '', '', 0, 0);
                await this.updateSlPattern(userId, null, null, 0, 0);
                
                const transitionMessage = `Wait Loss Limit Reached!

Wait Loss: ${newWaitLossCount}/${currentWaitLossLimit}
Switching to BETTING Mode
Bet Count: 0/3`;

                await this.bot.sendMessage(userId, transitionMessage);
            }
        }

        await this.checkProfitLossTargets(userId, botSession);

        if (waitingForResults[userId]) {
            waitingForResults[userId] = false;
        }

        console.log(`DEBUG: SL Bet Result Processing Completed - New Bet Count: ${newBetCount}, New Wait Loss Count: ${newWaitLossCount}`);

    } catch (error) {
        console.error(`Error processing SL bet result: ${error}`);
        if (waitingForResults[userId]) {
            waitingForResults[userId] = false;
        }
    }
}

    async getResultNumber(userId, issue) {
        try {
            const userSession = userSessions[userId];
            const results = await userSession.apiInstance.getRecentResults(5);
            
            for (const result of results) {
                if (result.issueNumber === issue) {
                    return result.number || 'N/A';
                }
            }
            return 'N/A';
        } catch (error) {
            return 'N/A';
        }
    }

    async checkProfitLossTargets(userId, botSession) {
        try {
            const profitTarget = await this.getUserSetting(userId, 'profit_target', 0);
            const lossTarget = await this.getUserSetting(userId, 'loss_target', 0);
            
            const netProfit = botSession.session_profit - botSession.session_loss;
            
            if (profitTarget > 0 && netProfit >= profitTarget) {
                // Profit target reached
                await this.bot.sendMessage(userId, `PROFIT TARGET REACHED!\n\n` +
                    `Target: ${profitTarget.toLocaleString()} K\n` +
                    `Actual Profit: ${netProfit.toLocaleString()} K\n\n` +
                    `Auto Bot has been stopped.`, {
                    reply_markup: this.getMainKeyboard()
                });
                
                // Stop the bot
                if (autoBettingTasks[userId]) {
                    delete autoBettingTasks[userId];
                }
                if (waitingForResults[userId]) {
                    delete waitingForResults[userId];
                }
                await this.saveBotSession(userId, false);
            }
            
            if (lossTarget > 0 && botSession.session_loss >= lossTarget) {
                // Loss target reached
                await this.bot.sendMessage(userId, `LOSS TARGET REACHED!\n\n` +
                    `Target: ${lossTarget.toLocaleString()} K\n` +
                    `Actual Loss: ${botSession.session_loss.toLocaleString()} K\n\n` +
                    `Auto Bot has been stopped.`, {
                    reply_markup: this.getMainKeyboard()
                });
                
                // Stop the bot
                if (autoBettingTasks[userId]) {
                    delete autoBettingTasks[userId];
                }
                if (waitingForResults[userId]) {
                    delete waitingForResults[userId];
                }
                await this.saveBotSession(userId, false);
            }
        } catch (error) {
            console.error(`Error checking profit/loss targets:`, error);
        }
    }
}

// Start the bot
console.log("Auto Lottery Bot starting...");
console.log("Game ID Restriction System: ENABLED");
console.log("Admin Commands: /aid, /rid, /ids, /gats");
console.log("Admin Broadcast: /broadcast, /msg");
console.log(`Admin User ID: ${ADMIN_USER_ID}`);
console.log("Features: Wait for Win/Loss before next bet");
console.log("Modes: BIG Only, SMALL Only, Random Bot, Follow Bot");
console.log("BS Formula Pattern Betting System (B,S only)");
console.log("Colour Formula Pattern Betting System (G,R,V only)");
console.log("SL Layer Pattern Betting System - BS/COLOUR PATTERN MODE REQUIRED");
console.log("Bet Sequence System: 100,300,700,1600,3200,7600,16000,32000");
console.log("Profit/Loss Target System");
console.log("Auto Statistics Tracking");
console.log("Colour Betting Support (RED, GREEN, VIOLET)");
console.log("Supported Platforms: 777 Big Win");
console.log("Myanmar Time System: ENABLED");
console.log("Press Ctrl+C to stop.");

const bot = new AutoLotteryBot();

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down bot...');
    process.exit();
});

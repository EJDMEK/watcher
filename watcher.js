require('dotenv').config();
const { ethers } = require("ethers");
const TelegramBot = require('node-telegram-bot-api');

// --- CONFIGURATION ---
const WSS_URL = process.env.ALCHEMY_WSS_URL;
const CTF_EXCHANGE_ADDRESS = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";

// Configuration for Targets
const TARGET_WALLETS = (process.env.TARGET_WALLETS || process.env.TARGET_WALLET || "")
    .split(",")
    .map(a => a.trim().toLowerCase())
    .filter(a => a);

const BOT_NAME = process.env.BOT_NAME || "Polymarket Watcher";

// --- TELEGRAM SETUP ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
let telegramBot = null;
let lastBlockProcessed = 0;

if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
    // Enable polling to receive commands
    telegramBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
    console.log("📱 Telegram Bot Configured & Listening for commands...");

    // COMMAND: /status
    telegramBot.onText(/\/status/, (msg) => {
        if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID) return;
        const uptime = process.uptime();
        const statusMsg = `🤖 <b>${BOT_NAME} Status</b>\n\n` +
            `✅ Running: Yes\n` +
            `⏱ Uptime: ${Math.floor(uptime / 60)} min\n` +
            `📦 Last Block: ${lastBlockProcessed}\n` +
            `🎯 Targets: ${TARGET_WALLETS.length}`;
        telegramBot.sendMessage(TELEGRAM_CHAT_ID, statusMsg, { parse_mode: "HTML" });
    });

    // COMMAND: /ping
    telegramBot.onText(/\/ping/, (msg) => {
        if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID) return;
        telegramBot.sendMessage(TELEGRAM_CHAT_ID, `🏓 Pong! (${BOT_NAME})`);
    });

    // COMMAND: /targets
    telegramBot.onText(/\/targets/, (msg) => {
        if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID) return;
        telegramBot.sendMessage(TELEGRAM_CHAT_ID, `🎯 <b>Monitored Wallets:</b>\n\n${TARGET_WALLETS.join("\n")}`, { parse_mode: "HTML" });
    });
}

async function sendTelegramAlert(message) {
    if (!telegramBot) return;
    try {
        await telegramBot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: "HTML" });
    } catch (err) {
        console.error("⚠️ Failed to send Telegram:", err.message);
    }
}

// Minimal ABI for Events
const LOG_ABI = [
    "event OrderFilled(bytes32 indexed orderHash, address indexed maker, address indexed taker, uint256 makerAssetId, uint256 takerAssetId, uint256 makerAmount, uint256 takerAmount)",
    "event OrdersMatched(bytes32 indexed orderHash, address indexed maker, address indexed taker, uint256 makerAssetId, uint256 takerAssetId, uint256 makerAmount, uint256 takerAmount)"
    // Added OrdersMatched just in case, but usually it's OrderFilled
];

async function main() {
    console.log(`🚀 Starting ${BOT_NAME} (Event Log Mode)...`);
    console.log(`🎯 Watching Targets:\n   - ${TARGET_WALLETS.join("\n   - ")}`);

    if (telegramBot) await sendTelegramAlert(`🚀 <b>${BOT_NAME} Started!</b>\nMode: Event Logs (Relayer-Proof)\nWatching ${TARGET_WALLETS.length} wallets.`);

    const provider = new ethers.WebSocketProvider(WSS_URL);
    const iface = new ethers.Interface(LOG_ABI);

    console.log(`📡 Connecting to: ${WSS_URL}`);
    console.log("✅ WebSocket Provider initialized.");

    provider.on("block", async (blockNumber) => {
        lastBlockProcessed = blockNumber;
        if (blockNumber % 10 === 0) console.log(`📦 Block Mined: ${blockNumber}`);

        try {
            // EFFICIENT STRATEGY: Get Logs for this block for our Exchange Contract
            // We retrieve ALL logs for the exchange in this block and filter in memory.
            // Why? Because creating 10 different filters for 10 users is heavy.
            // Fetching 5-10 logs per block is cheap.

            const logs = await provider.getLogs({
                fromBlock: blockNumber,
                toBlock: blockNumber,
                address: CTF_EXCHANGE_ADDRESS
            });

            if (logs.length > 0) {
                // console.log(`   (Scanning ${logs.length} logs from Exchange...)`);
            }

            for (const log of logs) {
                let parsedLog;
                try {
                    parsedLog = iface.parseLog(log);
                } catch (e) {
                    continue; // Log event not in our ABI (unknown event)
                }

                if (!parsedLog) continue;

                // Check if Maker OR Taker matches any of our targets
                const maker = parsedLog.args.maker.toLowerCase();
                const taker = parsedLog.args.taker.toLowerCase();

                const matchedTarget = TARGET_WALLETS.find(t => t === maker || t === taker);

                if (matchedTarget) {
                    console.log(`\n🚨 FOUND TRADE via EVENT! Block ${blockNumber}`);
                    console.log(`   Event: ${parsedLog.name}`);
                    console.log(`   Maker: ${maker} ${maker === matchedTarget ? "(TARGET)" : ""}`);
                    console.log(`   Taker: ${taker} ${taker === matchedTarget ? "(TARGET)" : ""}`);

                    const isBuy = maker === matchedTarget ? "Maker (Limit/Ask?)" : "Taker (Market/Buy?)";
                    // Note: In Polymarket:
                    // Maker = placed limit order
                    // Taker = took the order (active trader)

                    const msg = `🚨 <b>TRADE DETECTED (Event)</b> 🚨\n` +
                        `Source: <b>${BOT_NAME}</b>\n\n` +
                        `Action: <b>Order Filled</b>\n` +
                        `Role: ${maker === matchedTarget ? "Maker (Passive)" : "Taker (Active)"}\n` +
                        `Wallet: <code>${matchedTarget.slice(0, 6)}...${matchedTarget.slice(-4)}</code>\n` +
                        `Block: ${blockNumber}\n` +
                        `Tx: <a href="https://polygonscan.com/tx/${log.transactionHash}">View on PolygonScan</a>`;

                    await sendTelegramAlert(msg);
                }
            }

        } catch (err) {
            console.error("❌ Error fetching logs:", err.message);
        }
    });

    provider.on("error", (tx) => console.log("❌ Error:", tx));
}

main().catch(console.error);

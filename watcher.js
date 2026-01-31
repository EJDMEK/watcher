require('dotenv').config();
const { ethers } = require("ethers");
const TelegramBot = require('node-telegram-bot-api');

// --- CONFIGURATION ---
const WSS_URL = process.env.ALCHEMY_WSS_URL;
const CTF_EXCHANGE_ADDRESS = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const TARGET_WALLET = process.env.TARGET_WALLET;

// Telegram Setup
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
let telegramBot = null;

if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
    telegramBot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });
    console.log("📱 Telegram Bot Configured.");
}

async function sendTelegramAlert(message) {
    if (!telegramBot) return;
    try {
        await telegramBot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: "HTML" });
    } catch (err) {
        console.error("⚠️ Failed to send Telegram:", err.message);
    }
}

// Gnosis Safe Proxy often used by traders
const GNOSIS_SAFE_ABI = [
    "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)"
];
// Minimal ABI for CTF Exchange to decode orders
const CTF_EXCHANGE_ABI = [
    "function fillOrder(bytes order, uint256 fillAmount, uint256 price, uint256 feeAmount)",
    "function batchBuy(uint256[] tokenIds, uint256[] amounts, uint256[] maxPrices)"
];

async function main() {
    console.log("🚀 Starting Polymarket Watcher (Block Mode)...");

    // Notify startup
    if (telegramBot) await sendTelegramAlert(`🚀 <b>Watcher Started!</b>\nTarget: <code>${TARGET_WALLET}</code>`);

    const provider = new ethers.WebSocketProvider(WSS_URL);

    console.log(`📡 Connecting to: ${WSS_URL}`);
    console.log("✅ WebSocket Provider initialized.");
    provider.on("error", (tx) => console.log("❌ Error:", tx));

    const safeInterface = new ethers.Interface(GNOSIS_SAFE_ABI);
    const exchangeInterface = new ethers.Interface(CTF_EXCHANGE_ABI);

    console.log(`👀 Watching for new blocks...`);

    provider.on("block", async (blockNumber) => {
        try {
            // Keep-alive log every 10 blocks or so to keep console clean but alive
            if (blockNumber % 10 === 0) console.log(`📦 Block Mined: ${blockNumber}`);

            // Get block with transactions
            const block = await provider.getBlock(blockNumber, true);

            if (!block || !block.prefetchedTransactions) return;
            const txs = block.prefetchedTransactions;

            for (const tx of txs) {
                // --- FILTERING LOGIC ---
                const targetLower = TARGET_WALLET ? TARGET_WALLET.toLowerCase() : null;

                // 1. Is it our specific target?
                const isTarget = targetLower && (
                    (tx.from && tx.from.toLowerCase() === targetLower) ||
                    (tx.to && tx.to.toLowerCase() === targetLower)
                );

                // 2. Is it interaction with the Exchange?
                const isExchangeInteraction = tx.to && tx.to.toLowerCase() === CTF_EXCHANGE_ADDRESS.toLowerCase();

                // STRICT FILTER: Only proceed if it involves our TARGET
                if (!isTarget) continue;

                const alertTitle = `\n🎯 TARGET DETECTED in Block ${blockNumber}: ${tx.hash}`;
                console.log(alertTitle);

                let messageDetails = "";
                let actionType = "Unknown Interaction";

                // --- DECODING LOGIC ---

                // Decode Exchange calls (Direct)
                if (isExchangeInteraction) {
                    try {
                        const decoded = exchangeInterface.parseTransaction({ data: tx.data });

                        if (decoded) {
                            console.log(`   Function: ${decoded.name}`);
                            messageDetails += `Function: <b>${decoded.name}</b>\n`;

                            if (decoded.name === 'fillOrder') {
                                actionType = "💰 Buy/Sell Order";
                                messageDetails += `Log: Direct CLOB interaction.\n`;
                            }
                        }
                    } catch (e) { }
                }

                // Decode Gnosis Safe (Proxy)
                // This is where most "Smart Money" hides
                if (isTarget) {
                    try {
                        const decodedSafe = safeInterface.parseTransaction({ data: tx.data });
                        if (decodedSafe && decodedSafe.name === "execTransaction") {
                            const internalData = decodedSafe.args[2];
                            try {
                                const decodedInternal = exchangeInterface.parseTransaction({ data: internalData });
                                console.log(`      🕵️‍♀️ Proxy Execution: ${decodedInternal.name}`);
                                actionType = "🕵️‍♀️ Gnosis Proxy Trade";
                                messageDetails += `Function: <b>${decodedInternal.name}</b>\n`;
                            } catch (e) { }
                        }
                    } catch (e) { }
                }

                // Send Alert
                const msg = `🚨 <b>ACTIVITY DETECTED</b> 🚨\n\n` +
                    `Action: ${actionType}\n` +
                    `Target: <code>${TARGET_WALLET.slice(0, 6)}...${TARGET_WALLET.slice(-4)}</code>\n` +
                    `Block: ${blockNumber}\n\n` +
                    `${messageDetails}\n` +
                    `🔗 <a href="https://polygonscan.com/tx/${tx.hash}">Check on PolygonScan</a>`;

                await sendTelegramAlert(msg);
            }
        } catch (err) {
            console.error("Error processing block:", err.message);
        }
    });
}

main().catch(console.error);

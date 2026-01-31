require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

console.log("🤖 Waiting for a message... Please send 'Hello' or 'Start' to your bot on Telegram now!");

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    console.log(`\n✅ SUCCESS! Your Chat ID is: ${chatId}`);
    console.log(`Update your .env file with: TELEGRAM_CHAT_ID=${chatId}`);
    process.exit(0);
});

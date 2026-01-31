#!/bin/bash
echo "🚀 Deploying to Ubuntu (ThinkPad)..."
echo "⚠️  You will be asked for your password (adam@10.1.0.141) multiple times."

# 1. Copy files
echo "📦 Copying files to ThinkPad..."
scp -r "/Users/admin/Documents/bot demo/polymarket-bot" adam@10.1.0.141:~/
if [ $? -ne 0 ]; then
    echo "❌ Copy failed. Check password or IP."
    exit 1
fi

# 2. Setup Remote
echo "🔧 Setting up server environment..."
# We use -t to force a TTY so sudo can ask for password if needed
ssh -t adam@10.1.0.141 '
# Stop on error
set -e

echo "--> Installing Node.js (if not exists)..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 
    sudo apt-get install -y nodejs
else
    echo "Node.js is already installed."
fi

echo "--> Installing dependencies..."
cd ~/polymarket-bot
npm install

echo "--> Installing Process Manager (PM2)..."
sudo npm install -g pm2

echo "--> Starting Watcher..."
# Stop existing if any
pm2 delete poly-watcher 2>/dev/null || true
# Start new
pm2 start watcher.js --name "poly-watcher"
pm2 save

echo "✅ DEPLOYMENT SUCCESSFUL!"
echo "Bot is running. You can check logs with: ssh adam@10.1.0.141 'pm2 logs'"
'

/**
 * Telegram Bot - Hedged Arbitrage Alerts
 * 
 * Send alerts via Telegram when profitable spreads are found
 * and manage trading commands
 * 
 * @module telegram-bot
 */

import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import autoTrader from './auto-trader.js';
import { getLifetimeStats } from './scanner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

// ============================================================================
// CONFIGURATION
// ============================================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const CONFIG = {
  minProfitableSpread: 0.3,        // Minimum 0.3% spread for alert
  alertCooldown: 300000,           // 5 minutes between same coin alerts
  maxAlertsPerHour: parseInt(process.env.MAX_ALERTS_PER_HOUR || '100'),  // Maximum alerts per hour (0 = unlimited)
  backupInterval: 3600000,         // Backup every 1 hour
  historyFile: path.join(__dirname, '../data/history.json')
};

// ============================================================================
// STATE
// ============================================================================

let bot = null;
let lastAlerts = new Map();
let alertCountThisHour = 0;
let history = [];
let pendingTrade = null;

// Reset alert counter every hour
setInterval(() => {
  alertCountThisHour = 0;
  console.log('📊 Alert counter reset');
}, 3600000);

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize Telegram bot
 * @returns {TelegramBot|null}
 */
export function initTelegramBot() {
  if (!BOT_TOKEN) {
    console.warn('⚠️  TELEGRAM_BOT_TOKEN not found in .env - Alerts disabled');
    return null;
  }

  if (!CHAT_ID) {
    console.warn('⚠️  TELEGRAM_CHAT_ID not found in .env - Alerts disabled');
    return null;
  }

  try {
    bot = new TelegramBot(BOT_TOKEN, { polling: true });
    
    loadHistory();
    setInterval(saveHistory, CONFIG.backupInterval);
    setupBotCommands();
    setupBotMenu();
    
    sendMessage(
      '🚀 Arbitrage Scanner started!\n\n' +
      `📊 Alert threshold: ${CONFIG.minProfitableSpread}%+\n` +
      `⏰ Backup: every ${CONFIG.backupInterval / 60000} minutes`
    );
    
    console.log('✅ Telegram bot initialized');
    return bot;
    
  } catch (error) {
    console.error('❌ Telegram bot initialization failed:', error.message);
    return null;
  }
}

// ============================================================================
// BOT COMMANDS
// ============================================================================

/**
 * Setup bot menu
 */
function setupBotMenu() {
  bot.setMyCommands([
    // Monitoring
    { command: 'status', description: '📊 Current status' },
    { command: 'lifetime', description: '⏱ Spread lifetime stats' },
    { command: 'history', description: '📅 Today\'s history' },
    { command: 'report', description: '📈 Full report (7 days)' },
    { command: 'best', description: '⭐ Best opportunities' },
    { command: 'settings', description: '⚙️ Settings' },
    
    // Trading
    { command: 'trader', description: '🤖 Trader status' },
    { command: 'positions', description: '📂 Open positions' },
    { command: 'emergency', description: '⛔ Stop (emergency)' },
    { command: 'resume', description: '✅ Resume trading' }
  ])
    console.log('✅ Bot menu configured');
  }).catch(err => {
    console.error('❌ Failed to set bot menu:', err.message);
  });
}

function setupBotCommands() {
  // /start
  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 
      '👋 Hello! I\'m a Crypto Arbitrage Alert bot.\n\n' +
      '📋 MONITORING:\n' +
      '/status - Current status\n' +
      '/history - Today\'s history\n' +
      '/report - Full report\n' +
      '/best - Best opportunities\n' +
      '/settings - Settings\n\n' +
      '🤖 TRADING:\n' +
      '/trader - Trader status\n' +
      '/positions - Open positions\n' +
      '/emergency - Stop (emergency)\n' +
      '/resume - Resume trading\n\n' +
      '🔔 I\'ll automatically alert you when profitable spreads are found!'
    );
  });

  // /status
  bot.onText(/\/status/, (msg) => {
    const stats = getStats();
    bot.sendMessage(msg.chat.id, 
      '📊 CURRENT STATUS\n\n' +
      '✅ Scanner running\n' +
      `📈 Today\'s opportunities: ${stats.todayCount}\n` +
      `💰 Best spread: ${stats.bestSpread}%\n` +
      `🔔 Alerts sent: ${stats.alertsSent}\n` +
      `⏰ Last update: ${stats.lastUpdate}`
    );
  });

  // /history
  bot.onText(/\/history/, (msg) => {
    sendTodayHistory(msg.chat.id);
  });

  // /report
  bot.onText(/\/report/, (msg) => {
    sendFullReport(msg.chat.id);
  });

  // /best
  bot.onText(/\/best/, (msg) => {
    sendBestOpportunities(msg.chat.id);
  });

  // /settings
  bot.onText(/\/settings/, (msg) => {
    bot.sendMessage(msg.chat.id,
      '⚙️ SETTINGS\n\n' +
      `🎯 Min spread: ${CONFIG.minProfitableSpread}%\n` +
      `⏱ Alert cooldown: ${CONFIG.alertCooldown / 1000}s\n` +
      `📊 Max alerts/hour: ${CONFIG.maxAlertsPerHour}\n` +
      `💾 Backup interval: ${CONFIG.backupInterval / 60000} min`
    );
  });
  
  // /lifetime - Spread lifetime statistics
  bot.onText(/\/lifetime/, (msg) => {
    const stats = getLifetimeStats();
    
    if (stats.count === 0) {
      bot.sendMessage(msg.chat.id,
        '⏱ SPREAD LIFETIME\n\n' +
        'No data yet. Please wait...'
      );
      return;
    }
    
    let recentText = '';
    if (stats.recent.length > 0) {
      recentText = '\n\n🕐 RECENT SPREADS:\n';
      stats.recent.forEach((s, i) => {
        const [coin, spot, futures] = s.key.split('_');
        recentText += `${i+1}. ${coin}: ${s.spread}% - ⏱${s.lifetime}s\n`;
      });
    }
    
    bot.sendMessage(msg.chat.id,
      '⏱ SPREAD LIFETIME STATISTICS\n\n' +
      `📊 Total: ${stats.count} spreads\n` +
      `🕒 Average: ${stats.avgLifetime}s\n` +
      `⚡ Fastest: ${stats.minLifetime}s\n` +
      `🐢 Slowest: ${stats.maxLifetime}s\n` +
      recentText +
      '\n💡 This shows how long spreads stay "alive"'
    );
  });

  // /trader
  bot.onText(/\/trader/, (msg) => {
    const stats = autoTrader.getTradingStats();
    const statusEmoji = stats.config.dryRun ? '🧪' : '⚡';
    const modeText = stats.config.dryRun ? 'TEST MODE' : 'LIVE TRADING';
    const autoText = stats.config.autoExecute ? 'AUTOMATIC' : 'MANUAL CONFIRMATION';
    
    bot.sendMessage(msg.chat.id,
      `${statusEmoji} TRADER STATUS\n\n` +
      `📊 Mode: ${modeText}\n` +
      `🎯 Execution: ${autoText}\n` +
      `📈 Min spread: ${stats.config.minSpread}%\n` +
      `💰 Position size: $${stats.config.positionSize}\n\n` +
      '📊 STATISTICS:\n' +
      `✅ Successful: ${stats.successfulTrades}\n` +
      `❌ Failed: ${stats.failedTrades}\n` +
      `📂 Open positions: ${stats.activePositions}\n` +
      `💵 Today\'s volume: $${stats.todayVolume.toFixed(2)}\n` +
      `🎲 Error count: ${stats.failedOrderCount}\n\n` +
      '⚠️ Note: DRY_RUN_MODE=true means no real money is used!'
    );
  });

  // /positions
  bot.onText(/\/positions/, (msg) => {
    const stats = autoTrader.getTradingStats();
    
    if (stats.activePositions === 0) {
      bot.sendMessage(msg.chat.id, '📭 No open positions currently');
      return;
    }
    
    bot.sendMessage(msg.chat.id, 
      '📂 OPEN POSITIONS\n\n' +
      `Total: ${stats.activePositions}\n\n` +
      '💡 See positions.json file for detailed information'
    );
  });

  // /emergency
  bot.onText(/\/emergency/, (msg) => {
    bot.sendMessage(msg.chat.id,
      '⚠️ EMERGENCY STOP\n\n' +
      'This will stop all trading operations.\n\n' +
      'Do you want to continue?',
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '⛔ YES, STOP', callback_data: 'emergency_confirm' },
            { text: '❌ Cancel', callback_data: 'emergency_cancel' }
          ]]
        }
      }
    );
  });

  // /resume
  bot.onText(/\/resume/, (msg) => {
    autoTrader.disableEmergencyStop();
    autoTrader.resetFailedOrderCount();
    
    bot.sendMessage(msg.chat.id, 
      '✅ TRADING RESUMED\n\n' +
      'Emergency stop disabled\n' +
      'Error counter reset'
    );
  });

  // Callback query handler
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    
    if (query.data === 'emergency_confirm') {
      autoTrader.enableEmergencyStop();
      bot.editMessageText(
        '⛔ EMERGENCY STOP ACTIVATED\n\n' +
        'All trading operations stopped.\n' +
        'To resume: /resume',
        { chat_id: chatId, message_id: messageId }
      );
    } 
    else if (query.data === 'emergency_cancel') {
      bot.editMessageText(
        '❌ Cancelled',
        { chat_id: chatId, message_id: messageId }
      );
    }
    else if (query.data === 'trade_confirm' && pendingTrade) {
      bot.editMessageText(
        '⏳ Executing trade...\n\n' +
        `${pendingTrade.coin} - ${pendingTrade.netSpread}%`,
        { chat_id: chatId, message_id: messageId }
      );
      
      const result = await autoTrader.executeHedgedTrade(pendingTrade);
      
      if (result.success) {
        bot.sendMessage(chatId,
          '✅ TRADE SUCCESSFUL\n\n' +
          `Trade ID: ${result.tradeId}\n` +
          `Mode: ${result.mode}\n` +
          `Expected profit: $${result.profit || 'N/A'}`
        );
      } else {
        bot.sendMessage(chatId,
          '❌ TRADE FAILED\n\n' +
          `Error: ${result.error}\n` +
          `Trade ID: ${result.tradeId}`
        );
      }
      
      pendingTrade = null;
    }
    else if (query.data === 'trade_cancel') {
      bot.editMessageText(
        '❌ Trade cancelled',
        { chat_id: chatId, message_id: messageId }
      );
      pendingTrade = null;
    }
    
    bot.answerCallbackQuery(query.id);
  });
}

// ============================================================================
// ALERT FUNCTIONS
// ============================================================================

/**
 * Send alert when profitable spread is found
 * @param {Object} opportunity - Arbitrage opportunity
 */
export async function sendProfitableAlert(opportunity) {
  if (!bot || !CHAT_ID) {
    return;
  }

  const spread = parseFloat(opportunity.netSpread);
  
  // Check if profitable enough
  if (spread < CONFIG.minProfitableSpread) {
    return;
  }

  // Check cooldown
  const lastAlertTime = lastAlerts.get(opportunity.coin);
  const now = Date.now();
  if (lastAlertTime && (now - lastAlertTime) < CONFIG.alertCooldown) {
    console.log(`⏳ ${opportunity.coin} alert cooldown active`);
    return;
  }

  // Check hourly limit
  if (alertCountThisHour >= CONFIG.maxAlertsPerHour) {
    console.log('⚠️  Alert limit reached for this hour');
    return;
  }

  // Calculate profit
  const investAmount = 10000;
  const profit = (investAmount * spread / 100).toFixed(2);
  
  // AUTO_EXECUTE mode check
  const traderStats = autoTrader.getTradingStats();
  const isAutoExecute = traderStats.config.autoExecute;
  
  if (isAutoExecute) {
    // AUTOMATIC TRADE (no button)
    const lifetime = opportunity.lifetime || '0.0';
    const alertMessage = 
      '🚨 PROFITABLE SPREAD FOUND!\n\n' +
      `💎 Coin: ${opportunity.coin}\n` +
      `📈 Net Spread: ${spread}%\n` +
      `💰 Profit ($10k): $${profit}\n` +
      `⏱ Active: ${lifetime}s\n\n` +
      `🟢 SPOT: ${opportunity.spotExchange} @ $${opportunity.spotPrice}\n` +
      `🔴 FUTURES: ${opportunity.futuresExchange} @ $${opportunity.futuresPrice}\n\n` +
      `⏰ ${new Date().toLocaleTimeString('en-US')}\n` +
      '⚡ AUTO EXECUTING...';
    
    // ⚡ NON-BLOCKING: Telegram and Trade PARALLEL
    console.log(`🚀 AUTO_EXECUTE: ${opportunity.coin} ${spread}%`);
    const executeStart = Date.now();
    
    // Send Telegram and Trade in parallel (no await!)
    const telegramPromise = bot.sendMessage(CHAT_ID, alertMessage).catch(err => {
      console.error('❌ Failed to send alert:', err.message);
    });
    
    // Trade starts IMMEDIATELY (Telegram not awaited)
    const result = await autoTrader.executeHedgedTrade(opportunity);
    const executionTime = Date.now() - executeStart;
    
    // Send result (also non-blocking)
    if (result.success) {
      bot.sendMessage(CHAT_ID,
        '✅ TRADE EXECUTED SUCCESSFULLY\n\n' +
        `Trade ID: ${result.tradeId}\n` +
        `Coin: ${opportunity.coin}\n` +
        `Spread: ${spread}%\n` +
        `Mode: ${result.mode}\n` +
        `Expected profit: $${result.profit || 'N/A'}\n\n` +
        `⚡ Pure execution: ${executionTime}ms`
      ).catch(err => console.error('❌ Failed to send result:', err.message));
    } else {
      bot.sendMessage(CHAT_ID,
        '❌ TRADE FAILED\n\n' +
        `Coin: ${opportunity.coin}\n` +
        `Error: ${result.error}\n` +
        `Trade ID: ${result.tradeId}`
      ).catch(err => console.error('❌ Failed to send error:', err.message));
    }
  } else {
    // MANUAL CONFIRMATION (with button)
    const lifetime = opportunity.lifetime || '0.0';
    const message = 
      '🚨 PROFITABLE SPREAD FOUND!\n\n' +
      `💎 Coin: ${opportunity.coin}\n` +
      `📈 Net Spread: ${spread}%\n` +
      `💰 Profit ($10k): $${profit}\n` +
      `⏱ Active: ${lifetime}s\n\n` +
      `🟢 SPOT: ${opportunity.spotExchange} @ $${opportunity.spotPrice}\n` +
      `🔴 FUTURES: ${opportunity.futuresExchange} @ $${opportunity.futuresPrice}\n\n` +
      `⏰ ${new Date().toLocaleTimeString('en-US')}\n` +
      '⚡ ACT QUICKLY!';

    pendingTrade = opportunity;
    
    bot.sendMessage(CHAT_ID, message, {
      reply_markup: {
        inline_keyboard: [[
          { text: '🚀 OPEN TRADE', callback_data: 'trade_confirm' },
          { text: '❌ Cancel', callback_data: 'trade_cancel' }
        ]]
      }
    }).catch(err => {
      console.error('❌ Failed to send alert:', err.message);
    });
  }
  
  lastAlerts.set(opportunity.coin, now);
  alertCountThisHour++;
  addToHistory(opportunity);
  
  console.log(`✅ Alert sent: ${opportunity.coin} ${spread}%`);
}

/**
 * Oddiy xabar yuborish
 * @param {string} text - Yuborilishi kerak bo'lgan xabar
 */
function sendMessage(text) {
  if (!bot || !CHAT_ID) {
    return;
  }
  
  bot.sendMessage(CHAT_ID, text).catch(err => {
    console.error('❌ Failed to send message:', err.message);
  });
}

// ============================================================================
// HISTORY MANAGEMENT
// ============================================================================

function addToHistory(opportunity) {
  history.push({
    ...opportunity,
    timestamp: new Date().toISOString(),
    profit: ((10000 * parseFloat(opportunity.netSpread)) / 100).toFixed(2)
  });
  
  if (history.length > 1000) {
    history = history.slice(-1000);
  }
  
  saveHistory();
}

function loadHistory() {
  try {
    const dataDir = path.dirname(CONFIG.historyFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    if (fs.existsSync(CONFIG.historyFile)) {
      const data = fs.readFileSync(CONFIG.historyFile, 'utf8');
      history = JSON.parse(data);
      console.log(`✅ Loaded ${history.length} history records`);
    }
  } catch (error) {
    console.error('❌ Failed to load history:', error.message);
    history = [];
  }
}

function saveHistory() {
  try {
    const dataDir = path.dirname(CONFIG.historyFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.writeFileSync(CONFIG.historyFile, JSON.stringify(history, null, 2));
    console.log(`💾 History saved: ${history.length} records`);
  } catch (error) {
    console.error('❌ Failed to save history:', error.message);
  }
}

// ============================================================================
// REPORTS
// ============================================================================

function getStats() {
  const today = new Date().toISOString().split('T')[0];
  const todayRecords = history.filter(h => h.timestamp.startsWith(today));
  
  return {
    todayCount: todayRecords.length,
    bestSpread: todayRecords.length > 0 
      ? Math.max(...todayRecords.map(r => parseFloat(r.netSpread))).toFixed(3)
      : '0.000',
    alertsSent: alertCountThisHour,
    lastUpdate: history.length > 0 
      ? new Date(history[history.length - 1].timestamp).toLocaleTimeString('uz-UZ')
      : 'Hech qachon'
  };
}

function sendTodayHistory(chatId) {
  const today = new Date().toISOString().split('T')[0];
  const todayRecords = history.filter(h => h.timestamp.startsWith(today));
  
  if (todayRecords.length === 0) {
    bot.sendMessage(chatId, '📭 Bugun hali imkoniyat topilmagan');
    return;
  }
  
  todayRecords.sort((a, b) => parseFloat(b.netSpread) - parseFloat(a.netSpread));
  
  let message = `📅 BUGUNGI TARIX (${todayRecords.length} ta)\n\n`;
  
  todayRecords.slice(0, 10).forEach((rec, i) => {
    const time = new Date(rec.timestamp).toLocaleTimeString('uz-UZ', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    message += `${i + 1}. ${rec.coin} - ${rec.netSpread}% ($${rec.profit})\n`;
    message += `   ${time} | ${rec.spotExchange} → ${rec.futuresExchange}\n\n`;
  });
  
  if (todayRecords.length > 10) {
    message += `\n... va yana ${todayRecords.length - 10} ta`;
  }
  
  bot.sendMessage(chatId, message);
}

function sendFullReport(chatId) {
  const stats = getStats();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const weekRecords = history.filter(h => h.timestamp > weekAgo);
  
  const totalProfit = weekRecords.reduce((sum, r) => sum + parseFloat(r.profit), 0);
  const avgSpread = weekRecords.length > 0
    ? (weekRecords.reduce((sum, r) => sum + parseFloat(r.netSpread), 0) / weekRecords.length).toFixed(3)
    : '0.000';
  
  const message =
    '📊 TO\'LIQ HISOBOT\n\n' +
    `📅 Bugun: ${stats.todayCount} ta imkoniyat\n` +
    `📆 7 kun: ${weekRecords.length} ta imkoniyat\n` +
    `💰 Jami foyda ($10k): $${totalProfit.toFixed(2)}\n` +
    `📈 O'rtacha spread: ${avgSpread}%\n` +
    `⭐ Eng yaxshi spread: ${stats.bestSpread}%\n\n` +
    `💾 Jami arxiv: ${history.length} ta record`;
  
  bot.sendMessage(chatId, message);
  
  if (fs.existsSync(CONFIG.historyFile)) {
    bot.sendDocument(chatId, CONFIG.historyFile, {
      caption: '📎 To\'liq tarix fayli'
    });
  }
}

function sendBestOpportunities(chatId) {
  if (history.length === 0) {
    bot.sendMessage(chatId, '📭 Hali tarix yo\'q');
    return;
  }
  
  const sorted = [...history].sort((a, b) => parseFloat(b.netSpread) - parseFloat(a.netSpread));
  
  let message = '⭐ ENG YAXSHI IMKONIYATLAR\n\n';
  
  sorted.slice(0, 5).forEach((rec, i) => {
    const date = new Date(rec.timestamp).toLocaleString('uz-UZ', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    message += `${i + 1}. ${rec.coin} - ${rec.netSpread}%\n`;
    message += `   💰 $${rec.profit} | ${date}\n`;
    message += `   ${rec.spotExchange} → ${rec.futuresExchange}\n\n`;
  });
  
  bot.sendMessage(chatId, message);
}

// ============================================================================
// EXPORT
// ============================================================================

export default {
  initTelegramBot,
  sendProfitableAlert,
  sendMessage
};

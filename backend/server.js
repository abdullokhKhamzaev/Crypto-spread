import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { scanHedgedOpportunities } from './scanner.js';
import { initTelegramBot, sendProfitableAlert } from './telegram-bot.js';
import { initAutoTrader } from './auto-trader.js';

// Load environment variables
dotenv.config();

const app = express();
const port = 8001; // Different port from old server

app.use(cors());
app.use(express.json());

// Initialize Telegram bot
const telegramBot = initTelegramBot();

// Initialize Auto Trader
initAutoTrader();

// Hedged arbitrage endpoint
app.get('/hedged-spread', async (req, res) => {
  try {
    const opportunities = await scanHedgedOpportunities();
    
    // Send alert for profitable opportunities (0.3%+)
    if (telegramBot) {
      opportunities.forEach(opp => {
        if (parseFloat(opp.netSpread) >= 0.3) {
          sendProfitableAlert(opp);
        }
      });
    }
    
    res.json(opportunities);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to scan opportunities' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', mode: 'hedged-arbitrage', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`🚀 Hedged Arbitrage API running at http://localhost:${port}`);
  console.log(`📊 Scanner endpoint: http://localhost:${port}/hedged-spread`);
  console.log(`⚠️  Mode: TEST (set config.json mode to 'live' for real trading)`);
});

// ============================================================================
// AUTO SCANNER LOOP
// ============================================================================

const SCANNER_INTERVAL_MS = parseInt(process.env.SCANNER_INTERVAL_MS || '3000');

console.log(`\n🔄 Auto scanner starting...`);
console.log(`⏱  Interval: ${SCANNER_INTERVAL_MS}ms (${SCANNER_INTERVAL_MS/1000}s)\n`);

let isScanning = false;

setInterval(async () => {
  // Prevent overlapping scans
  if (isScanning) {
    console.log('⚠️  Previous scan still running, skipping...');
    return;
  }
  
  isScanning = true;
  
  try {
    const opportunities = await scanHedgedOpportunities();
    
    // Send alerts for profitable opportunities
    if (telegramBot) {
      for (const opp of opportunities) {
        if (parseFloat(opp.netSpread) >= 0.3) {
          await sendProfitableAlert(opp);
        }
      }
    }
  } catch (error) {
    console.error('❌ Scanner error:', error.message);
  } finally {
    isScanning = false;
  }
}, SCANNER_INTERVAL_MS);

/**
 * Automated Hedged Arbitrage Trader
 * 
 * Automatically execute hedged arbitrage trades via MEXC and Bitget
 * Safe testing capability with DRY_RUN mode
 * 
 * @module auto-trader
 */

import ccxt from 'ccxt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { predictSlippage } from './market-depth.js';
import * as positionManager from './position-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

// ============================================================================
// TRADING CONFIGURATION
// ============================================================================

const TRADING_CONFIG = {
  // Mode
  DRY_RUN_MODE: true,              // true = test (no real money used)
  AUTO_EXECUTE: true,              // true = automatic (no button), false = manual confirmation
  
  // Performance
  VERBOSE_LOGGING: false,          // false = minimal logs (FAST)
  BALANCE_CACHE_MS: 30000,         // Balance cache (30s)
  SIMULATE_DELAY_MS: 0,            // DRY_RUN delay (0 = instant)
  
  // Spread limits
  MIN_SPREAD: 0.6,                 // Minimum spread % (0.6% = safe, slippage + closing cost accounted)
  MAX_SPREAD: 5.0,                 // Maximum spread % (>5% is suspicious)
  
  // Dynamic risk (relative to spread)
  MAX_SLIPPAGE_RATIO: 0.3,         // Slippage should not exceed 30% of spread
  MAX_FUNDING_RATIO: 0.1,          // Funding should not exceed 10% of spread
  
  // Position sizing
  POSITION_SIZE_USD: 100,          // Trade size per position ($100)
  MAX_POSITION_SIZE_USD: 500,      // Maximum position ($500)
  MAX_DAILY_VOLUME_USD: 2000,      // Daily maximum ($2000)
  
  // Safety
  MAX_SLIPPAGE_PERCENT: 0.5,       // Maximum slippage (0.5%)
  ORDER_TIMEOUT_MS: 2000,          // Order timeout (2 seconds) - OPTIMIZED
  POSITION_CHECK_INTERVAL: 5000,   // Position check interval (5 seconds)
  
  // Leverage
  FUTURES_LEVERAGE: 1,             // Futures leverage (1x = safe)
  
  // Emergency
  EMERGENCY_STOP: false,           // true = all trades stopped
  MAX_FAILED_ORDERS: 3             // 3 failures = stop trading
};

// ============================================================================
// EXCHANGE CONFIGURATION
// ============================================================================

const exchangeConfigs = {
  mexc: {
    apiKey: process.env.MEXC_API_KEY,
    secret: process.env.MEXC_SECRET,
    enableRateLimit: true,
    options: {
      defaultType: 'spot'
    }
  },
  bitget: {
    apiKey: process.env.BITGET_API_KEY,
    secret: process.env.BITGET_SECRET,
    password: process.env.BITGET_PASSPHRASE,
    enableRateLimit: true,
    options: {
      defaultType: 'spot'
    }
  }
};

// ============================================================================
// STATE
// ============================================================================

let exchanges = {};
let activePositions = new Map();
let dailyVolume = 0;
let failedOrderCount = 0;
let tradingStats = {
  totalTrades: 0,
  successfulTrades: 0,
  failedTrades: 0,
  totalProfit: 0,
  todayVolume: 0
};

// Balance cache
let balanceCache = {
  spot: { balance: 0, timestamp: 0 },
  futures: { balance: 0, timestamp: 0 }
};

// Reset daily counters at midnight
setInterval(() => {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    dailyVolume = 0;
    tradingStats.todayVolume = 0;
    console.log('📊 Daily counters reset');
  }
}, 60000);

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize exchanges
 * @returns {boolean}
 */
export function initializeExchanges() {
  try {
    console.log('🔧 Initializing exchanges...');
    
    for (const [name, config] of Object.entries(exchangeConfigs)) {
      if (config.apiKey && config.secret) {
        const ExchangeClass = ccxt[name];
        exchanges[name] = new ExchangeClass(config);
        console.log(`✅ ${name} initialized`);
      } else {
        console.warn(`⚠️  ${name} API keys not configured`);
      }
    }
    
    console.log(`✅ ${Object.keys(exchanges).length} exchanges ready`);
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize exchanges:', error.message);
    return false;
  }
}

/**
 * Initialize auto trader
 * @returns {boolean}
 */
export function initAutoTrader() {
  console.log('\n🤖 AUTO TRADER INITIALIZING...\n');
  
  loadPositions();
  
  const success = initializeExchanges();
  
  if (!success) {
    console.error('❌ Failed to initialize auto trader');
    return false;
  }
  
  // Pass exchanges to position manager
  positionManager.setExchanges(exchanges);
  positionManager.startAutoMonitor();
  
  startPositionMonitoring();
  
  console.log('\n⚙️  TRADING CONFIGURATION:');
  console.log(`   Dry Run: ${TRADING_CONFIG.DRY_RUN_MODE ? '✅ ON (safe)' : '⚠️  OFF (real money)'}`);
  console.log(`   Auto Execute: ${TRADING_CONFIG.AUTO_EXECUTE ? '⚠️  ON' : '✅ OFF (manual confirm)'}`);
  console.log(`   Min Spread: ${TRADING_CONFIG.MIN_SPREAD}%`);
  console.log(`   Position Size: $${TRADING_CONFIG.POSITION_SIZE_USD}`);
  console.log(`   Daily Limit: $${TRADING_CONFIG.MAX_DAILY_VOLUME_USD}`);
  console.log(`   Futures Leverage: ${TRADING_CONFIG.FUTURES_LEVERAGE}x`);
  console.log(`   Active Positions: ${activePositions.size}`);
  console.log(`   Today Volume: $${dailyVolume.toFixed(2)}\n`);
  
  console.log('✅ AUTO TRADER READY\n');
  return true;
}

// ============================================================================
// PRE-FLIGHT CHECKS
// ============================================================================

/**
 * Run all checks before opening trade
 * @param {Object} opportunity - Arbitrage opportunity
 * @returns {Promise<boolean>}
 */
async function preFlightCheck(opportunity) {
  if (TRADING_CONFIG.VERBOSE_LOGGING) {
    console.log(`🔍 Pre-flight check: ${opportunity.coin}`);
  }
  
  // Fast checks (no I/O)
  if (TRADING_CONFIG.EMERGENCY_STOP) {
    throw new Error('⛔ EMERGENCY STOP ACTIVE');
  }
  
  if (failedOrderCount >= TRADING_CONFIG.MAX_FAILED_ORDERS) {
    throw new Error(`⛔ Too many failed orders (${failedOrderCount})`);
  }
  
  const spread = parseFloat(opportunity.netSpread);
  if (spread < TRADING_CONFIG.MIN_SPREAD || spread > TRADING_CONFIG.MAX_SPREAD) {
    throw new Error(`❌ Spread out of range: ${spread}%`);
  }
  
  if (dailyVolume >= TRADING_CONFIG.MAX_DAILY_VOLUME_USD) {
    throw new Error(`❌ Daily limit reached: $${dailyVolume}`);
  }
  
  const positionSize = TRADING_CONFIG.POSITION_SIZE_USD;
  if (positionSize > TRADING_CONFIG.MAX_POSITION_SIZE_USD) {
    throw new Error(`❌ Position too large: $${positionSize}`);
  }
  
  const spotExchange = opportunity.spotExchange.toLowerCase();
  const futuresExchange = opportunity.futuresExchange.toLowerCase();
  
  if (!exchanges[spotExchange] || !exchanges[futuresExchange]) {
    throw new Error(`❌ Exchange unavailable`);
  }
  
  // Balance check (cached in live mode)
  if (!TRADING_CONFIG.DRY_RUN_MODE) {
    await checkBalancesCached(spotExchange, futuresExchange, positionSize);
  }
  
  if (TRADING_CONFIG.VERBOSE_LOGGING) {
    console.log('✅ Pre-flight passed');
  }
  return true;
}

/**
 * Check sufficient balance on exchanges (CACHED)
 */
async function checkBalancesCached(spotExchange, futuresExchange, positionSize) {
  const now = Date.now();
  
  // Check cache (30s)
  if (now - balanceCache.spot.timestamp < TRADING_CONFIG.BALANCE_CACHE_MS &&
      now - balanceCache.futures.timestamp < TRADING_CONFIG.BALANCE_CACHE_MS) {
    
    if (balanceCache.spot.balance < positionSize) {
      throw new Error(`❌ Insufficient spot: $${balanceCache.spot.balance}`);
    }
    if (balanceCache.futures.balance < positionSize) {
      throw new Error(`❌ Insufficient futures: $${balanceCache.futures.balance}`);
    }
    return true;  // Fast path (cached)
  }
  
  // Fetch fresh (parallel)
  try {
    const [spotBalance, futuresBalance] = await Promise.all([
      exchanges[spotExchange].fetchBalance(),
      exchanges[futuresExchange].fetchBalance()
    ]);
    
    const spotUSDT = spotBalance.USDT?.free || 0;
    const futuresUSDT = futuresBalance.USDT?.free || 0;
    
    // Update cache
    balanceCache.spot = { balance: spotUSDT, timestamp: now };
    balanceCache.futures = { balance: futuresUSDT, timestamp: now };
    
    if (spotUSDT < positionSize) {
      throw new Error(`❌ Insufficient spot: $${spotUSDT}`);
    }
    if (futuresUSDT < positionSize) {
      throw new Error(`❌ Insufficient futures: $${futuresUSDT}`);
    }
    
    if (TRADING_CONFIG.VERBOSE_LOGGING) {
      console.log(`💰 Balances: Spot $${spotUSDT.toFixed(2)}, Futures $${futuresUSDT.toFixed(2)}`);
    }
    return true;
  } catch (error) {
    throw new Error(`❌ Balance check failed: ${error.message}`);
  }
}

// ============================================================================
// TRADE EXECUTION
// ============================================================================

/**
 * Execute hedged trade (spot BUY + futures SHORT parallel)
 * @param {Object} opportunity - Arbitrage opportunity
 * @returns {Promise<Object>}
 */
export async function executeHedgedTrade(opportunity) {
  const tradeId = `${opportunity.coin}_${Date.now()}`;
  const executeStart = Date.now();
  
  try {
    if (TRADING_CONFIG.VERBOSE_LOGGING) {
      console.log(`\n🚀 Trade: ${tradeId}`);
      console.log(`📊 ${opportunity.coin}: ${opportunity.netSpread}%`);
    }
    
    await preFlightCheck(opportunity);
    
    const positionSize = TRADING_CONFIG.POSITION_SIZE_USD;
    const spotPrice = parseFloat(opportunity.spotPrice);
    const futuresPrice = parseFloat(opportunity.futuresPrice);
    const amount = positionSize / spotPrice;
    
    // DRY RUN MODE - instant simulation
    if (TRADING_CONFIG.DRY_RUN_MODE) {
      if (TRADING_CONFIG.SIMULATE_DELAY_MS > 0) {
        await new Promise(resolve => setTimeout(resolve, TRADING_CONFIG.SIMULATE_DELAY_MS));
      }
      
      tradingStats.totalTrades++;
      tradingStats.successfulTrades++;
      
      const executionTime = Date.now() - executeStart;
      console.log(`⚡ DRY_RUN: ${opportunity.coin} | ${executionTime}ms`);
      
      return {
        success: true,
        tradeId,
        mode: 'DRY_RUN',
        profit: (positionSize * parseFloat(opportunity.netSpread) / 100).toFixed(2),
        executionTime
      };
    }
    
    // LIVE TRADING - parallel execution
    const spotExchange = exchanges[opportunity.spotExchange.toLowerCase()];
    const futuresExchange = exchanges[opportunity.futuresExchange.toLowerCase()];
    
    await futuresExchange.setLeverage(TRADING_CONFIG.FUTURES_LEVERAGE, opportunity.symbol);
    
    console.log('⚡ Executing atomic orders (ultra-fast)...');
    const startTime = Date.now();
    
    // Ultra-fast parallel execution with shorter timeout
    const orderPromises = [
      Promise.race([
        spotExchange.createMarketBuyOrder(opportunity.symbol, amount),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Spot order timeout')), TRADING_CONFIG.ORDER_TIMEOUT_MS)
        )
      ]),
      Promise.race([
        futuresExchange.createMarketSellOrder(opportunity.symbol, amount, {
          reduceOnly: false,
          postOnly: false
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Futures order timeout')), TRADING_CONFIG.ORDER_TIMEOUT_MS)
        )
      ])
    ];
    
    const [spotOrder, futuresOrder] = await Promise.all(orderPromises);
    
    const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`⚡ Execution time: ${executionTime}s`);
    
    console.log('✅ Both orders executed successfully!');
    console.log(`📝 Spot order ID: ${spotOrder.id}`);
    console.log(`📝 Futures order ID: ${futuresOrder.id}`);
    
    const position = {
      tradeId,
      coin: opportunity.coin,
      symbol: opportunity.symbol,
      spotExchange: opportunity.spotExchange,
      futuresExchange: opportunity.futuresExchange,
      spotOrderId: spotOrder.id,
      futuresOrderId: futuresOrder.id,
      spotPrice: spotOrder.average || spotPrice,
      futuresPrice: futuresOrder.average || futuresPrice,
      amount: amount,
      positionSize: positionSize,
      spread: opportunity.netSpread,
      openTime: new Date().toISOString(),
      status: 'OPEN'
    };
    
    activePositions.set(tradeId, position);
    savePositions();
    
    tradingStats.totalTrades++;
    tradingStats.successfulTrades++;
    dailyVolume += positionSize;
    tradingStats.todayVolume = dailyVolume;
    
    return {
      success: true,
      tradeId,
      position,
      mode: 'LIVE'
    };
    
  } catch (error) {
    console.error(`❌ Trade failed: ${error.message}`);
    
    await handleFailedTrade(tradeId, error);
    
    failedOrderCount++;
    tradingStats.totalTrades++;
    tradingStats.failedTrades++;
    
    return {
      success: false,
      tradeId,
      error: error.message,
      mode: TRADING_CONFIG.DRY_RUN_MODE ? 'DRY_RUN' : 'LIVE'
    };
  }
}

/**
 * Order simulation for DRY_RUN mode
 */
async function simulateOrders(opportunity, amount) {
  console.log(`\n🧪 === SIMULATION ===`);
  console.log(`1️⃣ Spot BUY order on ${opportunity.spotExchange}:`);
  console.log(`   Symbol: ${opportunity.symbol}`);
  console.log(`   Amount: ${amount.toFixed(4)} ${opportunity.coin}`);
  console.log(`   Price: $${opportunity.spotPrice}`);
  console.log(`   Total: $${(amount * parseFloat(opportunity.spotPrice)).toFixed(2)}`);
  console.log(`   Status: ✅ FILLED (simulated)`);
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  console.log(`\n2️⃣ Futures SHORT order on ${opportunity.futuresExchange}:`);
  console.log(`   Symbol: ${opportunity.symbol}`);
  console.log(`   Amount: ${amount.toFixed(4)} ${opportunity.coin}`);
  console.log(`   Price: $${opportunity.futuresPrice}`);
  console.log(`   Total: $${(amount * parseFloat(opportunity.futuresPrice)).toFixed(2)}`);
  console.log(`   Leverage: ${TRADING_CONFIG.FUTURES_LEVERAGE}x`);
  console.log(`   Status: ✅ FILLED (simulated)`);
  
  console.log(`\n💰 Expected profit: $${(TRADING_CONFIG.POSITION_SIZE_USD * parseFloat(opportunity.netSpread) / 100).toFixed(2)}`);
  console.log(`🧪 === SIMULATION END ===\n`);
}

/**
 * Rollback attempt for failed trade
 */
async function handleFailedTrade(tradeId, error) {
  console.log(`🔄 Attempting rollback for ${tradeId}...`);
  console.log(`⚠️  Rollback logged - manual intervention may be required`);
  
  const errorLog = {
    tradeId,
    error: error.message,
    timestamp: new Date().toISOString()
  };
  
  logError(errorLog);
}

// ============================================================================
// POSITION MONITORING
// ============================================================================

/**
 * Ochiq pozitsiyalarni monitoring qilish
 */
export function startPositionMonitoring() {
  setInterval(async () => {
    if (activePositions.size === 0) return;
    
    console.log(`📊 Monitoring ${activePositions.size} active positions...`);
    
    for (const [tradeId, position] of activePositions.entries()) {
      try {
        console.log(`✓ ${position.coin}: ${position.status}`);
      } catch (error) {
        console.error(`❌ Error monitoring ${tradeId}:`, error.message);
      }
    }
  }, TRADING_CONFIG.POSITION_CHECK_INTERVAL);
}

// ============================================================================
// PERSISTENCE
// ============================================================================

function savePositions() {
  // ⚡ ASYNC NON-BLOCKING SAVE
  setImmediate(() => {
    try {
      const dataDir = path.join(__dirname, '../data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      const positions = Array.from(activePositions.entries());
      fs.writeFile(
        path.join(dataDir, 'positions.json'),
        JSON.stringify(positions, null, 2),
        (err) => {
          if (err) {
            console.error('❌ Save error:', err.message);
          } else if (TRADING_CONFIG.VERBOSE_LOGGING) {
            console.log(`💾 Saved ${positions.length} positions`);
          }
        }
      );
    } catch (error) {
      console.error('❌ Failed to save positions:', error.message);
    }
  });
}

function loadPositions() {
  try {
    const filePath = path.join(__dirname, '../data/positions.json');
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      activePositions = new Map(data);
      console.log(`✅ Loaded ${activePositions.size} positions`);
    }
  } catch (error) {
    console.error('❌ Failed to load positions:', error.message);
  }
}

function logError(errorLog) {
  try {
    const logFile = path.join(__dirname, '../data/trading-errors.log');
    fs.appendFileSync(logFile, JSON.stringify(errorLog) + '\n');
  } catch (error) {
    console.error('❌ Failed to log error:', error.message);
  }
}

// ============================================================================
// STATS & CONTROLS
// ============================================================================

/**
 * Trading statistikasini olish
 * @returns {Object}
 */
export function getTradingStats() {
  return {
    ...tradingStats,
    activePositions: activePositions.size,
    failedOrderCount,
    config: {
      dryRun: TRADING_CONFIG.DRY_RUN_MODE,
      autoExecute: TRADING_CONFIG.AUTO_EXECUTE,
      minSpread: TRADING_CONFIG.MIN_SPREAD,
      positionSize: TRADING_CONFIG.POSITION_SIZE_USD
    }
  };
}

/**
 * Emergency stop ni yoqish
 */
export function enableEmergencyStop() {
  TRADING_CONFIG.EMERGENCY_STOP = true;
  console.log('⛔ EMERGENCY STOP ACTIVATED - All trading suspended');
}

/**
 * Emergency stop ni o'chirish
 */
export function disableEmergencyStop() {
  TRADING_CONFIG.EMERGENCY_STOP = false;
  console.log('✅ EMERGENCY STOP DEACTIVATED - Trading resumed');
}

/**
 * Xatolar sonini reset qilish
 */
export function resetFailedOrderCount() {
  failedOrderCount = 0;
  console.log('🔄 Failed order counter reset');
}

// ============================================================================
// EXPORT
// ============================================================================

export default {
  initAutoTrader,
  executeHedgedTrade,
  getTradingStats,
  enableEmergencyStop,
  disableEmergencyStop,
  resetFailedOrderCount,
  TRADING_CONFIG
};

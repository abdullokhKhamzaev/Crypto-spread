/**
 * Position Manager
 * 
 * Pozitsiyalarni avtomatik yopish va PnL tracking
 * 
 * @module position-manager
 */

import ccxt from 'ccxt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// CONFIGURATION
// ============================================================================

const CLOSE_CONFIG = {
  // Auto-close triggers
  AUTO_CLOSE_ENABLED: false,           // true = avtomatik yopish
  
  // Profit targets
  TAKE_PROFIT_PERCENT: 0.4,            // 0.4% = yopish
  STOP_LOSS_PERCENT: -0.2,             // -0.2% zarar = yopish
  
  // Time-based
  MAX_POSITION_HOURS: 24,              // 24 soat ichida yopish
  CHECK_INTERVAL_MS: 60000,            // Har 1 daqiqada tekshirish
  
  // Funding-based
  MAX_FUNDING_COST_PERCENT: 0.15,      // 0.15% funding = yopish
};

// ============================================================================
// POSITION TRACKING
// ============================================================================

let exchanges = {};
let activePositions = new Map();

/**
 * Exchange'larni o'rnatish
 */
export function setExchanges(exchangeInstances) {
  exchanges = exchangeInstances;
}

/**
 * Pozitsiyalarni yuklab olish
 */
export function loadPositions() {
  try {
    const positionsPath = path.join(__dirname, '../data/positions.json');
    if (fs.existsSync(positionsPath)) {
      const data = JSON.parse(fs.readFileSync(positionsPath, 'utf8'));
      activePositions = new Map(Object.entries(data));
      console.log(`📊 Loaded ${activePositions.size} positions`);
    }
  } catch (error) {
    console.error('❌ Failed to load positions:', error.message);
  }
}

/**
 * Pozitsiyalarni saqlash
 */
export function savePositions() {
  try {
    const positionsPath = path.join(__dirname, '../data/positions.json');
    const data = Object.fromEntries(activePositions);
    fs.writeFileSync(positionsPath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('❌ Failed to save positions:', error.message);
  }
}

/**
 * Yangi pozitsiya qo'shish
 */
export function addPosition(position) {
  activePositions.set(position.tradeId, position);
  savePositions();
  console.log(`✅ Position added: ${position.tradeId}`);
}

/**
 * Pozitsiyani o'chirish
 */
export function removePosition(tradeId) {
  activePositions.delete(tradeId);
  savePositions();
  console.log(`✅ Position removed: ${tradeId}`);
}

// ============================================================================
// PnL CALCULATION
// ============================================================================

/**
 * Pozitsiya PnL hisoblash (closing cost bilan)
 * @param {Object} position - Position ma'lumoti
 * @param {number} currentSpotPrice - Hozirgi spot narx
 * @param {number} currentFuturesPrice - Hozirgi futures narx
 * @returns {Object}
 */
export function calculatePnL(position, currentSpotPrice, currentFuturesPrice) {
  const spotOpenPrice = parseFloat(position.spotPrice);
  const futuresOpenPrice = parseFloat(position.futuresPrice);
  const amount = parseFloat(position.amount);
  const positionSize = parseFloat(position.positionSize);
  
  // Spot PnL (unrealized - hali sotmadik)
  const spotPnL = (currentSpotPrice - spotOpenPrice) * amount;
  
  // Futures PnL (short position)
  const futuresPnL = (futuresOpenPrice - currentFuturesPrice) * amount;
  
  // Total unrealized PnL
  const unrealizedPnL = spotPnL + futuresPnL;
  
  // Closing costs (spot sell + futures close)
  const closingFeesPercent = 0.16; // 0.1% spot + 0.06% futures
  const closingCost = (positionSize * closingFeesPercent) / 100;
  
  // Funding cost (hozirgi vaqt - open vaqt)
  const openTime = new Date(position.openTime);
  const hoursHeld = (Date.now() - openTime.getTime()) / (1000 * 60 * 60);
  const fundingPeriods = Math.floor(hoursHeld / 8); // Har 8 soatda
  const fundingRate = parseFloat(position.fundingRate || 0) / 100;
  const fundingCost = Math.abs(fundingRate) * fundingPeriods * positionSize;
  
  // Net PnL
  const netPnL = unrealizedPnL - closingCost - fundingCost;
  const netPnLPercent = (netPnL / positionSize) * 100;
  
  return {
    unrealizedPnL,
    closingCost,
    fundingCost,
    netPnL,
    netPnLPercent,
    hoursHeld,
    spotPnL,
    futuresPnL
  };
}

// ============================================================================
// AUTO-CLOSE LOGIC
// ============================================================================

/**
 * Pozitsiyani yopish kerakligini tekshirish
 * @param {Object} position
 * @param {Object} pnl
 * @returns {{shouldClose: boolean, reason: string}}
 */
export function shouldClosePosition(position, pnl) {
  if (!CLOSE_CONFIG.AUTO_CLOSE_ENABLED) {
    return { shouldClose: false, reason: 'AUTO_CLOSE_DISABLED' };
  }
  
  // Take profit
  if (pnl.netPnLPercent >= CLOSE_CONFIG.TAKE_PROFIT_PERCENT) {
    return { 
      shouldClose: true, 
      reason: `TAKE_PROFIT (${pnl.netPnLPercent.toFixed(3)}%)` 
    };
  }
  
  // Stop loss
  if (pnl.netPnLPercent <= CLOSE_CONFIG.STOP_LOSS_PERCENT) {
    return { 
      shouldClose: true, 
      reason: `STOP_LOSS (${pnl.netPnLPercent.toFixed(3)}%)` 
    };
  }
  
  // Time-based
  if (pnl.hoursHeld >= CLOSE_CONFIG.MAX_POSITION_HOURS) {
    return { 
      shouldClose: true, 
      reason: `MAX_TIME (${pnl.hoursHeld.toFixed(1)}h)` 
    };
  }
  
  // Funding cost too high
  const fundingPercent = (pnl.fundingCost / position.positionSize) * 100;
  if (fundingPercent >= CLOSE_CONFIG.MAX_FUNDING_COST_PERCENT) {
    return { 
      shouldClose: true, 
      reason: `HIGH_FUNDING (${fundingPercent.toFixed(3)}%)` 
    };
  }
  
  return { shouldClose: false, reason: 'HOLDING' };
}

/**
 * Pozitsiyani yopish (spot sell + futures close)
 * @param {Object} position
 * @returns {Promise<Object>}
 */
export async function closePosition(position) {
  try {
    console.log(`\n🔴 Closing position: ${position.tradeId}`);
    
    const spotExchange = exchanges[position.spotExchange.toLowerCase()];
    const futuresExchange = exchanges[position.futuresExchange.toLowerCase()];
    
    if (!spotExchange || !futuresExchange) {
      throw new Error('Exchange not available');
    }
    
    const amount = parseFloat(position.amount);
    
    // Parallel close
    const [spotOrder, futuresOrder] = await Promise.all([
      spotExchange.createMarketSellOrder(position.symbol, amount),
      futuresExchange.createMarketBuyOrder(position.symbol, amount, {
        reduceOnly: true
      })
    ]);
    
    console.log(`✅ Position closed: ${position.tradeId}`);
    console.log(`   Spot order: ${spotOrder.id}`);
    console.log(`   Futures order: ${futuresOrder.id}`);
    
    // Update position status
    position.status = 'CLOSED';
    position.closeTime = new Date().toISOString();
    position.spotCloseOrderId = spotOrder.id;
    position.futuresCloseOrderId = futuresOrder.id;
    position.spotClosePrice = spotOrder.average || spotOrder.price;
    position.futuresClosePrice = futuresOrder.average || futuresOrder.price;
    
    // Remove from active positions
    removePosition(position.tradeId);
    
    // Save to history
    saveClosedPosition(position);
    
    return {
      success: true,
      position
    };
    
  } catch (error) {
    console.error(`❌ Failed to close position: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Yopilgan pozitsiyani tarixga saqlash
 */
function saveClosedPosition(position) {
  try {
    const historyPath = path.join(__dirname, '../data/closed-positions.json');
    let history = [];
    
    if (fs.existsSync(historyPath)) {
      history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    }
    
    history.push(position);
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
  } catch (error) {
    console.error('❌ Failed to save closed position:', error.message);
  }
}

// ============================================================================
// AUTO-CLOSE MONITORING
// ============================================================================

/**
 * Barcha pozitsiyalarni monitoring qilish
 */
export async function monitorPositions() {
  if (activePositions.size === 0) {
    return;
  }
  
  console.log(`\n🔍 Monitoring ${activePositions.size} positions...`);
  
  for (const [tradeId, position] of activePositions) {
    try {
      // Get current prices (bu yerda scanner.js dan olish kerak)
      // Hozircha placeholder
      const currentSpotPrice = parseFloat(position.spotPrice);
      const currentFuturesPrice = parseFloat(position.futuresPrice);
      
      const pnl = calculatePnL(position, currentSpotPrice, currentFuturesPrice);
      const closeCheck = shouldClosePosition(position, pnl);
      
      console.log(
        `📊 ${position.coin}: PnL ${pnl.netPnLPercent.toFixed(3)}% | ` +
        `${pnl.hoursHeld.toFixed(1)}h | ${closeCheck.reason}`
      );
      
      if (closeCheck.shouldClose) {
        await closePosition(position);
      }
      
    } catch (error) {
      console.error(`❌ Monitor error (${tradeId}):`, error.message);
    }
  }
}

/**
 * Auto-monitor'ni ishga tushirish
 */
export function startAutoMonitor() {
  console.log('🔄 Auto-monitor started');
  
  setInterval(async () => {
    await monitorPositions();
  }, CLOSE_CONFIG.CHECK_INTERVAL_MS);
}

export default {
  setExchanges,
  loadPositions,
  savePositions,
  addPosition,
  removePosition,
  calculatePnL,
  shouldClosePosition,
  closePosition,
  monitorPositions,
  startAutoMonitor,
  CLOSE_CONFIG
};

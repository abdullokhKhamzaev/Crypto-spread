/**
 * Hedged Arbitrage Scanner
 * 
 * Fetches spot and futures prices from MEXC and Bitget exchanges
 * and finds hedged arbitrage opportunities.
 * 
 * @module scanner
 */

import axios from 'axios';
import https from 'https';
import fs from 'fs';

// ============================================================================
// CONNECTION POOLING - Faster API calls
// ============================================================================

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 3000
});

axios.defaults.httpsAgent = httpsAgent;
axios.defaults.timeout = 3000;

// ============================================================================
// CONFIGURATION
// ============================================================================

const config = JSON.parse(fs.readFileSync('./backend/config.json', 'utf8'));

/**
 * Trading symbols - Coins with spot + futures available on MEXC and Bitget
 */
const SYMBOLS = [
  // Top altcoins
  'ADAUSDT', 'DOTUSDT', 'MATICUSDT', 'LINKUSDT', 'ATOMUSDT',
  'AVAXUSDT', 'LTCUSDT', 'XRPUSDT', 'TRXUSDT',
  
  // Meme coins (yuqori spread)
  'DOGEUSDT', 'SHIBUSDT', 'PEPEUSDT', 'FLOKIUSDT', 'WIFUSDT',
  
  // Gaming/Metaverse
  'SANDUSDT', 'MANAUSDT', 'AXSUSDT', 'GALAUSDT', 'APEUSDT', 'BLURUSDT',
  
  // DeFi
  'AAVEUSDT', 'CRVUSDT', 'UNIUSDT', 'SUSHIUSDT', '1INCHUSDT',
  'COMPUSDT', 'MKRUSDT', 'LDOUSDT',
  
  // Layer 1/2
  'NEARUSDT', 'APTUSDT', 'OPUSDT', 'ARBUSDT', 'SUIUSDT',
  'SEIUSDT', 'ALGOUSDT', 'FTMUSDT',
  
  // Low-cap volatile
  'ILVUSDT', 'GMTUSDT', 'CHZUSDT', 'ENJUSDT', 'JASMYUSDT',
  'VETUSDT', 'ROSEUSDT',
  
  // AI & Trending
  'FETUSDT', 'OCEANUSDT', 'RENDERUSDT', 'WLDUSDT',
  
  // Extra volatile
  'RSRUSDT', 'STXUSDT', 'ICPUSDT', 'INJUSDT', 'RUNEUSDT',
  'THETAUSDT', 'ZILUSDT', 'KSMUSDT', 'FLOWUSDT', 'EGLDUSDT'
];

const API_TIMEOUT = 3000; // 3 seconds

// ============================================================================
// SPREAD LIFETIME TRACKING
// ============================================================================

// Track when each spread first appeared
const spreadFirstSeen = new Map();
const spreadLifetimes = [];

/**
 * Track spread lifetime
 * @param {string} key - Unique spread key (coin + exchanges)
 * @param {number} spread - Spread value
 * @returns {number} Lifetime in seconds
 */
function trackSpreadLifetime(key, spread) {
  const now = Date.now();
  
  if (!spreadFirstSeen.has(key)) {
    // First time seeing this spread
    spreadFirstSeen.set(key, { time: now, spread });
    return 0; // Just appeared
  }
  
  const firstSeen = spreadFirstSeen.get(key);
  const lifetime = (now - firstSeen.time) / 1000; // seconds
  
  return lifetime;
}

/**
 * Record spread death (when it disappears)
 * @param {string} key - Spread key
 */
function recordSpreadDeath(key) {
  if (spreadFirstSeen.has(key)) {
    const firstSeen = spreadFirstSeen.get(key);
    const lifetime = (Date.now() - firstSeen.time) / 1000;
    
    spreadLifetimes.push({
      key,
      spread: firstSeen.spread,
      lifetime,
      timestamp: new Date().toISOString()
    });
    
    spreadFirstSeen.delete(key);
    
    // Keep only last 100 records
    if (spreadLifetimes.length > 100) {
      spreadLifetimes.shift();
    }
  }
}

/**
 * Get lifetime statistics
 */
export function getLifetimeStats() {
  if (spreadLifetimes.length === 0) {
    return {
      count: 0,
      avgLifetime: 0,
      minLifetime: 0,
      maxLifetime: 0,
      recent: []
    };
  }
  
  const lifetimes = spreadLifetimes.map(s => s.lifetime);
  const avg = lifetimes.reduce((a, b) => a + b, 0) / lifetimes.length;
  const min = Math.min(...lifetimes);
  const max = Math.max(...lifetimes);
  
  return {
    count: spreadLifetimes.length,
    avgLifetime: avg.toFixed(1),
    minLifetime: min.toFixed(1),
    maxLifetime: max.toFixed(1),
    recent: spreadLifetimes.slice(-10).reverse()
  };
}

// ============================================================================
// EXCHANGE API FUNCTIONS
// ============================================================================

/**
 * Fetch spot and futures prices from MEXC exchange
 * @returns {Promise<{spot: Object, futures: Object, funding: Object}>}
 */
async function fetchMEXC() {
  try {
    const [spotRes, futuresRes, fundingRes] = await Promise.all([
      axios.get('https://api.mexc.com/api/v3/ticker/price', { timeout: API_TIMEOUT }),
      axios.get('https://contract.mexc.com/api/v1/contract/ticker', { timeout: API_TIMEOUT }),
      axios.get('https://contract.mexc.com/api/v1/contract/funding_rate', { timeout: API_TIMEOUT })
    ]);

    const spotPrices = {};
    const futuresPrices = {};
    const fundingRates = {};

    // Parse spot prices
    spotRes.data.forEach(item => {
      if (SYMBOLS.includes(item.symbol)) {
        spotPrices[item.symbol] = parseFloat(item.price);
      }
    });

    // Parse futures prices
    if (futuresRes.data.data) {
      futuresRes.data.data.forEach(item => {
        const symbol = item.symbol.replace('_USDT', 'USDT');
        if (SYMBOLS.includes(symbol)) {
          futuresPrices[symbol] = parseFloat(item.lastPrice);
        }
      });
    }

    // Parse funding rates
    if (fundingRes.data.data) {
      fundingRes.data.data.forEach(item => {
        const symbol = item.symbol.replace('_USDT', 'USDT');
        if (SYMBOLS.includes(symbol)) {
          fundingRates[symbol] = parseFloat(item.fundingRate || 0);
        }
      });
    }

    return { spot: spotPrices, futures: futuresPrices, funding: fundingRates };
  } catch (error) {
    console.error('❌ MEXC fetch error:', error.message);
    return { spot: {}, futures: {}, funding: {} };
  }
}

/**
 * Fetch spot and futures prices from Bitget exchange
 * @returns {Promise<{spot: Object, futures: Object, funding: Object}>}
 */
async function fetchBitget() {
  try {
    const [spotRes, futuresRes] = await Promise.all([
      axios.get('https://api.bitget.com/api/spot/v1/market/tickers', { timeout: API_TIMEOUT }),
      axios.get('https://api.bitget.com/api/mix/v1/market/tickers?productType=umcbl', { timeout: API_TIMEOUT })
    ]);

    const spotPrices = {};
    const futuresPrices = {};
    const fundingRates = {};

    // Parse spot prices
    if (spotRes.data.data) {
      spotRes.data.data.forEach(item => {
        if (SYMBOLS.includes(item.symbol)) {
          spotPrices[item.symbol] = parseFloat(item.close);
        }
      });
    }

    // Parse futures prices and funding rates
    if (futuresRes.data.data) {
      futuresRes.data.data.forEach(item => {
        const symbol = item.symbol.replace('_UMCBL', '');
        if (SYMBOLS.includes(symbol)) {
          futuresPrices[symbol] = parseFloat(item.last);
          // Get Bitget funding rate if available
          fundingRates[symbol] = parseFloat(item.fundingRate || 0);
        }
      });
    }

    return { spot: spotPrices, futures: futuresPrices, funding: fundingRates };
  } catch (error) {
    console.error('❌ Bitget fetch error:', error.message);
    return { spot: {}, futures: {}, funding: {} };
  }
}

// ============================================================================
// SPREAD CALCULATION
// ============================================================================

/**
 * Calculate spread between two prices
 * @param {number} buyPrice - Buy price (spot)
 * @param {number} sellPrice - Sell price (futures)
 * @returns {number} Spread in percentage
 */
function calculateSpread(buyPrice, sellPrice) {
  return ((sellPrice - buyPrice) / buyPrice) * 100;
}

/**
 * Calculate net spread accounting for trading fees and funding
 * @param {number} grossSpread - Gross spread %
 * @param {string} spotExchange - Spot exchange name
 * @param {string} futuresExchange - Futures exchange name
 * @param {number} fundingRate - Funding rate
 * @returns {{netSpread: number, totalCost: number}}
 */
function calculateNetSpread(grossSpread, spotExchange, futuresExchange, fundingRate = 0) {
  const spotConfig = config.exchanges[spotExchange.toLowerCase()];
  const futuresConfig = config.exchanges[futuresExchange.toLowerCase()];
  
  const spotFee = spotConfig ? spotConfig.spot.takerFee * 100 : 0.1;
  const futuresFee = futuresConfig ? futuresConfig.futures.takerFee * 100 : 0.06;
  const fundingCost = Math.abs(fundingRate) * 100 * 3; // 3x per day
  
  const totalCost = spotFee + futuresFee + fundingCost;
  const netSpread = grossSpread - totalCost;
  
  return { netSpread, totalCost };
}

// ============================================================================
// MAIN SCANNER FUNCTION
// ============================================================================

/**
 * Scan for hedged arbitrage opportunities
 * 
 * Process:
 * 1. Fetch prices from MEXC and Bitget
 * 2. Find best spot and futures prices for each coin
 * 3. Calculate spread (accounting for fees and funding)
 * 4. Sort opportunities (best first)
 * 
 * @returns {Promise<Array>} List of arbitrage opportunities
 */
export async function scanHedgedOpportunities() {
  const startTime = Date.now();

  // Fetch prices from both exchanges
  const [mexc, bitget] = await Promise.all([
    fetchMEXC(),
    fetchBitget()
  ]);

  const opportunities = [];

  // Analyze each symbol
  for (const symbol of SYMBOLS) {
    const coin = symbol.replace('USDT', '');
    
    // Collect spot prices
    const spotPrices = [];
    if (mexc.spot[symbol]) {
      spotPrices.push({ exchange: 'MEXC', price: mexc.spot[symbol] });
    }
    if (bitget.spot[symbol]) {
      spotPrices.push({ exchange: 'Bitget', price: bitget.spot[symbol] });
    }

    // Collect futures prices with funding rates
    const futuresPrices = [];
    if (mexc.futures[symbol]) {
      futuresPrices.push({ 
        exchange: 'MEXC', 
        price: mexc.futures[symbol], 
        funding: mexc.funding[symbol] || 0 
      });
    }
    if (bitget.futures[symbol]) {
      futuresPrices.push({ 
        exchange: 'Bitget', 
        price: bitget.futures[symbol], 
        funding: bitget.funding[symbol] || 0 
      });
    }

    // Skip if no prices available
    if (spotPrices.length === 0 || futuresPrices.length === 0) {
      continue;
    }

    // Find best prices
    const bestSpotBuy = spotPrices.reduce((min, p) => p.price < min.price ? p : min);
    const bestFuturesShort = futuresPrices.reduce((max, p) => p.price > max.price ? p : max);
    
    // Skip if same exchange (need hedged arbitrage)
    if (bestSpotBuy.exchange === bestFuturesShort.exchange) {
      continue;
    }

    // Calculate spreads
    const grossSpread = calculateSpread(bestSpotBuy.price, bestFuturesShort.price);
    const { netSpread, totalCost } = calculateNetSpread(
      grossSpread,
      bestSpotBuy.exchange,
      bestFuturesShort.exchange,
      bestFuturesShort.funding
    );

    // ⚡ LIFETIME TRACKING - only for spreads above minimum
    const spreadKey = `${coin}_${bestSpotBuy.exchange}_${bestFuturesShort.exchange}`;
    const MIN_SPREAD = parseFloat(process.env.MIN_NET_SPREAD || '0.5');
    let lifetime = 0;
    
    if (netSpread >= MIN_SPREAD) {
      // Only track if above minimum spread
      lifetime = trackSpreadLifetime(spreadKey, netSpread);
    } else {
      // If below minimum spread - mark as dead
      if (spreadFirstSeen.has(spreadKey)) {
        recordSpreadDeath(spreadKey);
      }
    }

    // Log for debugging with lifetime
    console.log(
      `${coin}: ${bestSpotBuy.exchange} $${bestSpotBuy.price.toFixed(6)} → ` +
      `${bestFuturesShort.exchange} $${bestFuturesShort.price.toFixed(6)} | ` +
      `Gross: ${grossSpread.toFixed(3)}% | Net: ${netSpread.toFixed(3)}% | ` +
      `⏱ ${lifetime.toFixed(1)}s`
    );

    // Add to opportunities with lifetime - only above minimum spread
    if (netSpread >= MIN_SPREAD) {
      opportunities.push({
        coin,
        symbol,
        spotExchange: bestSpotBuy.exchange,
        spotPrice: bestSpotBuy.price.toFixed(8),
        futuresExchange: bestFuturesShort.exchange,
        futuresPrice: bestFuturesShort.price.toFixed(8),
        spreadPercent: grossSpread.toFixed(3),
        totalCost: totalCost.toFixed(3),
        netSpread: netSpread.toFixed(3),
        fundingRate: (bestFuturesShort.funding * 100).toFixed(4),
        estimatedProfit: (config.trading.maxPositionSize * netSpread / 100).toFixed(2),
        lifetime: lifetime.toFixed(1),  // ⚡ Spread lifetime
        timestamp: new Date().toISOString()
      });
    }
  }

  // ⚡ Dead spread checking now done above, before pushing opportunities
  // Nothing more needed here

  // Sort by net spread (best first)
  opportunities.sort((a, b) => parseFloat(b.netSpread) - parseFloat(a.netSpread));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  const bestSpread = opportunities[0]?.netSpread || '0.000';
  const bestLifetime = opportunities[0]?.lifetime || '0.0';
  
  console.log(`✅ Scan: ${opportunities.length} opps in ${elapsed}s | Best: ${bestSpread}% (⏱${bestLifetime}s)`);

  return opportunities;
}

export default { scanHedgedOpportunities };

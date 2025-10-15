import axios from 'axios';
import fs from 'fs';

// Load config
const config = JSON.parse(fs.readFileSync('./backend/config.json', 'utf8'));

// Verified coins with SPOT + FUTURES on Binance, MEXC, Bitget (high spread potential)
const symbols = [
  // Top altcoins (low spread but always available)
  'ADAUSDT', 'DOTUSDT', 'MATICUSDT', 'LINKUSDT', 'ATOMUSDT', 'AVAXUSDT',
  
  // Meme coins (HIGHEST spread potential 0.5-2%)
  'DOGEUSDT',      // All 3 exchanges ✅
  // Note: SHIB and PEPE use 1000SHIBUSDT/1000PEPEUSDT on Binance
  
  // Gaming/Metaverse (HIGH spread 0.3-1%)
  'SANDUSDT',      // All 3 ✅
  'MANAUSDT',      // All 3 ✅
  'AXSUSDT',       // All 3 ✅
  'GALAUSDT',      // All 3 ✅
  'APEUSDT',       // All 3 ✅
  
  // DeFi (MEDIUM spread 0.2-0.8%)
  'AAVEUSDT',      // All 3 ✅
  'CRVUSDT',       // All 3 ✅
  'UNIUSDT',       // All 3 ✅
  'SNXUSDT',       // All 3 ✅
  'COMPUSDT',      // All 3 ✅
  
  // Layer 1/2 (MEDIUM spread 0.2-0.6%)
  'NEARUSDT',      // All 3 ✅
  'APTUSDT',       // All 3 ✅
  'OPUSDT',        // All 3 ✅
  'ARBUSDT',       // All 3 ✅
  'SUIUSDT',       // All 3 ✅
  
  // Low-cap volatile (VERY HIGH spread 0.5-1.5%)
  'ILVUSDT',       // Medium cap, good spread
  'LDOUSDT',       // DeFi, medium spread
  'GMTUSDT',       // Move-to-earn, high spread
  'CHZUSDT',       // Sports, medium spread
  'ENJUSDT'        // Gaming, medium spread
];

// Fetch Binance spot + futures
async function fetchBinance() {
  try {
    const [spotRes, futuresRes, fundingRes] = await Promise.all([
      axios.get('https://api.binance.com/api/v3/ticker/price', { timeout: 3000 }),
      axios.get('https://fapi.binance.com/fapi/v1/ticker/price', { timeout: 3000 }),
      axios.get('https://fapi.binance.com/fapi/v1/premiumIndex', { timeout: 3000 })
    ]);

    const spotPrices = {};
    const futuresPrices = {};
    const fundingRates = {};

    spotRes.data.forEach(item => {
      if (symbols.includes(item.symbol)) {
        spotPrices[item.symbol] = parseFloat(item.price);
      }
    });

    futuresRes.data.forEach(item => {
      if (symbols.includes(item.symbol)) {
        futuresPrices[item.symbol] = parseFloat(item.price);
      }
    });

    fundingRes.data.forEach(item => {
      if (symbols.includes(item.symbol)) {
        fundingRates[item.symbol] = parseFloat(item.lastFundingRate);
      }
    });

    return { spot: spotPrices, futures: futuresPrices, funding: fundingRates };
  } catch (error) {
    console.error('Binance fetch error:', error.message);
    return { spot: {}, futures: {}, funding: {} };
  }
}

// Fetch MEXC spot + futures
async function fetchMEXC() {
  try {
    const [spotRes, futuresRes] = await Promise.all([
      axios.get('https://api.mexc.com/api/v3/ticker/price', { timeout: 3000 }),
      axios.get('https://contract.mexc.com/api/v1/contract/ticker', { timeout: 3000 })
    ]);

    const spotPrices = {};
    const futuresPrices = {};

    spotRes.data.forEach(item => {
      if (symbols.includes(item.symbol)) {
        spotPrices[item.symbol] = parseFloat(item.price);
      }
    });

    if (futuresRes.data.data) {
      futuresRes.data.data.forEach(item => {
        const symbol = item.symbol.replace('_USDT', 'USDT');
        if (symbols.includes(symbol)) {
          futuresPrices[symbol] = parseFloat(item.lastPrice);
        }
      });
    }

    return { spot: spotPrices, futures: futuresPrices, funding: {} };
  } catch (error) {
    console.error('MEXC fetch error:', error.message);
    return { spot: {}, futures: {}, funding: {} };
  }
}

// Fetch Bitget spot + futures
async function fetchBitget() {
  try {
    const [spotRes, futuresRes] = await Promise.all([
      axios.get('https://api.bitget.com/api/spot/v1/market/tickers', { timeout: 3000 }),
      axios.get('https://api.bitget.com/api/mix/v1/market/tickers?productType=umcbl', { timeout: 3000 })
    ]);

    const spotPrices = {};
    const futuresPrices = {};

    if (spotRes.data.data) {
      spotRes.data.data.forEach(item => {
        if (symbols.includes(item.symbol)) {
          spotPrices[item.symbol] = parseFloat(item.close);
        }
      });
    }

    if (futuresRes.data.data) {
      futuresRes.data.data.forEach(item => {
        const symbol = item.symbol.replace('_UMCBL', '');
        if (symbols.includes(symbol)) {
          futuresPrices[symbol] = parseFloat(item.last);
        }
      });
    }

    return { spot: spotPrices, futures: futuresPrices, funding: {} };
  } catch (error) {
    console.error('Bitget fetch error:', error.message);
    return { spot: {}, futures: {}, funding: {} };
  }
}

// Calculate hedged arbitrage opportunities
export async function scanHedgedOpportunities() {
  const startTime = Date.now();

  // Fetch all exchanges in parallel
  const [binance, mexc, bitget] = await Promise.all([
    fetchBinance(),
    fetchMEXC(),
    fetchBitget()
  ]);

  const opportunities = [];

  // Check each symbol
  for (const symbol of symbols) {
    const coin = symbol.replace('USDT', '');
    
    // Collect all spot prices
    const spotPrices = [];
    if (binance.spot[symbol]) spotPrices.push({ exchange: 'Binance', price: binance.spot[symbol] });
    if (mexc.spot[symbol]) spotPrices.push({ exchange: 'MEXC', price: mexc.spot[symbol] });
    if (bitget.spot[symbol]) spotPrices.push({ exchange: 'Bitget', price: bitget.spot[symbol] });

    // Collect all futures prices
    const futuresPrices = [];
    if (binance.futures[symbol]) futuresPrices.push({ exchange: 'Binance', price: binance.futures[symbol], funding: binance.funding[symbol] || 0 });
    if (mexc.futures[symbol]) futuresPrices.push({ exchange: 'MEXC', price: mexc.futures[symbol], funding: 0 });
    if (bitget.futures[symbol]) futuresPrices.push({ exchange: 'Bitget', price: bitget.futures[symbol], funding: 0 });

    // Skip if no spot or futures prices available
    if (spotPrices.length === 0 || futuresPrices.length === 0) continue;

    // Find best spot buy (lowest)
    const bestSpotBuy = spotPrices.reduce((min, p) => p.price < min.price ? p : min);

    // Find best futures short (highest)
    const bestFuturesShort = futuresPrices.reduce((max, p) => p.price > max.price ? p : max);
    
    // Skip if same exchange (cannot do hedged arbitrage on same exchange)
    if (bestSpotBuy.exchange === bestFuturesShort.exchange) {
      continue;
    }

    // Calculate spread
    const spreadPercent = ((bestFuturesShort.price - bestSpotBuy.price) / bestSpotBuy.price) * 100;

    // Calculate total fees
    const spotExchange = config.exchanges[bestSpotBuy.exchange.toLowerCase()];
    const futuresExchange = config.exchanges[bestFuturesShort.exchange.toLowerCase()];
    
    const spotFee = spotExchange ? spotExchange.spot.takerFee * 100 : 0.1;
    const futuresFee = futuresExchange ? futuresExchange.futures.takerFee * 100 : 0.06;
    const fundingCost = Math.abs(bestFuturesShort.funding || 0) * 100 * 3; // 3x per day
    
    const totalCost = spotFee + futuresFee + fundingCost;
    const netSpread = spreadPercent - totalCost;

    // Debug logging for ALL spreads
    console.log(`${coin}: Spot ${bestSpotBuy.exchange} $${bestSpotBuy.price} | Futures ${bestFuturesShort.exchange} $${bestFuturesShort.price} | Gross: ${spreadPercent.toFixed(3)}% | Net: ${netSpread.toFixed(3)}%`);
    
    // Show ALL spreads (including negative) to see market state
    if (true) {
      opportunities.push({
        coin,
        symbol,
        spotExchange: bestSpotBuy.exchange,
        spotPrice: bestSpotBuy.price.toFixed(8),
        futuresExchange: bestFuturesShort.exchange,
        futuresPrice: bestFuturesShort.price.toFixed(8),
        spreadPercent: spreadPercent.toFixed(3),
        totalCost: totalCost.toFixed(3),
        netSpread: netSpread.toFixed(3),
        fundingRate: (bestFuturesShort.funding * 100).toFixed(4),
        estimatedProfit: (config.trading.maxPositionSize * netSpread / 100).toFixed(2),
        timestamp: new Date().toISOString()
      });
    }
  }

  // Sort by net spread (highest first)
  opportunities.sort((a, b) => parseFloat(b.netSpread) - parseFloat(a.netSpread));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`✓ Hedged scan: ${opportunities.length} opportunities | ${elapsed}s | Best: ${opportunities[0]?.netSpread || 0}%`);

  return opportunities;
}

export default { scanHedgedOpportunities };

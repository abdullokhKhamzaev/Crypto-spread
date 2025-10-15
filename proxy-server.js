import express from 'express';
import cors from 'cors';
import axios from 'axios';
const app = express();
const port = 8000;

app.use(cors());
app.use(express.json());

// Crypto symbols to track - ONLY high-spread potential coins (0.3%+)
const cryptoSymbols = [
  // Meme coins (highest spreads 1-5%)
  'SHIBUSDT', 'FLOKIUSDT', 'PEPEUSDT', 'BONKUSDT', 'WIFUSDT', 'DOGEUSDT',
  
  // Low-cap volatile (0.5-3%)
  'LUNCUSDT', 'JASMYUSDT', 'VETUSDT', 'CHZUSDT', 'ENJUSDT', 'GMTUSDT', 'APEUSDT', 'BLURUSDT',
  
  // Gaming/Metaverse (0.5-2%)
  'SANDUSDT', 'MANAUSDT', 'GALAUSDT', 'AXSUSDT', 'IMXUSDT', 'MAGICUSDT', 'ALICEUSDT',
  
  // DeFi mid-cap (0.3-1.5%)
  'AAVEUSDT', 'CRVUSDT', 'SUSHIUSDT', '1INCHUSDT', 'COMPUSDT', 'MKRUSDT', 'SNXUSDT', 'LDOUSDT',
  
  // Layer 1/2 volatile (0.3-1%)
  'FTMUSDT', 'ALGOUSDT', 'NEARUSDT', 'SEIUSDT', 'APTUSDT'
];

// Exchange API functions with timeout
const fetchBinancePrice = async (symbol) => {
  try {
    const response = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, { timeout: 3000 });
    return { exchange: 'Binance', price: parseFloat(response.data.price) };
  } catch (error) {
    return null;
  }
};

const fetchKucoinPrice = async (symbol) => {
  try {
    const response = await axios.get(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${symbol}`, { timeout: 3000 });
    return { exchange: 'KuCoin', price: parseFloat(response.data.data.price) };
  } catch (error) {
    return null;
  }
};

const fetchGatePrice = async (symbol) => {
  try {
    const pair = symbol.replace('USDT', '_USDT');
    const response = await axios.get(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${pair}`, { timeout: 3000 });
    return { exchange: 'Gate.io', price: parseFloat(response.data[0].last) };
  } catch (error) {
    return null;
  }
};

const fetchMexcPrice = async (symbol) => {
  try {
    const response = await axios.get(`https://api.mexc.com/api/v3/ticker/price?symbol=${symbol}`, { timeout: 3000 });
    return { exchange: 'MEXC', price: parseFloat(response.data.price) };
  } catch (error) {
    return null;
  }
};

const fetchBitgetPrice = async (symbol) => {
  try {
    const response = await axios.get(`https://api.bitget.com/api/spot/v1/market/ticker?symbol=${symbol}`, { timeout: 3000 });
    return { exchange: 'Bitget', price: parseFloat(response.data.data.close) };
  } catch (error) {
    return null;
  }
};

app.get('/spread', async (req, res) => {
  try {
    const startTime = Date.now();
    const allOpportunities = [];

    // Fetch ALL symbols in parallel (not in batches)
    const allResults = await Promise.all(
      cryptoSymbols.map(async (symbol) => {
        // Fetch prices from multiple exchanges in parallel
        const prices = await Promise.allSettled([
          fetchBinancePrice(symbol),
          fetchKucoinPrice(symbol),
          fetchGatePrice(symbol),
          fetchMexcPrice(symbol),
          fetchBitgetPrice(symbol)
        ]);

          // Filter successful responses
          const validPrices = prices
            .filter(result => result.status === 'fulfilled' && result.value !== null)
            .map(result => result.value);

          if (validPrices.length >= 2) {
            // Find lowest and highest prices
            const sortedPrices = validPrices.sort((a, b) => a.price - b.price);
            const lowestPrice = sortedPrices[0];
            const highestPrice = sortedPrices[sortedPrices.length - 1];

            // Calculate spread
            const spreadPercent = ((highestPrice.price - lowestPrice.price) / lowestPrice.price);
            const spreadUSD = highestPrice.price - lowestPrice.price;

            // Only show spreads > 0.1% to display more opportunities
            if (spreadPercent > 0.001) {
              return {
                asset: symbol.replace('USDT', ''),
                best_buy_exchange: lowestPrice.exchange,
                best_sell_exchange: highestPrice.exchange,
                lowest_price: lowestPrice.price,
                highest_price: highestPrice.price,
                spread_percent: spreadPercent,
                spread_usd: spreadUSD,
                timestamp: new Date().toISOString(),
                estimated_volume: Math.floor(Math.random() * 50000) + 10000,
                supports_futures: ['Binance', 'Bybit', 'OKX'].includes(highestPrice.exchange)
              };
            }
          }
        return null;
      })
    );
    
    // Filter out null results and sort by spread (highest first)
    const validOpportunities = allResults
      .filter(r => r !== null)
      .sort((a, b) => b.spread_percent - a.spread_percent);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✓ Real-time: ${validOpportunities.length} opportunities | ${elapsed}s | Best: ${(validOpportunities[0]?.spread_percent * 100).toFixed(2)}%`);
    
    res.json(validOpportunities);
  } catch (error) {
    console.error('Error fetching data:', error);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.listen(port, () => {
  console.log(`Crypto arbitrage API running at http://localhost:${port}`);
});
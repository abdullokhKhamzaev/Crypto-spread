/**
 * Market Depth Analyzer
 * 
 * Order book depth tahlil qilib slippage prediction qilish
 * 
 * @module market-depth
 */

import axios from 'axios';

const API_TIMEOUT = 3000;

/**
 * MEXC order book depth olish
 * @param {string} symbol - Trading symbol (BTCUSDT)
 * @param {number} quantity - Order hajmi
 * @returns {Promise<{slippage: number, depth: number}>}
 */
export async function getMEXCDepth(symbol, quantity) {
  try {
    const response = await axios.get(
      `https://api.mexc.com/api/v3/depth?symbol=${symbol}&limit=20`,
      { timeout: API_TIMEOUT }
    );

    const { bids, asks } = response.data;
    
    // Buy order uchun asks (sotuvchi)larni tahlil qilish
    let totalQuantity = 0;
    let totalCost = 0;
    
    for (const [price, qty] of asks) {
      const askPrice = parseFloat(price);
      const askQty = parseFloat(qty);
      
      if (totalQuantity >= quantity) break;
      
      const neededQty = Math.min(askQty, quantity - totalQuantity);
      totalCost += neededQty * askPrice;
      totalQuantity += neededQty;
    }
    
    if (totalQuantity === 0) {
      return { slippage: 0, depth: 0, avgPrice: 0 };
    }
    
    const avgPrice = totalCost / totalQuantity;
    const bestPrice = parseFloat(asks[0][0]);
    const slippage = ((avgPrice - bestPrice) / bestPrice) * 100;
    
    return {
      slippage: Math.abs(slippage),
      depth: totalQuantity,
      avgPrice,
      bestPrice
    };
  } catch (error) {
    console.error(`❌ MEXC depth error (${symbol}):`, error.message);
    return { slippage: 0.15, depth: 0, avgPrice: 0 }; // Conservative default
  }
}

/**
 * Bitget order book depth olish
 * @param {string} symbol - Trading symbol (BTCUSDT)
 * @param {number} quantity - Order hajmi
 * @returns {Promise<{slippage: number, depth: number}>}
 */
export async function getBitgetDepth(symbol, quantity) {
  try {
    const response = await axios.get(
      `https://api.bitget.com/api/spot/v1/market/depth?symbol=${symbol}&limit=20&type=step0`,
      { timeout: API_TIMEOUT }
    );

    const { asks } = response.data.data;
    
    let totalQuantity = 0;
    let totalCost = 0;
    
    for (const [price, qty] of asks) {
      const askPrice = parseFloat(price);
      const askQty = parseFloat(qty);
      
      if (totalQuantity >= quantity) break;
      
      const neededQty = Math.min(askQty, quantity - totalQuantity);
      totalCost += neededQty * askPrice;
      totalQuantity += neededQty;
    }
    
    if (totalQuantity === 0) {
      return { slippage: 0, depth: 0, avgPrice: 0 };
    }
    
    const avgPrice = totalCost / totalQuantity;
    const bestPrice = parseFloat(asks[0][0]);
    const slippage = ((avgPrice - bestPrice) / bestPrice) * 100;
    
    return {
      slippage: Math.abs(slippage),
      depth: totalQuantity,
      avgPrice,
      bestPrice
    };
  } catch (error) {
    console.error(`❌ Bitget depth error (${symbol}):`, error.message);
    return { slippage: 0.15, depth: 0, avgPrice: 0 }; // Conservative default
  }
}

/**
 * Slippage prediction qilish
 * @param {string} exchange - Exchange nomi
 * @param {string} symbol - Trading symbol
 * @param {number} positionSizeUSD - Position hajmi USD
 * @param {number} price - Hozirgi narx
 * @returns {Promise<Object>}
 */
export async function predictSlippage(exchange, symbol, positionSizeUSD, price) {
  const quantity = positionSizeUSD / price;
  
  let depthData;
  if (exchange.toLowerCase() === 'mexc') {
    depthData = await getMEXCDepth(symbol, quantity);
  } else if (exchange.toLowerCase() === 'bitget') {
    depthData = await getBitgetDepth(symbol, quantity);
  } else {
    return { slippage: 0.15, depth: 0, warning: 'Unknown exchange' };
  }
  
  // Slippage warning
  let warning = null;
  if (depthData.slippage > 0.3) {
    warning = 'HIGH_SLIPPAGE';
  } else if (depthData.depth < quantity) {
    warning = 'LOW_DEPTH';
  }
  
  return {
    exchange,
    symbol,
    slippage: depthData.slippage,
    depth: depthData.depth,
    avgPrice: depthData.avgPrice,
    bestPrice: depthData.bestPrice,
    warning
  };
}

export default {
  getMEXCDepth,
  getBitgetDepth,
  predictSlippage
};

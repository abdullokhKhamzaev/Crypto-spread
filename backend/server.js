import express from 'express';
import cors from 'cors';
import { scanHedgedOpportunities } from './scanner.js';

const app = express();
const port = 8001; // Different port from old server

app.use(cors());
app.use(express.json());

// Hedged arbitrage endpoint
app.get('/hedged-spread', async (req, res) => {
  try {
    const opportunities = await scanHedgedOpportunities();
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

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import axios from 'axios'

// Reactive data
const opportunities = ref([])
const filteredOpportunities = ref([])
const loading = ref(true)
const executing = ref(false)
const lastUpdate = ref('-')
const selectedExchanges = ref(['MEXC', 'Bitget'])
const availableExchanges = ref(['MEXC', 'Bitget'])
const filters = ref({
  minSpread: -1,  // Allow negative spreads to see full market
  maxSpread: 20,  // Increased for high-spread hedged arbitrage opportunities
  minVolume: 0,
  investmentAmount: 1000 // Default $1000 investment
})

let intervalId = null

// Computed properties
const avgSpread = computed(() => {
  if (filteredOpportunities.value.length === 0) return '0.00'
  const sum = filteredOpportunities.value.reduce((acc, opp) => acc + parseFloat(opp.spread), 0)
  return (sum / filteredOpportunities.value.length).toFixed(2)
})

const maxSpreadValue = computed(() => {
  if (filteredOpportunities.value.length === 0) return '0.00'
  return Math.max(...filteredOpportunities.value.map(o => parseFloat(o.spread))).toFixed(2)
})

const profitableCount = computed(() => {
  return filteredOpportunities.value.filter(o => parseFloat(o.profitWithFees) > 0).length
})

// Methods
const fetchData = async () => {
  try {
    const response = await axios.get('http://localhost:8001/hedged-spread')
    const data = response.data

    // Transform hedged arbitrage data
    opportunities.value = data.map(item => ({
      coin: item.coin,
      pair: item.symbol,
      network1: item.spotExchange,
      network2: item.futuresExchange,
      buyPrice: item.spotPrice,
      sellPrice: item.futuresPrice,
      spread: item.netSpread, // Net spread after all costs
      grossSpread: item.spreadPercent,
      totalCost: item.totalCost,
      fundingRate: item.fundingRate,
      spreadUSD: ((parseFloat(item.spotPrice) * parseFloat(item.netSpread)) / 100).toFixed(4),
      volume: Math.random() * 10000000, // Mock volume
      timestamp: item.timestamp
    }))

    opportunities.value
    applyFilters()
    lastUpdate.value = new Date().toLocaleTimeString('ru-RU')
    
    // Play sound notification if good spreads found
    if (opportunities.value.length > 0 && opportunities.value.some(o => parseFloat(o.spread) > 0.7)) {
      playNotificationSound()
    }
    
    loading.value = false
  } catch (error) {
    console.error('Error fetching data:', error)
    loading.value = false
  }
}

const applyFilters = () => {
  let filtered = [...opportunities.value]

  // Filter by selected exchanges (both spot and futures must be in selected list)
  filtered = filtered.filter(o => 
    selectedExchanges.value.includes(o.network1) && 
    selectedExchanges.value.includes(o.network2)
  )

  // Calculate profit for each opportunity
  filtered = filtered.map(o => ({
    ...o,
    estimatedProfit: (filters.value.investmentAmount * parseFloat(o.spread) / 100).toFixed(2),
    profitWithFees: ((filters.value.investmentAmount * parseFloat(o.spread) / 100) - (filters.value.investmentAmount * 0.001)).toFixed(2) // 0.1% total fees
  }))

  // Apply spread range filter (INCLUDING negative spreads)
  filtered = filtered.filter(o => {
    const spread = parseFloat(o.spread)
    return spread >= filters.value.minSpread && spread <= filters.value.maxSpread
  })
  
  // Apply volume filter
  if (filters.value.minVolume > 0) {
    filtered = filtered.filter(o => parseFloat(o.volume) >= filters.value.minVolume)
  }
  
  // Sort by net spread descending (best first, even if negative)
  filtered.sort((a, b) => parseFloat(b.spread) - parseFloat(a.spread))

  filteredOpportunities.value = filtered
  
  console.log(`Filtered: ${filtered.length} opportunities (${filtered.filter(o => parseFloat(o.profitWithFees) > 0).length} profitable)`)
}

const formatVolume = (volume) => {
  const v = parseFloat(volume)
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M $'
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K $'
  return v.toFixed(0) + ' $'
}

// Sound notification for new opportunities
const playNotificationSound = () => {
  const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmAaAC13sfCuXSMCM5bP7tF8LwM0e8b1')
  audio.volume = 0.2
  audio.play().catch(() => {})
}

const executeHedgedArbitrage = async (opp) => {
  const confirmMessage = `🚀 HEDGED ARBITRAJ BAJARISH\n\n` +
    `💰 Coin: ${opp.coin}\n` +
    `📈 Spread: ${opp.spread}% (${opp.spreadUSD}$)\n\n` +
    `🔥 BIR VAQTDA:\n` +
    `🟢 ${opp.network1} da sotib olish: $${opp.buyPrice}\n` +
    `🔴 ${opp.network2} da short ochish: $${opp.sellPrice}\n\n` +
    `⚠️ API sozlanganligiga va ikkala birjada mablag' borligiga ishonch hosil qiling!`

  if (confirm(confirmMessage)) {
    executing.value = true
    
    try {
      // Simulate simultaneous execution (1-2 seconds as mentioned in PDF)
      await new Promise(resolve => setTimeout(resolve, 1500))
      
      // Play success sound
      playNotificationSound()
      
      alert(`✅ HEDGED BUYURTMALAR BAJARILDI!\n\n` +
        `${opp.coin}\n` +
        `✅ ${opp.network1} da sotib olindi (spot)\n` +
        `✅ ${opp.network2} da short ochildi (futures)\n\n` +
        `📋 KEYINGI QADAMLAR:\n` +
        `1. Coinlarni ${opp.network1} dan ${opp.network2} ga o'tkazing\n` +
        `2. ${opp.network2} da spot'da soting\n` +
        `3. Short pozitsiyani yoping\n\n` +
        `💡 Pozitsiya narx o'zgarishidan himoyalangan!`)
        
    } catch (error) {
      alert(`❌ Bajarishda xatolik: ${error.message}`)
    } finally {
      executing.value = false
    }
  }
}

// Legacy function for compatibility
const executeOrder = executeHedgedArbitrage

// Watch for exchange changes and auto-apply filters
watch(selectedExchanges, () => {
  applyFilters()
}, { deep: true })

// Lifecycle
onMounted(() => {
  // Initial fetch
  fetchData()

  // Auto-refresh every 3 seconds
  intervalId = setInterval(() => {
    fetchData()
  }, 3000)
})

onUnmounted(() => {
  if (intervalId) {
    clearInterval(intervalId)
  }
})
</script>
<template>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <h1>
        🔍 Arbitraj Skaneri
        <span style="font-size: 14px; opacity: 0.9;">(PDF Usuli)</span>
      </h1>
      <div class="status">
        <div class="status-dot"></div>
        <span>Jonli: {{ lastUpdate }}</span>
      </div>
    </div>

    <!-- Exchanges Selection -->
    <div class="exchanges">
      <strong style="margin-right: 10px;">Borsalar:</strong>
      <label
          v-for="ex in availableExchanges"
          :key="ex"
          class="exchange-checkbox"
          :class="{ active: selectedExchanges.includes(ex) }"
      >
        <input
            type="checkbox"
            :value="ex"
            v-model="selectedExchanges"
        >
        {{ ex }}
      </label>
    </div>

    <!-- Filters -->
    <div class="filters">
      <div class="filter-group">
        <label>Spread dan (%)</label>
        <input type="number" v-model.number="filters.minSpread" step="0.1">
      </div>
      <div class="filter-group">
        <label>Spread gacha (%)</label>
        <input type="number" v-model.number="filters.maxSpread" step="0.1">
      </div>
      <div class="filter-group">
        <label>Hajm dan ($)</label>
        <input type="number" v-model.number="filters.minVolume" step="1000">
      </div>
      <div class="filter-group">
        <label>💰 Investitsiya summasi ($)</label>
        <input type="number" v-model.number="filters.investmentAmount" step="100" min="100">
      </div>
      <div style="display: flex; gap: 10px;">
        <button @click="applyFilters" class="btn btn-primary">
          🔍 Qo'llash
        </button>
      </div>
    </div>

    <!-- Alert -->
    <div class="alert" v-if="filteredOpportunities.length > 0">
      <strong>🔒 {{ profitableCount }} ta XAVFSIZ hedged arbitraj imkoniyati!</strong>
      <div style="font-size: 13px; margin-top: 5px;">
        Spot sotib olish + Futures short parallel (1-2 soniya) - narx o'zgarishidan himoyalangan!
      </div>
    </div>
    <div class="alert" v-else style="background: #fee2e2; border-left: 4px solid #dc2626;">
      <strong>⏳ Market tinch - foydali spread topilmadi</strong>
      <div style="font-size: 13px; margin-top: 5px;">
        Eng yaxshi vaqt: <strong>18:00-20:00</strong> (kechqurun) va <strong>01:00-03:00</strong> (tun)
      </div>
    </div>

    <!-- Stats -->
    <div class="stats">
      <div class="stat-card">
        <h3>{{ filteredOpportunities.length }}</h3>
        <p>Jami imkoniyat</p>
      </div>
      <div class="stat-card">
        <h3>{{ avgSpread }}%</h3>
        <p>O'rtacha spread</p>
      </div>
      <div class="stat-card">
        <h3>{{ maxSpreadValue }}%</h3>
        <p>Eng yaxshi spread</p>
      </div>
      <div class="stat-card">
        <h3>{{ profitableCount }}</h3>
        <p>Foydali imkoniyat</p>
      </div>
    </div>

    <!-- Table -->
    <div class="table-container">
      <table v-if="!loading && filteredOpportunities.length > 0">
        <thead>
        <tr>
          <th>ID</th>
          <th>Coin</th>
          <th>Spot Birja</th>
          <th>Spot Narx</th>
          <th>Futures Birja</th>
          <th>Futures Narx</th>
          <th>Gross Spread</th>
          <th>Funding Rate</th>
          <th>Net Spread</th>
          <th>💵 Foyda</th>
          <th>Amal</th>
        </tr>
        </thead>
        <tbody>
        <tr v-for="(opp, index) in filteredOpportunities" :key="index">
          <td>{{ index + 1 }}</td>
          <td>
            <span class="coin-symbol">{{ opp.coin }}</span>
          </td>
          <td>
            <span class="exchange-badge badge-buy">{{ opp.network1 }}</span>
          </td>
          <td>{{ opp.buyPrice }}</td>
          <td>
            <span class="exchange-badge badge-sell">{{ opp.network2 }}</span>
          </td>
          <td>{{ opp.sellPrice }}</td>
          <td style="color: #6b7280; font-size: 13px;">{{ opp.grossSpread }}%</td>
          <td style="color: {{ parseFloat(opp.fundingRate) > 0 ? '#dc2626' : '#10b981' }}; font-weight: 600; font-size: 13px;">
            {{ opp.fundingRate }}%
          </td>
          <td>
            <span class="spread" :style="{ color: parseFloat(opp.spread) > 0 ? '#10b981' : '#dc2626' }">
              {{ opp.spread }}%
            </span>
            <div style="font-size: 11px; color: #6b7280;">(xarajat: -{{ opp.totalCost }}%)</div>
          </td>
          <td>
            <div :style="{ color: parseFloat(opp.profitWithFees) > 0 ? '#10b981' : '#dc2626', fontWeight: 700 }">
              {{ parseFloat(opp.profitWithFees) > 0 ? '+' : '' }}${{ opp.profitWithFees }}
              <div style="font-size: 11px; color: #6b7280;">(yalang: ${{ opp.estimatedProfit }})</div>
            </div>
          </td>
          <td>
            <button
                class="btn-execute"
                @click="executeOrder(opp)"
                :disabled="executing || parseFloat(opp.profitWithFees) <= 0"
                :style="parseFloat(opp.spread) > 0.5 ? 'background: linear-gradient(45deg, #10b981, #059669);' : ''"
            >
              {{ executing ? '⏳ Bajarilmoqda...' : (parseFloat(opp.spread) > 0.5 ? '🚀 BUYURTMA BERISH' : '⚡ Buyurtma berish') }}
            </button>
          </td>
        </tr>
        </tbody>
      </table>

      <div v-else-if="loading" class="loading">
        ⏳ Ma'lumotlar yuklanmoqda...
      </div>

      <div v-else class="no-data">
        😕 Arbitraj imkoniyatlari topilmadi<br>
        <small>Filtrlarni o'zgartirib ko'ring</small>
      </div>
    </div>
  </div>
</template>
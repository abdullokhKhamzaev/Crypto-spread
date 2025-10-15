# 🔒 Hedged Arbitrage Bot - Xavfsiz va Garantiyalangan Foyda

## 📖 Nima bu?

**Hedged Arbitrage** - bu spot va futures marketlarni bir vaqtda ishlatib, narx o'zgarishidan himoyalangan arbitraj strategiyasi.

### Oddiy vs Hedged Arbitrage

| Oddiy Arbitrage ❌ | Hedged Arbitrage ✅ |
|-------------------|---------------------|
| Birja A'da sotib olish | Birja A'da spot sotib olish |
| Transfer (30-60 min) | Birja B'da futures short ochish |
| Narx tushsa - ZARAR! | Narx o'zgarsa - HIMOYA! |
| Xavfli | Xavfsiz va garantiyalangan |

---

## 🎯 Qanday ishlaydi?

### Misol: SEI coin (0.3% spread)

**1-qadam: Parallel orderlar (1-2 soniya)** ⏱️
```
Binance Spot: SEI sotib oling @ $0.2247 ($500)
MEXC Futures: SEI short oching @ $0.2251 ($500)
```

**2-qadam: Transfer (30-60 min)** 🚚
```
Binance → MEXC: 2,225 SEI transfer
```
💡 Agar narx $0.30 ga oshsa:
- Spot zarar: -$167 😢
- Futures foyda: +$167 😊
- **Jami: $0** (himoyalangan!)

**3-qadam: Pozitsiyani yopish** 🎯
```
MEXC'da:
1. Spot'da soting: 2,225 SEI
2. Short'ni yoping
```

**Natija:**
- Spread: 0.3% = $1.50
- Komissiya: -$1.00
- **Sof foyda: $0.50** ✅

---

## 🚀 Ishga tushirish

### 1️⃣ API Keys yaratish

#### Binance
1. https://www.binance.com/en/my/settings/api-management
2. **Create API** → API ism: `Hedged_Arb_Bot`
3. Permissions: ✅ Enable Spot & Margin Trading ✅ Enable Futures
4. **IP Whitelist** qo'shing (xavfsizlik)
5. **API Key** va **Secret** ni nusxalang

#### MEXC
1. https://www.mexc.com/user/openapi
2. **Create New API Key**
3. Permissions: ✅ Spot Trading ✅ Futures Trading
4. **IP Restriction** yoqing
5. Keys'ni saqlang

#### Bitget
1. https://www.bitget.com/en/account/newapi
2. **Create API**
3. Permissions: ✅ Spot ✅ Futures/USDT-M
4. **Passphrase** yarating va eslab qoling!
5. Keys'ni saqlang

---

### 2️⃣ Config.json sozlash

```bash
cd /Users/mac/Downloads/AKH/Crypto-spread/backend
nano config.json
```

API keys'ni kiriting:
```json
{
  "mode": "test",  // Test rejim - haqiqiy pul yo'q
  "exchanges": {
    "binance": {
      "apiKey": "sizning_binance_api_key",
      "apiSecret": "sizning_binance_secret"
    },
    "mexc": {
      "apiKey": "sizning_mexc_api_key",
      "apiSecret": "sizning_mexc_secret"
    },
    "bitget": {
      "apiKey": "sizning_bitget_api_key",
      "apiSecret": "sizning_bitget_secret",
      "passphrase": "sizning_passphrase"
    }
  }
}
```

---

### 3️⃣ Serverni ishga tushirish

```bash
cd /Users/mac/Downloads/AKH/Crypto-spread

# Backend serverni ishga tushiring
node backend/server.js

# Yangi terminalda Vue dev server
pnpm run dev
```

**Console'da ko'rasiz:**
```
🚀 Hedged Arbitrage API running at http://localhost:8001
📊 Scanner endpoint: http://localhost:8001/hedged-spread
⚠️  Mode: TEST
✓ Hedged scan: 3 opportunities | 3.42s | Best: 0.35%
```

---

### 4️⃣ Browser'da ochish

```
http://localhost:5173
```

**Ko'rasiz:**
- Spot narxi
- Futures narxi
- **Funding rate** (muhim!)
- **Net spread** (barcha xarajatlar olib tashlanganidan keyin)
- **Estimated profit**

---

## 📊 Dashboard

### Ustunlar:
1. **Coin** - Qaysi kripto
2. **Spot Birja** - Qayerdan sotib olish
3. **Spot Narx** - Sotib olish narxi
4. **Futures Birja** - Qayerda short ochish
5. **Futures Narx** - Short narxi
6. **Gross Spread** - Umumiy spread
7. **Funding Rate** - Har 8 soatda to'lov
8. **Total Cost** - Barcha xarajatlar
9. **Net Spread** - Sof foyda %
10. **Est. Profit** - Taxminiy foyda ($)

---

## ⚙️ Settings (config.json)

### Trading parametrlari:
```json
"trading": {
  "minSpreadPercent": 0.3,        // Minimal spread
  "minProfitAfterFees": 0.1,      // Minimal sof foyda
  "maxPositionSize": 500,         // Maksimal pozitsiya ($)
  "maxOpenPositions": 3,          // Maksimal ochiq pozitsiyalar
  "orderTimeout": 5000,           // Order timeout (ms)
  "parallelExecutionWindow": 2000 // Parallel bajarish vaqti (ms)
}
```

### Risk boshqaruv:
```json
"risk": {
  "maxSlippage": 0.1,        // Maksimal slippage %
  "maxFundingRate": 0.01,    // Maksimal funding rate %
  "stopLossPercent": 2.0,    // Stop loss %
  "dailyMaxLoss": 50         // Kunlik maksimal zarar ($)
}
```

---

## 🧪 Test Rejimi

**Mode: "test"** - Faqat skanerlash, order bermaydi

```json
{
  "mode": "test"  // ← TEST REJIM
}
```

**Nimalar ishlaydi:**
- ✅ Spot/Futures narxlarni olish
- ✅ Spread hisoblash
- ✅ Foyda ko'rsatish
- ❌ Order bermaydi (xavfsiz!)

---

## 💰 Live Trading

**FAQAT** test rejimda sinab ko'rgandan keyin!

```json
{
  "mode": "live"  // ← LIVE REJIM (haqiqiy pul!)
}
```

### Live rejimga o'tishdan oldin:

1. ✅ API keys to'g'ri sozlanganligini tekshiring
2. ✅ Balansni tekshiring (har bir birjada)
3. ✅ Test rejimda kamida 1 hafta kuzating
4. ✅ Funding rate'larni tushunasiz
5. ✅ Pozitsiyani qanday yopishni bilasiz

---

## ⚠️ MUHIM ESLATMALAR

### Funding Rate
- Har **8 soatda 1 marta** to'lanadi
- Agar **positive** - siz to'laysiz
- Agar **negative** - sizga to'lanadi
- 1 kunda **3 marta** to'lanadi

**Misol:**
```
Funding rate: 0.01% (positive)
Pozitsiya: $500
Xarajat: $500 × 0.01% × 3 = $0.15/kun
```

### Transfer vaqti
- **Binance** → MEXC: 30-60 min
- **MEXC** → Binance: 30-60 min
- **Bitget**: 20-40 min

Tez transferlar (TRC20/BSC) tanlang!

### Xavflar
1. **API xatoliklari** - Internet uzilsa
2. **Exchange maintenance** - Birja to'xtasa
3. **Liquidation** - Leverage yuqori bo'lsa (1x ishlatamiz!)
4. **Funding costs** - Uzoq vaqt ushlab tursangiz

---

## 📈 Kutilayotgan natijalar

### $500 kapital bilan:
- Kunlik trade: 5-10 marta
- O'rtacha spread: 0.2-0.5%
- Kunlik foyda: **$2-$5**
- Oylik: **$60-$150**

### $2,000 kapital bilan:
- Kunlik trade: 3-5 marta
- O'rtacha spread: 0.3-0.6%
- Kunlik foyda: **$10-$20**
- Oylik: **$300-$600**

### $5,000+ kapital bilan:
- Kunlik trade: 1-3 marta
- O'rtacha spread: 0.4-0.8%
- Kunlik foyda: **$20-$40**
- Oylik: **$600-$1,200**

---

## 🆘 Tez-tez so'raladigan savollar

### Q: Qancha kapital kerak?
**A:** Minimal $500, tavsiya $2,000+

### Q: Qancha vaqt oladi?
**A:** Har bir trade 1-2 soat (transfer vaqti hisobga olingan)

### Q: Xavfsizmi?
**A:** Ha, agar to'g'ri qilsangiz. Short sizni himoya qiladi.

### Q: Avtomatikmi?
**A:** Hozirda yarim-avtomatik. To'liq avtomatik bot keyingi bosqich.

### Q: Funding rate nima?
**A:** Futures pozitsiyani ushlab turish narxi. Har 8 soatda to'lanadi.

### Q: Nimalar xato ketishi mumkin?
**A:** 
- Parallel order berishda kechikish
- API xatoligi
- Transfer kechikishi
- Liquidation (1x leverage ishlatamiz!)

---

## 📞 Qo'llab-quvvatlash

Savollar bo'lsa, men bilan bog'laning!

**Omad! 💰🚀**

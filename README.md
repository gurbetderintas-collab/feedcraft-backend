# FeedCraft Backend v2

Meta Katalog için şablon tabanlı dinamik görsel üretici.

## Nasıl Çalışır?

Ekarga XML Feed → POST /render-feed (şablon + XML) → Her ürün için /render-img URL'si → Meta PNG çeker → 1080x1080 dinamik görsel

## Railway Deploy (5 dakika)

1. github.com → New Repository → feedcraft-backend → Create
2. ZIP'i açıp dosyaları GitHub'a yükleyin
3. railway.app → New Project → Deploy from GitHub
4. Settings → Domains → Generate Domain
5. Variables → BASE_URL = https://sizin-adresiniz.railway.app

## Endpoints

POST /render          → Tek ürün PNG testi
GET  /render-img      → Meta'nın çektiği PNG endpoint
POST /render-feed     → XML + şablon → Meta XML (dinamik görsellerle)
GET  /proxy           → CORS bypass

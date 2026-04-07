const express  = require('express');
const cors     = require('cors');
const axios    = require('axios');
const crypto   = require('crypto');
const NodeCache = require('node-cache');

const app   = express();
const cache = new NodeCache({ stdTTL: 3600 });
const PORT  = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));

/* ── XML Parser ── */
function extractTag(block, tag) {
  const pats = [
    new RegExp(`<g:${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/g:${tag}>`, 'i'),
    new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'),
    new RegExp(`<g:${tag}>([^<]*)<\\/g:${tag}>`, 'i'),
    new RegExp(`<${tag}>([^<]*)<\\/${tag}>`, 'i'),
  ];
  for (const re of pats) {
    const m = block.match(re);
    if (m && m[1].trim()) return m[1].trim();
  }
  return '';
}

function parseXML(xmlStr) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xmlStr)) !== null) {
    const b = m[1];
    const priceRaw = extractTag(b, 'price') || '0';
    const fiyat = parseFloat(priceRaw.replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
    items.push({
      id:           extractTag(b, 'id')          || String(items.length + 1),
      title:        extractTag(b, 'title')        || '',
      price:        priceRaw,
      fiyat,
      brand:        extractTag(b, 'brand')        || '',
      image_link:   extractTag(b, 'image_link')   || '',
      link:         extractTag(b, 'link')          || '',
      availability: extractTag(b, 'availability') || 'in stock',
      condition:    extractTag(b, 'condition')     || 'new',
    });
  }
  return items;
}

function calcInstallment(price, count = 3) {
  const num = parseFloat(String(price || 0).replace(/[^0-9.,]/g, '').replace(',', '.'));
  if (!num) return '';
  return Math.round(num / count).toLocaleString('tr-TR') + ' TL x ' + count + ' Taksit';
}

const esc = s => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ── GET / ── */
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'FeedCraft Backend v3',
    endpoints: {
      'POST /render-feed': 'XML + şablon → Meta XML (dinamik görsellerle)',
      'GET  /render-img':  'PNG görsel üret',
      'GET  /proxy':       'XML CORS proxy',
    },
  });
});

/* ── POST /render-feed ── */
app.post('/render-feed', async (req, res) => {
  try {
    const { xmlUrl, xmlContent, cfg = {} } = req.body;
    let xmlStr = xmlContent;
    if (!xmlStr && xmlUrl) {
      const k = 'xml_' + xmlUrl;
      xmlStr = cache.get(k);
      if (!xmlStr) {
        const r = await axios.get(xmlUrl, { timeout: 12000, headers: { 'User-Agent': 'FeedCraft/1.0' } });
        xmlStr = r.data;
        cache.set(k, xmlStr);
      }
    }
    if (!xmlStr) return res.status(400).json({ error: 'xmlUrl veya xmlContent gerekli' });

    const products = parseXML(xmlStr);
    if (!products.length) return res.status(400).json({ error: 'Ürün bulunamadı' });

    const BASE = process.env.BASE_URL || `https://${req.headers.host}`;

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>${esc(cfg.brand || 'FeedCraft')} Meta Katalog</title>
<link>${BASE}</link>
<description>FeedCraft dinamik görsel katalogu</description>
`;
    products.forEach(p => {
      const taksit = calcInstallment(p.price, cfg.taksitAdet || 3);
      // Görsel: şablon varsa dinamik, yoksa orijinal
      const imageUrl = p.image_link;
      xml += `  <item>
    <g:id>${esc(p.id)}</g:id>
    <g:title>${esc(p.title)}</g:title>
    <g:description>${esc(p.title + (taksit ? ' — ' + taksit : ''))}</g:description>
    <g:price>${p.fiyat.toFixed(2)} TRY</g:price>
    <g:availability>${esc(p.availability)}</g:availability>
    <g:condition>${esc(p.condition)}</g:condition>
    <g:brand>${esc(p.brand || cfg.brand || '')}</g:brand>
    <g:image_link>${esc(imageUrl)}</g:image_link>
    <g:link>${esc(p.link)}</g:link>
  </item>\n`;
    });
    xml += `</channel>\n</rss>`;
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /render-img ── */
app.get('/render-img', async (req, res) => {
  try {
    const { url, price, badge, badgeColor, brand } = req.query;
    if (!url) return res.status(400).send('url gerekli');

    // canvas modülü opsiyonel — yoksa orijinal görsele yönlendir
    let canvas;
    try { canvas = require('canvas'); } catch(e) {
      return res.redirect(url);
    }

    const { createCanvas, loadImage } = canvas;
    const cvs = createCanvas(1080, 1080);
    const ctx = cvs.getContext('2d');

    // Arka plan
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, 1080, 1080);

    // Ürün görseli
    try {
      const imgResp = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
      const img = await loadImage(Buffer.from(imgResp.data));
      const ratio = Math.min(1080 / img.width, 1080 / img.height);
      const w = img.width * ratio, h = img.height * ratio;
      ctx.drawImage(img, (1080 - w) / 2, (1080 - h) / 2, w, h);
    } catch(e) { console.warn('Görsel yüklenemedi:', e.message); }

    // Alt bant
    const grad = ctx.createLinearGradient(0, 820, 0, 1080);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 820, 1080, 260);

    // Fiyat
    if (price) {
      const num = parseFloat(price.replace(/[^0-9.,]/g,'').replace(',','.'));
      if (num) {
        ctx.font = 'bold 64px Arial';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(num.toLocaleString('tr-TR') + ' TL', 40, 980);
      }
    }

    // Rozet
    if (badge) {
      ctx.fillStyle = badgeColor || '#e53935';
      roundRect(ctx, 24, 24, 160, 54, 27);
      ctx.fill();
      ctx.font = 'bold 26px Arial';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(badge, 104, 58);
      ctx.textAlign = 'left';
    }

    // Marka
    if (brand) {
      ctx.font = 'bold 22px Arial';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.textAlign = 'right';
      ctx.fillText(brand, 1050, 50);
      ctx.textAlign = 'left';
    }

    const png = cvs.toBuffer('image/png');
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch (err) {
    console.error(err.message);
    if (req.query.url) return res.redirect(req.query.url);
    res.status(500).send('Hata');
  }
});

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);
  ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);
  ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

/* ── GET /proxy ── */
app.get('/proxy', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url gerekli' });
    const k = 'px_' + url;
    let content = cache.get(k);
    if (!content) {
      const r = await axios.get(url, { timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0 FeedCraft/1.0' } });
      content = r.data;
      cache.set(k, content);
    }
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.send(content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`FeedCraft v3 çalışıyor → port ${PORT}`);
});

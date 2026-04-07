const express  = require('express');
const cors     = require('cors');
const axios    = require('axios');
const crypto   = require('crypto');
const NodeCache = require('node-cache');
const { renderTemplate } = require('./templateRenderer');

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
    status: 'ok', service: 'FeedCraft Backend v2',
    endpoints: {
      'POST /render':       'Şablon + ürün → PNG',
      'GET  /render-img':   'URL param ile PNG (Meta buradan çeker)',
      'POST /render-feed':  'XML + şablon → Meta XML (dinamik görsellerle)',
      'GET  /proxy':        'XML CORS proxy',
    },
  });
});

/* ── POST /render — Tek PNG ── */
app.post('/render', async (req, res) => {
  try {
    const { template, product } = req.body;
    if (!template || !product) return res.status(400).json({ error: 'template ve product gerekli' });
    const key = 'r_' + crypto.createHash('md5').update(JSON.stringify({ template, product })).digest('hex');
    let png = cache.get(key);
    if (!png) { png = await renderTemplate(template, product); cache.set(key, png); }
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /render-img — Meta buradan PNG çeker ── */
app.get('/render-img', async (req, res) => {
  try {
    const { tpl, prd } = req.query;
    if (!tpl || !prd) return res.status(400).send('tpl ve prd gerekli');
    const key = 'ri_' + crypto.createHash('md5').update(tpl + prd).digest('hex');
    let png = cache.get(key);
    if (!png) {
      const template = JSON.parse(decodeURIComponent(tpl));
      const product  = JSON.parse(decodeURIComponent(prd));
      png = await renderTemplate(template, product);
      cache.set(key, png);
    }
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch (err) {
    console.error(err.message);
    try {
      const prd = JSON.parse(decodeURIComponent(req.query.prd || '{}'));
      if (prd.image_link) return res.redirect(prd.image_link);
    } catch {}
    res.status(500).send('Görsel üretilemedi');
  }
});

/* ── POST /render-feed — XML + şablon → Meta XML ── */
app.post('/render-feed', async (req, res) => {
  try {
    const { xmlUrl, xmlContent, template, cfg = {} } = req.body;
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

    const BASE = process.env.BASE_URL || `http://localhost:${PORT}`;
    const tplEncoded = encodeURIComponent(JSON.stringify(template || {}));

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>${esc(cfg.brand || 'FeedCraft')} Meta Katalog</title>
<link>${BASE}</link>
<description>FeedCraft dinamik görsel katalogu</description>
`;
    products.forEach(p => {
      const prdEncoded = encodeURIComponent(JSON.stringify(p));
      const imageUrl   = `${BASE}/render-img?tpl=${tplEncoded}&prd=${prdEncoded}`;
      const taksit     = calcInstallment(p.price, cfg.taksitAdet || 3);
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

/* ── GET /proxy — CORS bypass ── */
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

/* ── GET /image — Basit overlay (eski uyumluluk) ── */
app.get('/image', async (req, res) => {
  const { url, price, badge, badgeColor, priceColor, brand } = req.query;
  if (!url) return res.status(400).send('url gerekli');
  const template = {
    elements: [
      { type:'shape', x:0, y:880, w:1080, h:200, bg:'#000000', bgOpacity:0.55, radius:0, fontSize:0, color:'transparent', fontWeight:'400', textAlign:'left' },
      ...(price ? [{ type:'text', text: parseFloat(price).toLocaleString('tr-TR') + ' TL', x:30, y:900, w:700, h:80, fontSize:56, fontWeight:'700', color: priceColor||'#ffffff', bg:'transparent', bgOpacity:0, radius:0, textAlign:'left' }] : []),
      ...(badge ? [{ type:'text', text: badge, x:24, y:24, w:150, h:52, fontSize:22, fontWeight:'700', color:'#ffffff', bg: badgeColor||'#e53935', bgOpacity:1, radius:26, textAlign:'center' }] : []),
      ...(brand ? [{ type:'text', text: brand, x:840, y:24, w:220, h:40, fontSize:18, fontWeight:'600', color:'#ffffff', bg:'#00000066', bgOpacity:1, radius:6, textAlign:'center' }] : []),
    ],
  };
  try {
    const png = await renderTemplate(template, { image_link: url, price });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch {
    res.redirect(url);
  }
});

app.listen(PORT, () => console.log(`FeedCraft v2 → http://localhost:${PORT}`));

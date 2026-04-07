const express  = require('express');
const cors     = require('cors');
const axios    = require('axios');
const NodeCache = require('node-cache');

const app   = express();
const cache = new NodeCache({ stdTTL: 3600 });
const PORT  = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));

function extractTag(block, tag) {
  const pats = [
    new RegExp('<g:' + tag + '><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/g:' + tag + '>', 'i'),
    new RegExp('<' + tag + '><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/' + tag + '>', 'i'),
    new RegExp('<g:' + tag + '>([^<]*)<\\/g:' + tag + '>', 'i'),
    new RegExp('<' + tag + '>([^<]*)<\\/' + tag + '>', 'i'),
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

function calcInstallment(price, count) {
  count = count || 3;
  const num = parseFloat(String(price || 0).replace(/[^0-9.,]/g, '').replace(',', '.'));
  if (!num) return '';
  return Math.round(num / count).toLocaleString('tr-TR') + ' TL x ' + count + ' Taksit';
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

app.get('/', function(req, res) {
  res.json({ status: 'ok', service: 'FeedCraft Backend v3' });
});

app.post('/render-feed', async function(req, res) {
  try {
    const { xmlUrl, xmlContent, cfg } = req.body;
    const options = cfg || {};
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
    if (!products.length) return res.status(400).json({ error: 'Urun bulunamadi' });
    const BASE = process.env.BASE_URL || ('https://' + req.headers.host);
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n<channel>\n';
    xml += '<title>' + esc(options.brand || 'FeedCraft') + ' Meta Katalog</title>\n';
    xml += '<link>' + BASE + '</link>\n';
    products.forEach(function(p) {
      const taksit = calcInstallment(p.price, options.taksitAdet);
      const badge = options.badge || '';
      const badgeColor = options.badgeColor || '%23e53935';
      const brand = options.brand || '';
      const imageUrl = BASE + '/render-img?url=' + encodeURIComponent(p.image_link) +
        '&price=' + p.fiyat +
        '&badge=' + encodeURIComponent(badge) +
        '&badgeColor=' + encodeURIComponent(badgeColor) +
        '&brand=' + encodeURIComponent(brand);
      xml += '  <item>\n';
      xml += '    <g:id>' + esc(p.id) + '</g:id>\n';
      xml += '    <g:title>' + esc(p.title) + '</g:title>\n';
      xml += '    <g:description>' + esc(p.title + (taksit ? ' - ' + taksit : '')) + '</g:description>\n';
      xml += '    <g:price>' + p.fiyat.toFixed(2) + ' TRY</g:price>\n';
      xml += '    <g:availability>' + esc(p.availability) + '</g:availability>\n';
      xml += '    <g:condition>' + esc(p.condition) + '</g:condition>\n';
      xml += '    <g:brand>' + esc(p.brand || brand) + '</g:brand>\n';
      xml += '    <g:image_link>' + esc(imageUrl) + '</g:image_link>\n';
      xml += '    <g:link>' + esc(p.link) + '</g:link>\n';
      xml += '  </item>\n';
    });
    xml += '</channel>\n</rss>';
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/render-img', async function(req, res) {
  try {
    var url = req.query.url;
    var price = req.query.price;
    var badge = req.query.badge ? decodeURIComponent(req.query.badge) : '';
    var badgeColor = req.query.badgeColor ? decodeURIComponent(req.query.badgeColor) : '#e53935';
    var brand = req.query.brand ? decodeURIComponent(req.query.brand) : '';

    if (!url) return res.status(400).send('url gerekli');

    var canvasLib;
    try { canvasLib = require('canvas'); } catch(e) { return res.redirect(url); }

    var createCanvas = canvasLib.createCanvas;
    var loadImage = canvasLib.loadImage;
    var cvs = createCanvas(1080, 1080);
    var ctx = cvs.getContext('2d');

    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, 1080, 1080);

    try {
      var imgResp = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000, headers: { 'User-Agent': 'FeedCraft/1.0' } });
      var img = await loadImage(Buffer.from(imgResp.data));
      var ratio = Math.min(1080 / img.width, 1080 / img.height);
      var w = img.width * ratio;
      var h = img.height * ratio;
      ctx.drawImage(img, (1080 - w) / 2, (1080 - h) / 2, w, h);
    } catch(e) { console.warn('Gorsel yuklenemedi:', e.message); }

    // Alt gradient
    var grad = ctx.createLinearGradient(0, 820, 0, 1080);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 820, 1080, 260);

    // Fiyat
    if (price) {
      var num = parseFloat(String(price).replace(/[^0-9.,]/g,'').replace(',','.'));
      if (num) {
        ctx.font = 'bold 68px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(num.toLocaleString('tr-TR') + ' TL', 40, 970);
      }
    }

    // Rozet
    if (badge) {
      ctx.fillStyle = badgeColor;
      ctx.beginPath();
      ctx.roundRect(20, 20, 180, 56, 28);
      ctx.fill();
      ctx.font = 'bold 27px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badge, 110, 48);
    }

    // Marka
    if (brand) {
      ctx.font = 'bold 24px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(brand, 1055, 26);
    }

    var png = cvs.toBuffer('image/png');
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    return res.send(png);
  } catch (err) {
    console.error(err.message);
    if (req.query.url) return res.redirect(req.query.url);
    res.status(500).send('Hata');
  }
});

app.get('/proxy', async function(req, res) {
  try {
    var url = req.query.url;
    if (!url) return res.status(400).json({ error: 'url gerekli' });
    var k = 'px_' + url;
    var content = cache.get(k);
    if (!content) {
      var r = await axios.get(url, { timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0 FeedCraft/1.0' } });
      content = r.data;
      cache.set(k, content);
    }
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.send(content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', function() {
  console.log('FeedCraft v3 calisiyor port ' + PORT);
});

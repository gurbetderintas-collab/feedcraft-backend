/**
 * FeedCraft Template Renderer
 * Şablon JSON + ürün verisi → 1080×1080 PNG
 */
const { createCanvas, loadImage } = require('canvas');
const axios = require('axios');

const CANVAS_SIZE = 1080;

/**
 * Ana render fonksiyonu
 * @param {Object} template  - { elements: [...] }
 * @param {Object} product   - { title, price, brand, installment, image_link, ... }
 * @returns {Buffer}         - PNG buffer
 */
async function renderTemplate(template, product) {
  const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const ctx = canvas.getContext('2d');

  // 1. Beyaz arka plan
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // 2. Ürün görseli (arka plan — tam kare, cover)
  if (product.image_link) {
    try {
      const imgBuf = await fetchImage(product.image_link);
      const img = await loadImage(imgBuf);
      drawImageCover(ctx, img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
    } catch (e) {
      console.warn('Arka plan görseli yüklenemedi:', e.message);
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    }
  }

  // 3. Şablon elementlerini çiz (sırayla — alttan üste)
  const elements = template.elements || [];
  for (const el of elements) {
    await drawElement(ctx, el, product);
  }

  return canvas.toBuffer('image/png');
}

/**
 * Tek bir elementi çiz
 */
async function drawElement(ctx, el, product) {
  const { x, y, w, h, type, radius = 0 } = el;
  if (!w || !h) return;

  ctx.save();

  // Clip: köşe yuvarlama
  if (radius > 0) {
    roundedClip(ctx, x, y, w, h, radius);
  }

  // Arka plan
  const bgOpacity = el.bgOpacity ?? 0;
  if (el.bg && el.bg !== 'transparent' && bgOpacity > 0) {
    ctx.fillStyle = hexToRgba(el.bg, bgOpacity);
    if (radius > 0) {
      roundedRect(ctx, x, y, w, h, radius);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, w, h);
    }
  }

  // İçerik
  if (type === 'shape') {
    // Sadece arka plan, içerik yok
  } else if (type === 'image') {
    // Şablon içinde ayrı bir görsel (opsiyonel)
    const src = el.feedKey === 'image_link' ? product.image_link : el.customUrl;
    if (src) {
      try {
        const buf = await fetchImage(src);
        const img = await loadImage(buf);
        const fit = el.fit || 'contain';
        if (fit === 'cover') drawImageCover(ctx, img, x, y, w, h);
        else drawImageContain(ctx, img, x, y, w, h);
      } catch {}
    }
  } else {
    // Text / badge
    const text = resolveText(el, product);
    if (text) drawText(ctx, text, el);
  }

  ctx.restore();
}

/**
 * Feed verisiyle metni çöz
 */
function resolveText(el, product) {
  if (!el.feedKey) return el.text || '';
  const map = {
    price:        formatPrice(product.price || product.fiyat),
    title:        product.title || product.isim || '',
    brand:        product.brand || '',
    installment:  product.installment || calcInstallment(product.price || product.fiyat, el.installmentCount || 3),
    availability: product.availability || 'Stokta',
  };
  return map[el.feedKey] || el.text || '';
}

/**
 * Metin çiz
 */
function drawText(ctx, text, el) {
  const {
    x, y, w, h,
    fontSize = 28,
    fontWeight = '600',
    color = '#ffffff',
    textAlign = 'left',
    shadowOn = false,
  } = el;

  ctx.font = `${fontWeight} ${fontSize}px "Arial", sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = textAlign;
  ctx.textBaseline = 'middle';

  if (shadowOn) {
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
  }

  // X pozisyonu hizalamaya göre
  let tx;
  if (textAlign === 'center') tx = x + w / 2;
  else if (textAlign === 'right') tx = x + w - 16;
  else tx = x + 16;

  // Uzun metni sar
  const maxW = w - 32;
  const lines = wrapText(ctx, text, maxW);
  const lineH = fontSize * 1.25;
  const totalH = lines.length * lineH;
  let ty = y + (h - totalH) / 2 + lineH / 2;

  lines.forEach(line => {
    ctx.fillText(line, tx, ty, maxW);
    ty += lineH;
  });

  // Shadow sıfırla
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

/**
 * Metin sarma
 */
function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? current + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Görsel — cover modu (kanvası doldurur, kırpar)
 */
function drawImageCover(ctx, img, x, y, w, h) {
  const ratio = Math.max(w / img.width, h / img.height);
  const sw = img.width * ratio;
  const sh = img.height * ratio;
  const sx = x + (w - sw) / 2;
  const sy = y + (h - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh);
}

/**
 * Görsel — contain modu (sığdırır, boşluk bırakır)
 */
function drawImageContain(ctx, img, x, y, w, h) {
  const ratio = Math.min(w / img.width, h / img.height);
  const sw = img.width * ratio;
  const sh = img.height * ratio;
  const sx = x + (w - sw) / 2;
  const sy = y + (h - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh);
}

/**
 * Yuvarlak köşeli clip path
 */
function roundedClip(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.clip();
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Görsel URL'den buffer çek (cache ile)
 */
const imgCache = new Map();
async function fetchImage(url) {
  if (imgCache.has(url)) return imgCache.get(url);
  const resp = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 10000,
    headers: { 'User-Agent': 'FeedCraft/1.0' },
  });
  const buf = Buffer.from(resp.data);
  imgCache.set(url, buf);
  // Cache 500 görsel ile sınırla
  if (imgCache.size > 500) {
    const firstKey = imgCache.keys().next().value;
    imgCache.delete(firstKey);
  }
  return buf;
}

/**
 * Fiyat formatla: "2199.00 TRY" → "2.199 TL"
 */
function formatPrice(raw) {
  if (!raw) return '';
  const num = parseFloat(String(raw).replace(/[^0-9.,]/g, '').replace(',', '.'));
  if (isNaN(num)) return String(raw);
  return num.toLocaleString('tr-TR') + ' TL';
}

/**
 * Taksit hesapla
 */
function calcInstallment(price, count = 3) {
  const num = parseFloat(String(price || 0).replace(/[^0-9.,]/g, '').replace(',', '.'));
  if (!num || !count) return '';
  return Math.round(num / count).toLocaleString('tr-TR') + ' TL x ' + count + ' Taksit';
}

/**
 * Hex + opacity → rgba
 */
function hexToRgba(hex, alpha = 1) {
  if (!hex || hex === 'transparent') return `rgba(0,0,0,${alpha})`;
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

module.exports = { renderTemplate };

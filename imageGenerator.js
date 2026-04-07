const { createCanvas, loadImage } = require('canvas');

/**
 * Ürün görseli üzerine fiyat, rozet, marka etiketi işler
 * @param {Buffer} imgBuffer - Orijinal görsel buffer
 * @param {Object} opts - { price, badge, badgeColor, priceColor, brand }
 * @returns {Buffer} PNG buffer
 */
async function generateProductImage(imgBuffer, opts = {}) {
  const { price, badge, badgeColor, priceColor, brand } = opts;

  // Canvas boyutu: Meta için ideal kare
  const SIZE = 800;
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');

  // 1. Arka plan (beyaz)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // 2. Ürün görselini yükle ve ortala
  try {
    const img = await loadImage(imgBuffer);
    const ratio = Math.min(SIZE / img.width, SIZE / img.height);
    const w = img.width * ratio;
    const h = img.height * ratio;
    const x = (SIZE - w) / 2;
    const y = (SIZE - h) / 2;
    ctx.drawImage(img, x, y, w, h);
  } catch (e) {
    // Görsel yüklenemezse düz arka plan
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, SIZE, SIZE);
  }

  // 3. Alt gradient şerit (fiyat alanı)
  if (price) {
    const gradient = ctx.createLinearGradient(0, SIZE - 160, 0, SIZE);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, SIZE - 160, SIZE, 160);

    // Fiyat metni
    const priceText = parseFloat(price) > 0
      ? parseFloat(price).toLocaleString('tr-TR') + ' TL'
      : '';

    if (priceText) {
      ctx.font = 'bold 52px Arial, sans-serif';
      ctx.fillStyle = priceColor || '#ffffff';
      ctx.textAlign = 'left';
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 6;
      ctx.fillText(priceText, 24, SIZE - 30);
      ctx.shadowBlur = 0;
    }
  }

  // 4. Rozet (sol üst)
  if (badge && badge.trim()) {
    const badgePad = 14;
    ctx.font = 'bold 26px Arial, sans-serif';
    const badgeW = ctx.measureText(badge).width + badgePad * 2;
    const badgeH = 44;
    const badgeX = 16;
    const badgeY = 16;
    const badgeR = 22;

    // Rozet arka planı (pill)
    ctx.fillStyle = badgeColor || '#e53935';
    roundRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeR);
    ctx.fill();

    // Rozet metni
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px Arial, sans-serif';
    ctx.fillText(badge, badgeX + badgeW / 2, badgeY + badgeH / 2 + 8);
  }

  // 5. Marka logosu (sağ alt)
  if (brand && brand.trim()) {
    ctx.font = 'bold 20px Arial, sans-serif';
    const brandW = ctx.measureText(brand).width + 20;
    const brandH = 32;
    const brandX = SIZE - brandW - 12;
    const brandY = SIZE - brandH - 12;

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    roundRect(ctx, brandX, brandY, brandW, brandH, 6);
    ctx.fill();

    ctx.fillStyle = '#333333';
    ctx.textAlign = 'center';
    ctx.font = 'bold 16px Arial, sans-serif';
    ctx.fillText(brand, brandX + brandW / 2, brandY + brandH / 2 + 6);
  }

  return canvas.toBuffer('image/png');
}

// Yuvarlak köşeli dikdörtgen yardımcı
function roundRect(ctx, x, y, w, h, r) {
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

module.exports = { generateProductImage };

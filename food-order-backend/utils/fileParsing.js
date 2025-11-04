// utils/fileParsing.js
function normalizeName(s) {
  return String(s).replace(/[-_]+/g, ' ').trim();
}

// Lấy cả ký tự + số trước dấu chấm làm mã (VD: C1.DIMSUM -> code = 'c1')
function parseFromImageFile(imageName) {
  const base = String(imageName || '').replace(/\.(jpg|jpeg|png|webp)$/i, '');
  const m = base.match(/^([A-Za-z]\d+)\.(.+)$/);
  if (m) {
    return {
      productCode: m[1].toLowerCase(), // 'C1' -> 'c1'
      name: normalizeName(m[2]),
    };
  }
  return {
    productCode: '',
    name: normalizeName(base),
  };
}

module.exports = { parseFromImageFile, normalizeName };

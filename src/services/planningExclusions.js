const EXCLUDED_REFERENCE_CODES = new Set([
  '0114',
  '0138',
  '0139',
  '0140',
  '0171',
  '0172',
]);

const EXCLUDED_REFERENCE_LABELS = new Set([
  'PT 99 0114',
  'PT 99 0138',
  'PT 99 0139',
  'PT 99 0140',
  'PT 99 0171',
  'PT 99 0172',
]);

const EXCLUDED_PRODUCT_TERMS = [
  'FARDA BABYLOOK',
  'EXTENSOR 30MM',
  'EXTENSOR 40MM',
  'EXTENSOR 60MM',
  'ADESIVO DE VITRINE',
  'URNA LIEBE PAPELAO',
];

function normalizePlanningText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function normalizeReferenceToken(value) {
  return normalizePlanningText(value).replace(/\s+/g, '');
}

function isExcludedReference(value) {
  const raw = normalizePlanningText(value);
  if (!raw) return false;

  if (EXCLUDED_REFERENCE_LABELS.has(raw)) return true;

  const compact = normalizeReferenceToken(value);
  if (!compact) return false;

  if (/^\d{4}$/.test(compact) && EXCLUDED_REFERENCE_CODES.has(compact)) return true;

  if (compact.startsWith('PT99')) {
    const suffix = compact.slice(-4);
    if (EXCLUDED_REFERENCE_CODES.has(suffix)) return true;
  }

  return false;
}

function isExcludedProductText(value) {
  const raw = normalizePlanningText(value);
  if (!raw) return false;
  return EXCLUDED_PRODUCT_TERMS.some((term) => raw.includes(term));
}

function isExcludedPlanningItem(item = {}) {
  return (
    isExcludedReference(item.referencia) ||
    isExcludedProductText(item.produto) ||
    isExcludedProductText(item.apresentacao)
  );
}

module.exports = {
  EXCLUDED_REFERENCE_CODES,
  EXCLUDED_REFERENCE_LABELS,
  EXCLUDED_PRODUCT_TERMS,
  normalizePlanningText,
  isExcludedReference,
  isExcludedProductText,
  isExcludedPlanningItem,
};

function normalizePath(urlPath) {
  const raw = String(urlPath || '').trim();
  if (!raw) return '';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function getBaseUrl(req) {
  const explicit = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (explicit) return explicit;

  const protoHeader = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = protoHeader || req.protocol || 'http';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) return '';
  return `${proto}://${host}`.replace(/\/$/, '');
}

function toAbsoluteAssetUrl(req, urlPath) {
  const path = normalizePath(urlPath);
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  const base = getBaseUrl(req);
  if (!base) return path;
  return `${base}${path}`;
}

module.exports = { toAbsoluteAssetUrl };

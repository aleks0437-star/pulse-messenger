export function getAllowedOrigins(raw = process.env.WEB_ORIGINS) {
  const origins = (raw ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (!origins.length) {
    if (process.env.NODE_ENV === 'production') throw new Error('WEB_ORIGINS is required in production');
    return ['http://localhost:3000'];
  }
  if (origins.includes('*')) throw new Error('Wildcard CORS origin is not allowed');
  for (const origin of origins) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error(`Invalid CORS origin: ${origin}`);
  }
  return origins;
}

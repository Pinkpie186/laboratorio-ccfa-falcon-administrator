import path from 'node:path';

const bool = (value, fallback = false) => value == null ? fallback : /^(1|true|yes)$/i.test(value);
export const config = Object.freeze({
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  appOrigin: process.env.APP_ORIGIN || 'http://localhost:8080',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://falcon_app:change-me@localhost:5432/falcon_admin',
  databaseSsl: bool(process.env.DATABASE_SSL),
  cookieName: process.env.SESSION_COOKIE_NAME || 'falcon_session',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 12),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),
  trustProxy: bool(process.env.TRUST_PROXY),
  storageDriver: process.env.STORAGE_DRIVER || 'local',
  localStoragePath: path.resolve(process.cwd(), process.env.LOCAL_STORAGE_PATH || './storage/private'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024),
  docBatchSize: Number(process.env.DOC_SYNC_BATCH_SIZE || 25),
  docRetryLimit: Number(process.env.DOC_SYNC_RETRY_LIMIT || 3),
  docsRoot: path.resolve(process.env.DOCS_ROOT || path.join(process.cwd(),'..')),
  publicSyncDelayMs: Math.max(250,Number(process.env.PUBLIC_SYNC_DELAY_MS || 1000)),
  publicSyncEnabled: bool(process.env.PUBLIC_SYNC_ENABLED,true)
});

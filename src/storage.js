import fs from 'node:fs/promises';
import path from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from './config.js';

const s3 = config.storageDriver === 's3' ? new S3Client({
  endpoint: process.env.S3_ENDPOINT || undefined, region: process.env.S3_REGION || 'us-east-1',
  forcePathStyle: /^(1|true)$/i.test(process.env.S3_FORCE_PATH_STYLE || ''),
  credentials: process.env.S3_ACCESS_KEY_ID ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } : undefined
}) : null;
const validKey = key => {
  const segments=String(key||'').split('/');
  if(!/^[a-zA-Z0-9/_.-]+$/.test(key)||segments.some(segment=>!segment||segment==='.'||segment==='..'))throw new Error('Chave de armazenamento inválida.');
  return key;
};
export async function putPrivate(key, buffer, contentType = 'application/octet-stream') {
  validKey(key);
  if (s3) return s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: buffer, ContentType: contentType, ServerSideEncryption: 'AES256' }));
  const target = path.resolve(config.localStoragePath, key);
  if (!target.startsWith(config.localStoragePath + path.sep)) throw new Error('Destino fora do armazenamento privado.');
  await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, buffer, { mode: 0o600 }); return { key };
}
export async function getPrivate(key) {
  validKey(key);
  if (s3) { const result = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key })); return Buffer.from(await result.Body.transformToByteArray()); }
  return fs.readFile(path.resolve(config.localStoragePath, key));
}


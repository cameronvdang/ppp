/**
 * Client-side crypto for exports and zero-knowledge backup.
 * AES-256-GCM with a PBKDF2-SHA256-derived key (600k iterations).
 * TODO(v1.1): swap KDF to Argon2id via WASM once we take that dependency —
 * PBKDF2 at this iteration count is the strongest WebCrypto-native option.
 */

const ITERATIONS = 600_000
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789' // no ambiguous chars

export interface Envelope {
  v: 1
  kdf: 'PBKDF2-SHA256'
  iter: number
  salt: string // base64
  iv: string // base64
  data: string // base64 ciphertext
}

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

/** Wallet-style recovery code, shown once: 6 groups of 4. ~30 bits/group. */
export function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
  const groups: string[] = []
  for (let i = 0; i < 24; i += 4) groups.push(chars.slice(i, i + 4).join(''))
  return groups.join('-')
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

async function deriveKey(secret: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptJSON(payload: unknown, secret: string): Promise<Envelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(secret, salt, ITERATIONS)
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plaintext)
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: ITERATIONS, salt: toB64(salt), iv: toB64(iv), data: toB64(data) }
}

export async function decryptJSON<T>(env: Envelope, secret: string): Promise<T> {
  const key = await deriveKey(secret, fromB64(env.salt), env.iter)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(env.iv) as BufferSource },
    key,
    fromB64(env.data) as BufferSource,
  )
  return JSON.parse(new TextDecoder().decode(plain)) as T
}

/** Opaque storage ID derived from the recovery code — the server sees only this. */
export async function blobIdFromCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`ppp-blob-id:${normalizeRecoveryCode(code)}`),
  )
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40)
}

export async function hashPin(pin: string, saltB64: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`ppp-pin:${saltB64}:${pin}`),
  )
  return toB64(digest)
}

export function newSalt(): string {
  return toB64(crypto.getRandomValues(new Uint8Array(16)))
}

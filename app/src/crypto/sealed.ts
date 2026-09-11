export interface SealedBlob {
  v: 1
  iv: string
  data: string
}

function toBase64(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

export function generateSealingKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  ) as Promise<CryptoKey>
}

export async function seal(key: CryptoKey, payload: unknown): Promise<SealedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext as BufferSource,
  )
  return { v: 1, iv: toBase64(iv), data: toBase64(encrypted) }
}

export async function open<T>(key: CryptoKey, blob: SealedBlob): Promise<T> {
  if (blob.v !== 1) throw new Error('Unsupported sealed blob version.')
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(blob.iv) as BufferSource },
    key,
    fromBase64(blob.data) as BufferSource,
  )
  return JSON.parse(new TextDecoder().decode(plaintext)) as T
}

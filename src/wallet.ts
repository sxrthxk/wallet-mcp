import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { generatePrivateKey, privateKeyToAccount, type Address } from 'viem/accounts'

// Wallet storage directory
const WALLET_DIR = join(homedir(), '.wallet-mcp', 'keystore')

// Encrypted keystore format
interface EncryptedKeystore {
  version: 1
  address: Address
  crypto: {
    cipher: 'aes-256-gcm'
    ciphertext: string
    iv: string
    authTag: string
    kdf: 'scrypt'
    kdfparams: {
      n: number
      r: number
      p: number
      salt: string
    }
  }
  createdAt: string
}

// Ensure wallet directory exists
function ensureWalletDir(): void {
  if (!existsSync(WALLET_DIR)) {
    mkdirSync(WALLET_DIR, { recursive: true })
  }
}

// Derive encryption key from password using scrypt
function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32, { N: 2 ** 14, r: 8, p: 1 })
}

// Encrypt private key
function encryptPrivateKey(privateKey: string, password: string): EncryptedKeystore {
  const account = privateKeyToAccount(privateKey as `0x${string}`)
  const salt = randomBytes(32)
  const key = deriveKey(password, salt)
  const iv = randomBytes(16)
  
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(privateKey, 'utf8'),
    cipher.final()
  ])
  const authTag = cipher.getAuthTag()

  return {
    version: 1,
    address: account.address,
    crypto: {
      cipher: 'aes-256-gcm',
      ciphertext: ciphertext.toString('hex'),
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      kdf: 'scrypt',
      kdfparams: {
        n: 2 ** 14,
        r: 8,
        p: 1,
        salt: salt.toString('hex'),
      },
    },
    createdAt: new Date().toISOString(),
  }
}

// Decrypt private key
function decryptPrivateKey(keystore: EncryptedKeystore, password: string): string {
  const salt = Buffer.from(keystore.crypto.kdfparams.salt, 'hex')
  const key = deriveKey(password, salt)
  const iv = Buffer.from(keystore.crypto.iv, 'hex')
  const authTag = Buffer.from(keystore.crypto.authTag, 'hex')
  const ciphertext = Buffer.from(keystore.crypto.ciphertext, 'hex')

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ])

  return decrypted.toString('utf8')
}

// Create a new wallet
export async function createWallet(password: string): Promise<{ address: Address; message: string }> {
  ensureWalletDir()
  
  const privateKey = generatePrivateKey()
  const keystore = encryptPrivateKey(privateKey, password)
  
  const filename = `${keystore.address.toLowerCase()}.json`
  const filepath = join(WALLET_DIR, filename)
  
  writeFileSync(filepath, JSON.stringify(keystore, null, 2))
  
  return {
    address: keystore.address,
    message: `Wallet created and encrypted. Stored at: ${filepath}`,
  }
}

// Import existing private key
export async function importWallet(privateKey: string, password: string): Promise<{ address: Address; message: string }> {
  ensureWalletDir()
  
  // Normalize private key format
  const normalizedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`
  
  // Validate by trying to create an account
  const account = privateKeyToAccount(normalizedKey as `0x${string}`)
  
  const keystore = encryptPrivateKey(normalizedKey, password)
  
  const filename = `${keystore.address.toLowerCase()}.json`
  const filepath = join(WALLET_DIR, filename)
  
  writeFileSync(filepath, JSON.stringify(keystore, null, 2))
  
  return {
    address: account.address,
    message: `Wallet imported and encrypted. Stored at: ${filepath}`,
  }
}

// List all wallets
export async function listWallets(): Promise<{ wallets: Address[] }> {
  ensureWalletDir()
  
  const files = readdirSync(WALLET_DIR).filter(f => f.endsWith('.json'))
  const wallets: Address[] = []
  
  for (const file of files) {
    try {
      const filepath = join(WALLET_DIR, file)
      const keystore: EncryptedKeystore = JSON.parse(readFileSync(filepath, 'utf8'))
      wallets.push(keystore.address)
    } catch {
      // Skip invalid files
    }
  }
  
  return { wallets }
}

// Get wallet keystore
export function getKeystore(address: Address): EncryptedKeystore | null {
  ensureWalletDir()
  
  const filename = `${address.toLowerCase()}.json`
  const filepath = join(WALLET_DIR, filename)
  
  if (!existsSync(filepath)) {
    return null
  }
  
  return JSON.parse(readFileSync(filepath, 'utf8'))
}

// Unlock wallet and get private key (for signing)
export function unlockWallet(address: Address, password: string): `0x${string}` {
  const keystore = getKeystore(address)
  
  if (!keystore) {
    throw new Error(`Wallet not found: ${address}`)
  }
  
  const privateKey = decryptPrivateKey(keystore, password)
  return privateKey as `0x${string}`
}

// Get wallet directory path
export function getWalletDir(): string {
  return WALLET_DIR
}

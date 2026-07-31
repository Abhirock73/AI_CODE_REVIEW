const crypto = require('crypto');

// Secret key for encryption (32 bytes). Defaults to a fallback key for development if env is not set.
const SECRET_KEY = process.env.ENCRYPTION_KEY || 'ai-code-review-secret-32-char!';
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * Ensures the encryption key is exactly 32 bytes buffer.
 */
function getKeyBuffer() {
  return crypto.createHash('sha256').update(String(SECRET_KEY)).digest();
}

/**
 * Encrypts plain text string using AES-256-CBC.
 * @param {string} text 
 * @returns {string} Encrypted string in iv:ciphertext format
 */
function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKeyBuffer(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts encrypted string (iv:ciphertext) back to plain text.
 * @param {string} encryptedText 
 * @returns {string} Decrypted plain text
 */
function decrypt(encryptedText) {
  if (!encryptedText) return null;
  const parts = encryptedText.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted text format');
  }
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv(ALGORITHM, getKeyBuffer(), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = {
  encrypt,
  decrypt,
};

'use strict';

// Pure-Node TOTP/HOTP implementation — zero external TOTP dependencies.
// Implements RFC 4226 (HOTP) + RFC 6238 (TOTP) using Node's built-in crypto module.
// Replaces speakeasy (unmaintained since 2017) and removes the need for otplib.
//
// Algorithm summary:
//   HOTP(secret, counter) = Truncate( HMAC-SHA1(secret, counter) ) mod 10^6
//   TOTP(secret)          = HOTP(secret, floor(unix_time / period))

const crypto = require('crypto');
const QRCode  = require('qrcode');

// ── Base32 codec — RFC 4648 §6 (no padding required) ─────────────────────────

const B32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const B32_MAP   = new Uint8Array(256).fill(0xff);
for (let i = 0; i < B32_CHARS.length; i++) B32_MAP[B32_CHARS.charCodeAt(i)] = i;

function base32Decode(input) {
  const s = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  const out = Buffer.alloc(Math.floor(s.length * 5 / 8));
  let bits = 0, val = 0, idx = 0;
  for (let i = 0; i < s.length; i++) {
    const v = B32_MAP[s.charCodeAt(i)];
    if (v === 0xff) throw new Error(`Invalid base32 character: '${s[i]}'`);
    val = (val << 5) | v; bits += 5;
    if (bits >= 8) { out[idx++] = (val >>> (bits - 8)) & 0xff; bits -= 8; }
  }
  return out;
}

function base32Encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const byte of buf) {
    val = (val << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32_CHARS[(val >>> (bits - 5)) & 0x1f]; bits -= 5; }
  }
  if (bits > 0) out += B32_CHARS[(val << (5 - bits)) & 0x1f];
  return out;
}

// ── HOTP — RFC 4226 ──────────────────────────────────────────────────────────

function hotp(secretBase32, counter) {
  const key = base32Decode(secretBase32);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));           // counter as 8-byte big-endian
  const mac    = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;      // dynamic truncation offset
  const code   = (mac.readUInt32BE(offset) & 0x7fff_ffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

// ── TOTP — RFC 6238 ──────────────────────────────────────────────────────────

function totpGenerate(secretBase32, period = 30) {
  return hotp(secretBase32, Math.floor(Date.now() / 1000 / period));
}

function totpVerify(token, secretBase32, { window = 1, period = 30 } = {}) {
  const counter = Math.floor(Date.now() / 1000 / period);
  const t = String(token).replace(/\s/g, '');
  for (let d = -window; d <= window; d++) {
    if (hotp(secretBase32, counter + d) === t) return true;
  }
  return false;
}

// ── TwoFAManager ─────────────────────────────────────────────────────────────

class TwoFAManager {
  /**
   * Generate a new TOTP secret for an account.
   * Returns { secret: base32String, otpauth: string }.
   * The otpauth URI is compatible with Google Authenticator, Authy, and KeePassXC.
   */
  static generateSecret(label = 'VauID', issuer = 'VauID') {
    // 20 random bytes = 160-bit key (NIST SP 800-132 recommended minimum for HMAC-SHA1)
    const secret  = base32Encode(crypto.randomBytes(20));
    const otpauth = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}`
      + `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    return { secret, otpauth };
  }

  /**
   * Generate a QR code data URL for the given OTPAuth URL.
   */
  static async generateQR(otpauth) {
    return QRCode.toDataURL(otpauth, {
      width: 200,
      margin: 2,
      color: { dark: '#ffffff', light: '#0d0f14' },
    });
  }

  /**
   * Verify a TOTP token against a base32 secret.
   * Allows ±1 time-step (±30 s) for clock drift — same as speakeasy window: 1.
   * Returns true/false.
   */
  static verifyToken(secret, token) {
    try {
      return totpVerify(token, secret, { window: 1 });
    } catch {
      // Invalid base32, wrong length, etc. — treat as verification failure
      return false;
    }
  }

  /**
   * Generate the current TOTP value for display in the vault.
   * Returns { token: string, remaining: number } where remaining is seconds until rotation.
   */
  static generateTOTP(secret) {
    try {
      const token     = totpGenerate(secret);
      const epoch     = Math.floor(Date.now() / 1000);
      const remaining = 30 - (epoch % 30);
      return { token, remaining };
    } catch {
      // Malformed secret — return a safe placeholder so the UI never crashes
      return { token: '------', remaining: 0 };
    }
  }

  /**
   * Parse an OTPAuth URL into its components.
   * Works with URLs from generateSecret(), KeePassXC, Google Authenticator exports, etc.
   */
  static parseOTPAuth(url) {
    try {
      const u      = new URL(url);
      const secret = u.searchParams.get('secret');
      const issuer = u.searchParams.get('issuer') || '';
      const label  = decodeURIComponent(u.pathname.slice(1)).replace(/^.*:/, '');
      return { secret, issuer, label };
    } catch {
      return null;
    }
  }
}

module.exports = TwoFAManager;

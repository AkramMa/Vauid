'use strict';

const https = require('https');
const CryptoEngine = require('./crypto');

class BreachChecker {
  /**
   * Check if a password has been breached using HIBP k-anonymity API
   * Never sends the full password — only first 5 chars of SHA1 hash
   */
  static async checkPassword(password) {
    const hash = CryptoEngine.sha1(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    const body = await this._request(`https://api.pwnedpasswords.com/range/${prefix}`);
    const lines = body.split('\n');

    for (const line of lines) {
      const [lineSuffix, count] = line.trim().split(':');
      if (lineSuffix && lineSuffix.toUpperCase() === suffix) {
        return { breached: true, count: parseInt(count, 10) };
      }
    }
    return { breached: false, count: 0 };
  }

  /**
   * Check if an email address has been found in known data breaches
   */
  /**
   * @param {string} email
   * @param {string} [apiKey]  HIBP API key — required for email checks
   */
  static async checkEmail(email, apiKey = '') {
    // Fail fast with a helpful message rather than always getting a 401
    if (!apiKey) {
      return {
        breached: null,
        error: 'API_KEY_REQUIRED',
        message: 'Email breach checks require a HaveIBeenPwned API key. Add it in Settings → Security Audit.',
      };
    }
    try {
      const encoded = encodeURIComponent(email);
      const body = await this._request(
        `https://haveibeenpwned.com/api/v3/breachedaccount/${encoded}?truncateResponse=false`,
        { 'hibp-api-key': apiKey, 'User-Agent': 'VauID-Password-Manager' }
      );
      const breaches = JSON.parse(body);
      return {
        breached: breaches.length > 0,
        count: breaches.length,
        breaches: breaches.map(b => ({
          name: b.Name,
          domain: b.Domain,
          date: b.BreachDate,
          description: b.Description,
          dataClasses: b.DataClasses,
        })),
      };
    } catch (err) {
      if (err.statusCode === 401) {
        return { breached: null, error: 'INVALID_API_KEY', message: 'HIBP API key is invalid or expired.' };
      }
      if (err.statusCode === 404) {
        return { breached: false, count: 0, breaches: [] };
      }
      if (err.statusCode === 429) {
        return { breached: null, error: 'RATE_LIMITED', message: 'Too many requests. Please wait before checking again.' };
      }
      return { breached: null, error: 'NETWORK_ERROR', message: err.message };
    }
  }

  static _request(url, headers = {}) {
    // [C-1] Cap response body at 2 MB to prevent OOM from a malicious/misconfigured proxy.
    const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
    return new Promise((resolve, reject) => {
      const opts = {
        headers: {
          'User-Agent': 'VauID-Password-Manager',
          ...headers,
        },
        timeout: 10000,
      };
      https.get(url, opts, (res) => {
        if (res.statusCode !== 200) {
          const err = new Error(`HTTP ${res.statusCode}`);
          err.statusCode = res.statusCode;
          return reject(err);
        }
        let data = '';
        let size = 0;
        res.on('data', chunk => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            res.destroy();
            return reject(new Error('RESPONSE_TOO_LARGE'));
          }
          data += chunk;
        });
        res.on('end', () => resolve(data));
      }).on('error', reject).on('timeout', () => reject(new Error('TIMEOUT')));
    });
  }
}

module.exports = BreachChecker;

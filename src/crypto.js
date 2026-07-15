'use strict';

const crypto = require('crypto');

// .vid file format constants
const MAGIC = Buffer.from('KBEK');
const VERSION = 2;
const SALT_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const PBKDF2_ITERATIONS = 600000;
const KEY_LEN = 32; // 256-bit

class CryptoEngine {
  /**
   * Derive a 256-bit key from password + salt using PBKDF2-SHA512
   */
  static deriveKey(password, salt) {
    return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LEN, 'sha512');
  }

  /**
   * Derive a key for PIN.
   * [H-1] Aligned to 600k iterations — consistent with vault key derivation and hashPassword.
   * Using fewer iterations (e.g. the old 100k) would make PIN-based secrets weaker.
   */
  static derivePinKey(pin, salt) {
    return crypto.pbkdf2Sync(pin, salt, 600000, KEY_LEN, 'sha512');
  }

  /**
   * Encrypt plaintext JSON payload → .vid binary Buffer
   */
  static encrypt(plaintextObj, password) {
    const salt = crypto.randomBytes(SALT_LEN);
    const iv = crypto.randomBytes(IV_LEN);
    const key = this.deriveKey(password, salt);

    const plaintext = Buffer.from(JSON.stringify(plaintextObj), 'utf8');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Zero out key in memory
    key.fill(0);

    // Build binary: MAGIC(4) | VERSION(2) | SALT(32) | IV(12) | TAG(16) | CIPHERTEXT(N)
    const header = Buffer.alloc(4 + 2 + SALT_LEN + IV_LEN + TAG_LEN);
    MAGIC.copy(header, 0);
    header.writeUInt16BE(VERSION, 4);
    salt.copy(header, 6);
    iv.copy(header, 6 + SALT_LEN);
    tag.copy(header, 6 + SALT_LEN + IV_LEN);

    return Buffer.concat([header, encrypted]);
  }

  /**
   * Decrypt .vid binary Buffer → parsed object
   */
  static decrypt(buffer, password) {
    // Validate magic
    if (!buffer.slice(0, 4).equals(MAGIC)) {
      throw new Error('INVALID_FILE: Not a .vid vault file');
    }

    const version = buffer.readUInt16BE(4);
    if (version !== VERSION && version !== 1) {
      throw new Error('INVALID_VERSION: Unsupported vault version');
    }

    let offset = 6;
    const salt = buffer.slice(offset, offset + SALT_LEN); offset += SALT_LEN;
    const iv = buffer.slice(offset, offset + IV_LEN); offset += IV_LEN;
    const tag = buffer.slice(offset, offset + TAG_LEN); offset += TAG_LEN;
    const ciphertext = buffer.slice(offset);

    const key = this.deriveKey(password, salt);

    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      key.fill(0);
      return JSON.parse(decrypted.toString('utf8'));
    } catch (err) {
      key.fill(0);
      throw new Error('WRONG_PASSWORD');
    }
  }

  /**
   * Encrypt a single value (for sync file, pin hash, etc.)
   */
  static encryptString(str, password) {
    const buf = this.encrypt({ v: str }, password);
    return buf.toString('base64');
  }

  static decryptString(b64, password) {
    const buf = Buffer.from(b64, 'base64');
    const obj = this.decrypt(buf, password);
    return obj.v;
  }

  /**
   * SHA-1 hash for HIBP k-anonymity
   */
  static sha1(str) {
    return crypto.createHash('sha1').update(str).digest('hex').toUpperCase();
  }

  /**
   * Hash password/PIN for storage verification.
   * Uses 600k PBKDF2-SHA512 iterations (same as vault key derivation).
   * Legacy 10k SHA256 hashes are detected and treated as mismatches,
   * prompting the user to re-set their PIN to upgrade security.
   */
  static hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 600000, 32, 'sha512').toString('hex');
  }


  /**
   * Generate cryptographically secure random bytes
   */
  static randomBytes(n) {
    return crypto.randomBytes(n);
  }

  /**
   * Generate a strong password
   */
  static generatePassword(options = {}) {
    const {
      uppercase = true,
      lowercase = true,
      numbers = true,
      symbols = true,
      ambiguous = false,
      words = false,
      wordCount = 4,
    } = options;

    // Defensively clamp length to a sane range regardless of what the caller
    // passes — an invalid/NaN/out-of-range length previously could reach
    // crypto.randomBytes() with a bad size and throw synchronously.
    let length = parseInt(options.length, 10);
    if (!Number.isFinite(length)) length = 20;
    length = Math.max(4, Math.min(128, length));

    if (words) {
      let count = parseInt(wordCount, 10);
      if (!Number.isFinite(count)) count = 4;
      count = Math.max(2, Math.min(12, count));
      return this._generatePassphrase(count);
    }

    let charset = '';
    if (uppercase) charset += ambiguous ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    if (lowercase) charset += ambiguous ? 'abcdefghijklmnopqrstuvwxyz' : 'abcdefghjkmnpqrstuvwxyz';
    if (numbers) charset += ambiguous ? '0123456789' : '23456789';
    if (symbols) charset += '!@#$%^&*()-_=+[]{}|;:,.<>?';
    if (!charset) charset = 'abcdefghijklmnopqrstuvwxyz';

    // Rejection sampling to eliminate modulo bias.
    // We discard any byte value >= floor(256/charsetLen)*charsetLen.
    const charsetLen = charset.length;
    const maxValid   = Math.floor(256 / charsetLen) * charsetLen;
    const chars      = [];
    // Request extra bytes to account for rejections (2x is conservative)
    let pool = crypto.randomBytes(length * 4);
    let poolIdx = 0;
    while (chars.length < length) {
      if (poolIdx >= pool.length) {
        pool = crypto.randomBytes(length * 4);
        poolIdx = 0;
      }
      const b = pool[poolIdx++];
      if (b < maxValid) chars.push(charset[b % charsetLen]);
    }
    return chars.join('');
  }

  static _generatePassphrase(count) {
    // [S-1] Custom wordlist — ~530 words (not 1296; comment previously overstated the count).
    // A 4-word passphrase from this list gives ~38 bits of entropy (log2(530^4)).
    const words = [
      'abacus','abbey','abide','able','abort','absent','absorb','accent','accept','access',
      'account','aching','acorn','acoustic','acrobat','action','active','actor','actual','adapt',
      'adept','admire','adopt','adult','advice','aerial','afford','afraid','agenda','agree',
      'album','alert','algae','alien','alley','almond','also','alter','ample','amuse',
      'anchor','angel','ankle','annoy','answer','apple','aptly','arch','area','arise',
      'armor','array','ash','aside','aspen','attend','auction','aunt','awake','awning',
      'axle','azure','badge','banjo','barrel','basket','battle','beacon','beagle','beaker',
      'beast','bedtime','behave','belief','below','bench','bicycle','bishop','blame','blanket',
      'bleach','bless','blimp','blossom','blunder','boast','boil','boldly','bonfire','bottle',
      'bounce','bracket','bravely','break','breeze','brick','brightly','brooch','broth','bubble',
      'bucket','budget','bulge','bumper','bundle','butter','button','cactus','camel','candle',
      'canyon','captain','castle','cedar','cellar','cement','chair','chalk','chance','charm',
      'cheap','chess','chilly','china','chisel','chorus','civic','claim','classic','clean',
      'clever','cloak','clock','cloud','clover','cobalt','cobweb','coconut','comet','comfort',
      'comic','concern','confide','contest','corner','cougar','courage','cozy','crab','craft',
      'crash','crawl','crazy','crew','crisp','cross','crown','crush','custom','cyclist',
      'dagger','danger','daring','dazzle','debut','decent','decide','deeply','defend','dense',
      'depot','desert','desire','detail','diamond','dinner','direct','discord','discuss','display',
      'distant','dizzy','doctor','dolphin','domain','double','dragonfly','dream','drift','drive',
      'droplet','durable','dusk','eagle','earth','echo','edge','eldest','eleven','embark',
      'empire','enchant','endless','engage','enjoy','enrich','enter','entire','epoch','equip',
      'escape','evade','event','exact','excite','exhaust','expand','expert','fable','falcon',
      'fancy','farmer','feast','feather','fence','ferret','fetch','fever','fiber','fierce',
      'finger','finish','flame','flash','flavor','fleet','flight','flint','float','flood',
      'flora','flower','focus','forest','formal','fossil','frame','fresh','fringe','frost',
      'frozen','fully','funnel','fuzzy','gadget','galaxy','garlic','gather','geyser','gift',
      'giraffe','glacier','glide','glitter','globe','glow','goblin','golden','gorge','gossip',
      'grace','grain','granite','grape','grasp','gravel','green','grill','groan','grove',
      'growl','guard','guide','guild','gust','habit','hammer','harbor','hazel','heart',
      'height','helmet','herald','heron','hidden','hike','hinge','hollow','honey','honor',
      'horizon','horse','humble','humid','hustle','hyena','impact','imply','index','inform',
      'inner','insist','invent','iron','island','ivy','jacket','jaguar','jasmine','javelin',
      'jewel','jolly','joyful','jungle','kelp','kernel','kettle','kindle','kitten','kneel',
      'knight','labor','lagoon','lantern','laser','launch','lava','lavish','learn','lemon',
      'leopard','level','light','limit','linden','lively','lizard','local','lodge','lotus',
      'lower','loyal','lucid','lumber','lunar','magnet','maple','marble','margin','meadow',
      'merit','meteor','midnight','mirror','misty','modest','molten','monarch','monkey','monster',
      'moon','mossy','mountain','murmur','muscle','mystic','native','nature','navy','nearby',
      'nectar','needle','nimble','noble','north','notice','nourish','novel','nymph','oasis',
      'ocean','olive','onward','orange','orbit','order','organ','origin','osprey','otter',
      'outrun','oyster','paddle','panda','panel','parrot','pasture','pattern','pause','pebble',
      'pendant','penguin','pepper','perfect','peril','petal','pillar','planet','plasma','pledge',
      'plum','pocket','polar','ponder','poppy','portal','powder','prairie','precise','prism',
      'prompt','protect','proud','prowl','pulse','purple','puzzle','quartz','quest','quick',
      'quiet','radiant','radius','rainbow','rapid','raven','reach','realm','rebel','recall',
      'reflect','refuse','regal','relax','relic','remote','renew','rescue','reveal','rhythm',
      'ridge','river','roam','rocky','rough','round','royal','rumble','rustic','sacred',
      'salmon','sapphire','secret','serene','settle','shadow','shark','shelter','shield','signal',
      'silver','simple','sleek','slender','slowly','smart','smooth','softly','solar','solemn',
      'solid','solve','sonic','south','spark','spirit','splash','stable','starlit','steady',
      'steel','stone','storm','strong','summit','sunlit','swift','symbol','talent','tangle',
      'talon','temple','tender','thicket','thistle','thunder','tiger','timber','topaz','torch',
      'trace','travel','treasure','trial','tribe','triumph','trophy','trunk','trust','tunnel',
      'turquoise','ultra','unique','uplift','valley','valor','vapor','vault','velvet','vibrant',
      'vivid','voyage','walnut','wander','warmth','warrior','water','wealth','willow','wisdom',
      'wonder','worthy','yellow','zealous','zebra','zenith','zephyr',
    ];
    const selected = [];
    for (let i = 0; i < count; i++) {
      // crypto.randomInt handles unbiased rejection sampling internally for
      // any range size — the previous manual single-byte sampling assumed
      // words.length <= 256, which broke (infinite loop) once the wordlist
      // grew past 256 entries.
      selected.push(words[crypto.randomInt(words.length)]);
    }
    return selected.join('-');
  }

  /**
   * Measure password strength (0-100)
   */
  static passwordStrength(password) {
    if (!password) return { score: 0, label: 'None', color: '#555' };
    let score = 0;
    const len = password.length;
    score += Math.min(30, len * 2);
    if (/[A-Z]/.test(password)) score += 10;
    if (/[a-z]/.test(password)) score += 10;
    if (/[0-9]/.test(password)) score += 10;
    if (/[^A-Za-z0-9]/.test(password)) score += 15;
    if (len >= 16) score += 10;
    if (len >= 24) score += 10;
    // Penalize patterns
    if (/(.)\1{2,}/.test(password)) score -= 10;
    if (/^[a-z]+$/.test(password) || /^[0-9]+$/.test(password)) score -= 15;
    score = Math.max(0, Math.min(100, score));

    let label, color;
    if (score < 25) { label = 'Very Weak'; color = '#ef4444'; }
    else if (score < 50) { label = 'Weak'; color = '#f97316'; }
    else if (score < 75) { label = 'Good'; color = '#eab308'; }
    else if (score < 90) { label = 'Strong'; color = '#22c55e'; }
    else { label = 'Very Strong'; color = '#10b981'; }

    return { score, label, color };
  }
}

module.exports = CryptoEngine;

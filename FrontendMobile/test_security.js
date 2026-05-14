// test_security.js
// ------------------------------------------------------------
//  Dependencies: npm install node-fetch@2 argon2-browser node-forge
// ------------------------------------------------------------

const fetch = require('node-fetch');
const argon2 = require('argon2');
const forge = require('node-forge');

// ---------- Config ----------
const API = 'http://localhost:8080/api/v1';
const TEST_EMAIL = `test_${Date.now()}@example.com`;
const TEST_PASSWORD = 'StrongP@ssw0rd!';

// ---------- Helper: Argon2‑derived key ----------
async function deriveKey(password, saltStr) {
  const hash = await argon2.hash(password, {
    salt: Buffer.from(saltStr, 'utf8'),
    type: argon2.argon2id,
    hashLength: 32,
    memoryCost: 65536, // 64 MiB
    timeCost: 4,
    parallelism: 2,
    raw: true,
  });
  return new Uint8Array(hash);
}

// ---------- Helper: RSA key generation ----------
function generateRSAKeyPair() {
  return new Promise((resolve, reject) => {
    forge.pki.rsa.generateKeyPair(
      { bits: 2048, workers: -1 },
      (err, keypair) => {
        if (err) return reject(err);
        resolve({
          publicKey: forge.pki.publicKeyToPem(keypair.publicKey),
          privateKey: forge.pki.privateKeyToPem(keypair.privateKey),
        });
      }
    );
  });
}

// ---------- Helper: encrypt/decrypt bundle ----------
async function encryptBundle(keysObj, password, userId) {
  const derived = await deriveKey(password, userId);
  const derivedBuffer = forge.util.createBuffer(Buffer.from(derived));
  const json = JSON.stringify(keysObj);
  const iv = forge.random.getBytesSync(12);
  const cipher = forge.cipher.createCipher('AES-GCM', derivedBuffer);
  cipher.start({ iv });
  cipher.update(forge.util.createBuffer(json, 'utf8'));
  cipher.finish();
  return {
    iv: forge.util.encode64(iv),
    ciphertext: forge.util.encode64(cipher.output.getBytes()),
    tag: forge.util.encode64(cipher.mode.tag.getBytes()),
  };
}

async function decryptBundle(bundle, password, userId) {
  const derived = await deriveKey(password, userId);
  const derivedBuffer = forge.util.createBuffer(Buffer.from(derived));
  const { iv, ciphertext, tag } = bundle;
  const decipher = forge.cipher.createDecipher('AES-GCM', derivedBuffer);
  decipher.start({
    iv: forge.util.decode64(iv),
    tag: forge.util.createBuffer(forge.util.decode64(tag)),
  });
  decipher.update(forge.util.createBuffer(forge.util.decode64(ciphertext)));
  if (!decipher.finish()) {
    throw new Error('Bundle decryption failed');
  }
  return JSON.parse(forge.util.decodeUtf8(decipher.output.getBytes()));
}

// ---------- API calls ----------
async function register(email, password) {
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      username: email.split('@')[0],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Register error: ' + text);
  }
  return res.text();
}

async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email, password }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Login error: ' + text);
  }
  return res.json(); // contains accessToken & userId
}

async function getBundle(token) {
  const res = await fetch(`${API}/users/key-bundle`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Get bundle error');
  return res.text(); 
}

async function postBundle(token, bundle) {
  const res = await fetch(`${API}/users/key-bundle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ encryptedKeyBundle: JSON.stringify(bundle) }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Upload bundle failed: ' + text);
  }
}

// ---------- Test flow ----------
(async () => {
  console.log('🔧 Registering test user: ' + TEST_EMAIL);
  await register(TEST_EMAIL, TEST_PASSWORD);

  // ---------- First login – generate keys ----------
  console.log('🚀 First login (key generation)...');
  const first = await login(TEST_EMAIL, TEST_PASSWORD);
  const userId = first.userId;
  const token = first.accessToken;

  // generate RSA keys locally
  const rsaKeys = await generateRSAKeyPair();

  // encrypt + upload bundle
  const encryptedBundle = await encryptBundle(rsaKeys, TEST_PASSWORD, userId);
  await postBundle(token, encryptedBundle);
  console.log('✅ Bundle uploaded.');

  // ---------- Second login – fetch bundle ----------
  console.log('🔁 Second login (bundle fetch)...');
  const second = await login(TEST_EMAIL, TEST_PASSWORD);
  const token2 = second.accessToken;

  let fetched = await getBundle(token2);
  if (!fetched) throw new Error('Bundle not found on server');
  
  // If it's a string, parse it
  if (typeof fetched === 'string') {
    fetched = JSON.parse(fetched);
  }

  const decrypted = await decryptBundle(fetched, TEST_PASSWORD, userId);
  console.log('🔓 Bundle decrypted on client.');

  // Verify RSA keys are identical
  if (
    decrypted.publicKey !== rsaKeys.publicKey ||
    decrypted.privateKey !== rsaKeys.privateKey
  ) {
    throw new Error('Key mismatch – bundle corrupted');
  }
  console.log('🔐 RSA keys match – cross-device sync works!');

  // ---------- Optional: simulate message exchange ----------
  console.log('📨 Simulating message exchange...');
  const aesKey = forge.random.getBytesSync(32);
  const msg = 'Hello from test script!';
  const encryptedMsg = (function () {
    const iv = forge.random.getBytesSync(12);
    const cipher = forge.cipher.createCipher('AES-GCM', aesKey);
    cipher.start({ iv });
    cipher.update(forge.util.createBuffer(msg, 'utf8'));
    cipher.finish();
    return {
      iv: forge.util.encode64(iv),
      ciphertext: forge.util.encode64(cipher.output.getBytes()),
      tag: forge.util.encode64(cipher.mode.tag.getBytes()),
    };
  })();

  // Decrypt on the “other side”
  const decipher = forge.cipher.createDecipher('AES-GCM', aesKey);
  decipher.start({
    iv: forge.util.decode64(encryptedMsg.iv),
    tag: forge.util.createBuffer(forge.util.decode64(encryptedMsg.tag)),
  });
  decipher.update(
    forge.util.createBuffer(forge.util.decode64(encryptedMsg.ciphertext))
  );
  if (!decipher.finish())
    throw new Error('Message decryption failed (auth tag)');
  const recovered = forge.util.decodeUtf8(decipher.output.getBytes());

  if (recovered !== msg) throw new Error('Message mismatch');
  console.log('✅ Message encrypted/decrypted successfully.');

  console.log('🎉 All security checks passed! 🎉');
})().catch((e) => {
  console.error('❌ Test failed:', e);
  process.exit(1);
});

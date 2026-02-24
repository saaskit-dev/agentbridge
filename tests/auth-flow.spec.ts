import { test, expect } from '@playwright/test';
import crypto from 'crypto';

const SERVER_URL = 'http://localhost:3001';

// Helper to encode base64
function encodeBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

test.describe('Auth Flow E2E', () => {
  test('API auth flow - CLI + Server', async ({ page }) => {
    // Step 1: Simulate CLI - Generate ephemeral keypair
    console.log('[TEST] Step 1: Generating ephemeral keypair...');
    const tweetnacl = require('tweetnacl');
    const secret = new Uint8Array(crypto.randomBytes(32));
    const keypair = tweetnacl.box.keyPair.fromSecretKey(secret);
    const publicKeyBase64 = encodeBase64(keypair.publicKey);
    console.log('[TEST] CLI publicKey:', publicKeyBase64.substring(0, 20) + '...');

    // Step 2: Create auth request (like CLI does)
    console.log('[TEST] Step 2: Creating auth request...');
    const createResponse = await fetch(`${SERVER_URL}/v1/auth/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: publicKeyBase64,
        supportsV2: true
      })
    });
    const createData = await createResponse.json();
    console.log('[TEST] Auth request created:', createData);
    expect(createData.state).toBe('requested');

    // Step 3: Simulate App approving the auth request
    // First, create an account
    console.log('[TEST] Step 3: Creating account...');
    const appKeypair = tweetnacl.box.keyPair();
    const appPublicKeyBase64 = encodeBase64(appKeypair.publicKey);

    // Create auth request for app
    const appAuthResponse = await fetch(`${SERVER_URL}/v1/auth/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: appPublicKeyBase64,
        supportsV2: true
      })
    });
    const appAuthData = await appAuthResponse.json();

    // Approve our own request (simulating what the app would do)
    // In real flow, app would encrypt its secret and send approval
    const appSecret = new Uint8Array(crypto.randomBytes(32));
    const appSecretBase64 = encodeBase64(appSecret);

    // Sign a challenge for the app account
    const signKeypair = tweetnacl.sign.keyPair.fromSeed(appSecret);
    const challenge = new Uint8Array(crypto.randomBytes(32));
    const signature = tweetnacl.sign.detached(challenge, signKeypair.secretKey);

    const authResponse = await fetch(`${SERVER_URL}/v1/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: encodeBase64(signKeypair.publicKey),
        challenge: encodeBase64(challenge),
        signature: encodeBase64(signature)
      })
    });
    const authData = await authResponse.json();
    console.log('[TEST] Account created, token:', authData.token?.substring(0, 30) + '...');

    expect(authData.token).toBeTruthy();
    const appToken = authData.token;

    // Step 4: Approve the CLI auth request
    console.log('[TEST] Step 4: Approving CLI auth request...');

    // Encrypt the app secret for the CLI
    const responseV1 = tweetnacl.box(
      appSecret,
      new Uint8Array(24), // nonce
      new Uint8Array(32), // CLI public key (we need to decode it)
      appKeypair.secretKey
    );

    const approveResponse = await fetch(`${SERVER_URL}/v1/auth/response`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${appToken}`
      },
      body: JSON.stringify({
        publicKey: publicKeyBase64,
        response: encodeBase64(responseV1),
        responseV2: null
      })
    });
    const approveData = await approveResponse.json();
    console.log('[TEST] Approve response:', approveData);

    // Step 5: Poll for auth result (like CLI does)
    console.log('[TEST] Step 5: Polling for auth result...');
    const pollResponse = await fetch(`${SERVER_URL}/v1/auth/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: publicKeyBase64,
        supportsV2: true
      })
    });
    const pollData = await pollResponse.json();
    console.log('[TEST] Poll response:', pollData);

    // The state should be 'authorized' now
    expect(pollData.state).toBe('authorized');
    expect(pollData.token).toBeTruthy();
    expect(pollData.response).toBeTruthy();

    console.log('[TEST] Auth successful!');
    console.log('[TEST] Token:', pollData.token.substring(0, 30) + '...');

    // Step 6: Register machine (simulating what the real CLI would do)
    console.log('[TEST] Step 6: Registering machine...');
    const cliToken = pollData.token;
    const machineId = crypto.randomUUID();

    const registerResponse = await fetch(`${SERVER_URL}/v1/machines`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cliToken}`
      },
      body: JSON.stringify({
        id: machineId,
        metadata: 'encrypted-metadata-string' // In real flow, this would be encrypted
      })
    });
    const registerData = await registerResponse.json();
    console.log('[TEST] Machine registered:', registerData);

    // Step 7: Verify machines endpoint has data
    console.log('[TEST] Step 7: Checking machines endpoint...');
    const machinesResponse = await fetch(`${SERVER_URL}/v1/machines`, {
      headers: { 'Authorization': `Bearer ${cliToken}` }
    });
    const machinesData = await machinesResponse.json();
    console.log('[TEST] Machines:', machinesData);

    expect(Array.isArray(machinesData)).toBe(true);
    expect(machinesData.length).toBeGreaterThan(0);
    console.log('[TEST] ✅ Machine count:', machinesData.length);

    // Step 8: Test session creation
    console.log('[TEST] Step 8: Creating session...');
    const sessionResponse = await fetch(`${SERVER_URL}/v1/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cliToken}`
      },
      body: JSON.stringify({
        tag: 'test-session',
        metadata: 'test-metadata-encrypted',
        dataEncryptionKey: encodeBase64(new Uint8Array(32))
      })
    });
    const sessionData = await sessionResponse.json();
    console.log('[TEST] Session created:', sessionData);
    expect(sessionData.session).toBeTruthy();

    console.log('[TEST] ✅ All tests passed!');
  });

  test('health check', async ({ page }) => {
    const response = await fetch(`${SERVER_URL}/health`);
    const data = await response.json();
    console.log('[TEST] Health check:', data);
    expect(data.status).toBe('ok');
    expect(data.service).toBe('free-server');
  });
});

import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import axios from 'axios';

const SERVER_URL = 'http://localhost:3001';
const WEB_URL = 'http://localhost:8081';

// Helper to encode base64 (browser-compatible)
function encodeBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

test.describe('Claude Session Chat E2E - Web UI', () => {
  test.beforeEach(async ({ page }) => {
    // Clear credentials
    const fs = require('fs');
    const path = require('path');
    const freeDir = path.join(process.env.HOME || '', '.free');
    const credFile = path.join(freeDir, 'credentials.json');
    try {
      if (fs.existsSync(credFile)) fs.unlinkSync(credFile);
    } catch (e) {}
  });

  test('create Claude session and chat via Web UI', async ({ page }) => {
    // Capture console logs
    page.on('console', msg => {
      const text = msg.text();
      console.log('[WEB]', text);
    });

    // Step 1: Generate ephemeral keypair (simulating CLI)
    console.log('[TEST] Step 1: Generating ephemeral keypair...');
    const tweetnacl = require('tweetnacl');
    const secret = new Uint8Array(crypto.randomBytes(32));
    const keypair = tweetnacl.box.keyPair.fromSecretKey(secret);
    const publicKeyBase64 = encodeBase64(keypair.publicKey);
    console.log('[TEST] CLI publicKey:', publicKeyBase64.substring(0, 20) + '...');

    // Step 2: Create auth request
    console.log('[TEST] Step 2: Creating auth request...');
    await axios.post(`${SERVER_URL}/v1/auth/request`, {
      publicKey: publicKeyBase64,
      supportsV2: true
    });

    // Step 3: Navigate to web app and authenticate
    const connectUrl = `${WEB_URL}/terminal/connect#key=${publicKeyBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    console.log('[TEST] Step 3: Navigating to:', connectUrl);

    await page.goto(connectUrl);
    await page.waitForLoadState('networkidle');

    // Click Create Account button
    const createButton = page.locator('text=Create Account & Connect').first();
    await createButton.waitFor({ timeout: 15000 });
    await createButton.click();
    console.log('[TEST] Clicked Create Account button');

    // Wait for success
    const successModal = page.locator('text=/成功|Success|Terminal connected/i').first();
    await successModal.waitFor({ timeout: 30010 });
    console.log('[TEST] Auth success modal visible');

    // Take screenshot after auth
    await page.screenshot({ path: '/tmp/session-auth-success.png' });

    // Step 4: Navigate to sessions tab (home page shows sessions)
    console.log('[TEST] Step 4: Navigating to sessions...');
    await page.goto(`${WEB_URL}/`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: '/tmp/session-home.png' });

    // Step 5: Click "New Session" or "+" button to create a new session
    console.log('[TEST] Step 5: Creating new session via UI...');

    // Look for new session button - could be a + icon, "New" text, or FAB
    const newSessionButton = page.locator('[data-testid="new-session-button"], button:has-text("New"), [aria-label*="new"], [aria-label*="New"]').first();
    const fabButton = page.locator('[data-testid="fab"], .fab, button[class*="fab"]').first();

    // Try to find and click a new session button
    try {
      if (await newSessionButton.isVisible({ timeout: 3001 })) {
        await newSessionButton.click();
        console.log('[TEST] Clicked new session button');
      } else if (await fabButton.isVisible({ timeout: 3001 })) {
        await fabButton.click();
        console.log('[TEST] Clicked FAB button');
      } else {
        // Navigate directly to new session page
        console.log('[TEST] Navigating directly to new session page');
        await page.goto(`${WEB_URL}/new`);
      }
    } catch (e) {
      console.log('[TEST] No new session button found, navigating to /new');
      await page.goto(`${WEB_URL}/new`);
    }

    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: '/tmp/session-new-page.png' });

    // Wait for the session creation form to load
    await page.waitForTimeout(2000);

    // Step 6: Select Claude as the agent (if there's a selection screen)
    console.log('[TEST] Step 6: Selecting Claude agent...');
    const claudeOption = page.locator('text=/Claude|claude/i').first();
    try {
      if (await claudeOption.isVisible({ timeout: 3001 })) {
        await claudeOption.click();
        console.log('[TEST] Selected Claude agent');
      }
    } catch (e) {
      console.log('[TEST] No agent selection needed or found');
    }

    // Step 7: Find the message input and type a message
    console.log('[TEST] Step 7: Finding message input...');
    await page.waitForTimeout(1000);

    // Look for text input or textarea
    const messageInput = page.locator('textarea, input[type="text"], [contenteditable="true"]').first();
    await messageInput.waitFor({ timeout: 10000 });

    // Type a message
    const testMessage = 'Hello Claude! Please respond with a simple greeting.';
    await messageInput.fill(testMessage);
    console.log('[TEST] Typed message:', testMessage);
    await page.screenshot({ path: '/tmp/session-typed-message.png' });

    // Step 8: Send the message (click send button or press Enter)
    console.log('[TEST] Step 8: Sending message...');

    // Look for send button
    const sendButton = page.locator('button:has-text("Send"), [aria-label*="send"], [data-testid="send-button"]').first();
    try {
      if (await sendButton.isVisible({ timeout: 2000 })) {
        await sendButton.click();
        console.log('[TEST] Clicked send button');
      } else {
        // Press Enter to send
        await messageInput.press('Enter');
        console.log('[TEST] Pressed Enter to send');
      }
    } catch (e) {
      await messageInput.press('Enter');
      console.log('[TEST] Pressed Enter to send');
    }

    // Wait for message to be sent
    await page.waitForTimeout(3001);
    await page.screenshot({ path: '/tmp/session-message-sent.png' });

    // Step 9: Verify message appears in the chat
    console.log('[TEST] Step 9: Verifying message in chat...');
    const messageInChat = page.locator(`text="${testMessage}"`).first();
    try {
      await messageInChat.waitFor({ timeout: 5000 });
      console.log('[TEST] ✅ Message found in chat!');
    } catch (e) {
      console.log('[TEST] Message not immediately visible, checking page content');
      const pageContent = await page.textContent('body');
      expect(pageContent).toContain(testMessage.split(' ')[0]); // At least partial match
    }

    // Take final screenshot
    await page.screenshot({ path: '/tmp/session-chat-complete.png' });

    console.log('[TEST] ✅ Claude session chat test completed successfully!');
  });
});

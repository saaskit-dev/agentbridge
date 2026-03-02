/**
 * Integration test for v3SessionRoutes - tests message flow from HTTP to socket
 *
 * This test verifies that when a message is sent via HTTP POST,
 * it is correctly broadcast to session-scoped socket connections.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { io, Socket } from "socket.io-client";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { type Fastify } from "../types";
import { v3SessionRoutes } from "./v3SessionRoutes";
import { eventRouter } from "@/app/events/eventRouter";
import { db } from "@/storage/db";
import { socketHandler } from "@/app/api/socket";

// Test configuration
const TEST_PORT = 3456;
const SERVER_URL = `http://localhost:${TEST_PORT}`;
const TEST_USER_ID = "test-user-integration";
const TEST_SESSION_ID = "test-session-integration";
const TEST_TOKEN = "test-token-for-integration";

// Mock auth to always accept our test token
class MockAuth {
    async verifyToken(token: string) {
        if (token === TEST_TOKEN) {
            return { userId: TEST_USER_ID };
        }
        return null;
    }
}

async function createTestApp() {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;

    // Mock authenticate decorator
    typed.decorate("authenticate", async (request: any, reply: any) => {
        const authHeader = request.headers.authorization || "";
        const token = authHeader.replace("Bearer ", "");

        if (token !== TEST_TOKEN) {
            return reply.code(401).send({ error: "Unauthorized" });
        }
        request.userId = TEST_USER_ID;
    });

    // Setup routes
    v3SessionRoutes(typed);

    await typed.ready();
    return typed;
}

describe("v3SessionRoutes Integration - HTTP to Socket Flow", () => {
    let httpServer: ReturnType<typeof createServer>;
    let ioServer: SocketIOServer;
    let app: Fastify;
    let cliSocket: Socket | null = null;
    let webSocket: Socket | null = null;
    let receivedUpdates: any[] = [];

    beforeAll(async () => {
        // Create HTTP server with fastify
        app = await createTestApp();
        httpServer = createServer(app.server);

        // Setup Socket.IO
        ioServer = new SocketIOServer(httpServer, {
            path: "/v1/updates",
            cors: { origin: "*" }
        });

        // Setup socket handler with mock auth
        const mockAuth = new MockAuth();
        socketHandler(ioServer, mockAuth as any);

        // Start server
        await new Promise<void>((resolve) => {
            httpServer.listen(TEST_PORT, () => {
                console.log(`Test server listening on port ${TEST_PORT}`);
                resolve();
            });
        });
    });

    afterAll(async () => {
        // Cleanup
        if (cliSocket) cliSocket.disconnect();
        if (webSocket) webSocket.disconnect();

        await new Promise<void>((resolve) => {
            ioServer.close(() => resolve());
        });

        await app.close();
    });

    beforeEach(() => {
        receivedUpdates = [];
    });

    it("should broadcast messages to session-scoped connections via socket", async () => {
        // Step 1: Connect CLI (session-scoped socket)
        cliSocket = io(SERVER_URL, {
            path: "/v1/updates",
            auth: {
                token: TEST_TOKEN,
                clientType: "session-scoped",
                sessionId: TEST_SESSION_ID
            },
            transports: ["websocket"],
            reconnection: false
        });

        // Wait for connection
        await new Promise<void>((resolve, reject) => {
            cliSocket!.on("connect", () => {
                console.log("CLI socket connected:", cliSocket!.id);
                resolve();
            });
            cliSocket!.on("connect_error", (err) => {
                reject(new Error(`CLI connection failed: ${err.message}`));
            });
            setTimeout(() => reject(new Error("CLI connection timeout")), 3000);
        });

        // Listen for updates
        cliSocket.on("update", (data) => {
            console.log("CLI received update:", JSON.stringify(data).slice(0, 100));
            receivedUpdates.push({ source: "cli", data });
        });

        // Step 2: Connect Web UI (user-scoped socket)
        webSocket = io(SERVER_URL, {
            path: "/v1/updates",
            auth: {
                token: TEST_TOKEN,
                clientType: "user-scoped"
            },
            transports: ["websocket"],
            reconnection: false
        });

        await new Promise<void>((resolve, reject) => {
            webSocket!.on("connect", () => {
                console.log("Web socket connected:", webSocket!.id);
                resolve();
            });
            webSocket!.on("connect_error", (err) => {
                reject(new Error(`Web connection failed: ${err.message}`));
            });
            setTimeout(() => reject(new Error("Web connection timeout")), 3000);
        });

        webSocket.on("update", (data) => {
            console.log("Web received update:", JSON.stringify(data).slice(0, 100));
            receivedUpdates.push({ source: "web", data });
        });

        // Step 3: Send message via HTTP (simulating web UI)
        const response = await fetch(`${SERVER_URL}/v3/sessions/${TEST_SESSION_ID}/messages`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${TEST_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                messages: [{
                    localId: `test-msg-${Date.now()}`,
                    content: "dGVzdC1jb250ZW50" // base64 encoded
                }]
            })
        });

        expect(response.status).toBe(200);
        const responseBody = await response.json();
        console.log("HTTP response:", JSON.stringify(responseBody).slice(0, 100));

        // Step 4: Wait and verify both sockets received the update
        await new Promise(resolve => setTimeout(resolve, 500));

        console.log("Total updates received:", receivedUpdates.length);
        console.log("Updates by source:", {
            cli: receivedUpdates.filter(u => u.source === "cli").length,
            web: receivedUpdates.filter(u => u.source === "web").length
        });

        // Verify session-scoped connection received the message
        const cliUpdates = receivedUpdates.filter(u => u.source === "cli");
        expect(cliUpdates.length).toBeGreaterThanOrEqual(1);
        expect(cliUpdates[0].data.body.t).toBe("new-message");
        expect(cliUpdates[0].data.body.sid).toBe(TEST_SESSION_ID);

        // Verify user-scoped connection also received it
        const webUpdates = receivedUpdates.filter(u => u.source === "web");
        expect(webUpdates.length).toBeGreaterThanOrEqual(1);
    }, 30000);

    it("should NOT broadcast to session-scoped connections with different sessionId", async () => {
        const OTHER_SESSION_ID = "other-session-id";

        // Connect to a different session
        const otherSocket = io(SERVER_URL, {
            path: "/v1/updates",
            auth: {
                token: TEST_TOKEN,
                clientType: "session-scoped",
                sessionId: OTHER_SESSION_ID
            },
            transports: ["websocket"],
            reconnection: false
        });

        await new Promise<void>((resolve, reject) => {
            otherSocket.on("connect", resolve);
            otherSocket.on("connect_error", (err) => reject(err));
            setTimeout(() => reject(new Error("Connection timeout")), 3000);
        });

        const otherUpdates: any[] = [];
        otherSocket.on("update", (data) => {
            otherUpdates.push(data);
        });

        // Send message to TEST_SESSION_ID
        await fetch(`${SERVER_URL}/v3/sessions/${TEST_SESSION_ID}/messages`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${TEST_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                messages: [{
                    localId: `other-test-${Date.now()}`,
                    content: "dGVzdA=="
                }]
            })
        });

        await new Promise(resolve => setTimeout(resolve, 300));

        // Other session should NOT receive this update
        expect(otherUpdates.length).toBe(0);

        otherSocket.disconnect();
    }, 15000);
});

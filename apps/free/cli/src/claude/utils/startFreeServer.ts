/**
 * Free MCP server
 * Provides Free CLI specific tools including chat session title management
 */

import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { ApiSessionClient } from '@/api/apiSession';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify } from '@saaskit-dev/agentbridge';
const logger = new Logger('claude/utils/startFreeServer');

export async function startFreeServer(client: ApiSessionClient) {
  // Handler that sends title updates via the client
  const handler = async (title: string) => {
    logger.debug('[freeMCP] Changing title to:', title);
    try {
      client.updateMetadata((m) => ({ ...m, summary: { text: title, updatedAt: Date.now() } }));
      return { success: true };
    } catch (error) {
      return { success: false, error: safeStringify(error) };
    }
  };

  // NOTE: StreamableHTTPServerTransport in stateless mode (sessionIdGenerator: undefined)
  // cannot be reused across requests — each request needs a fresh transport + McpServer.
  // Using stateful mode causes "Server already initialized" when the bridge reconnects.
  const createMcpInstance = () => {
    const mcp = new McpServer({ name: 'Free MCP', version: '1.0.0' });

    mcp.registerResource(
      'available_tools',
      'free://tools',
      {
        description: 'Lists tools available on this Free MCP server',
        mimeType: 'application/json',
      },
      async () => ({
        contents: [{
          uri: 'free://tools',
          text: JSON.stringify({ tools: ['change_title'] }),
          mimeType: 'application/json',
        }],
      })
    );

    mcp.registerTool(
      'change_title',
      {
        description: 'Change the title of the current chat session',
        title: 'Change Chat Title',
        inputSchema: {
          title: z.string().describe('The new title for the chat session'),
        },
      },
      async args => {
        const response = await handler(args.title);
        logger.debug('[freeMCP] Response:', response);

        if (response.success) {
          return {
            content: [{ type: 'text', text: `Successfully changed chat title to: "${args.title}"` }],
            isError: false,
          };
        } else {
          return {
            content: [{ type: 'text', text: `Failed to change chat title: ${response.error || 'Unknown error'}` }],
            isError: true,
          };
        }
      }
    );

    return mcp;
  };

  //
  // Create the HTTP server
  //

  const server = createServer(async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcp = createMcpInstance();
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
      res.on('finish', () => {
        transport.close();
        mcp.close();
      });
    } catch (error) {
      logger.debug('Error handling request:', error);
      if (!res.headersSent) {
        res.writeHead(500).end();
      }
    }
  });

  const baseUrl = await new Promise<URL>(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve(new URL(`http://127.0.0.1:${addr.port}`));
    });
  });

  return {
    url: baseUrl.toString(),
    toolNames: ['change_title'],
    stop: () => {
      logger.debug('[freeMCP] Stopping server');
      server.close();
    },
  };
}

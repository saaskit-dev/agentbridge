/**
 * Free MCP server
 * Provides Free CLI specific tools including chat session title management
 */

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { ApiSessionClient } from '@/api/apiSession';
import { Logger } from '@agentbridge/core/telemetry';
const logger = new Logger('claude/utils/startFreeServer');

export async function startFreeServer(client: ApiSessionClient) {
  // Handler that sends title updates via the client
  const handler = async (title: string) => {
    logger.debug('[freeMCP] Changing title to:', title);
    try {
      // Send title as a summary message, similar to title generator
      client.sendClaudeSessionMessage({
        type: 'summary',
        summary: title,
        leafUuid: randomUUID(),
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  };

  //
  // Create the MCP server
  //

  const mcp = new McpServer({
    name: 'Free MCP',
    version: '1.0.0',
  });

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
          content: [
            {
              type: 'text',
              text: `Successfully changed chat title to: "${args.title}"`,
            },
          ],
          isError: false,
        };
      } else {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to change chat title: ${response.error || 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  const transport = new StreamableHTTPServerTransport({
    // NOTE: Returning session id here will result in claude
    // sdk spawn to fail with `Invalid Request: Server already initialized`
    sessionIdGenerator: undefined,
  });
  await mcp.connect(transport);

  //
  // Create the HTTP server
  //

  const server = createServer(async (req, res) => {
    try {
      await transport.handleRequest(req, res);
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
      mcp.close();
      server.close();
    },
  };
}

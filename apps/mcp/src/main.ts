#!/usr/bin/env node
/** The server as a program: MCP on stdin and stdout (logs, if any, go to stderr). */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server';

await createServer().connect(new StdioServerTransport());

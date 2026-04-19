import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { knownTools } from './knownTools';
import type { Metadata } from '@/sync/storageTypes';
import type { ToolCall } from '@/sync/typesMessage';
import { resolvePath } from '@/utils/pathUtils';

export type ToolFamily = 'read' | 'write' | 'shell' | 'search' | 'browser' | 'mcp' | 'other';

function snakeToPascalWithSpaces(str: string): string {
  return str
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function summarizeTextPreview(value: string, maxLength: number, scanLimit = 4096): string | null {
  const scanned = value.slice(0, scanLimit);
  const normalized = scanned.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const wasTruncated = value.length > scanLimit || normalized.length > maxLength;
  const preview = truncate(normalized, maxLength);
  if (!wasTruncated || preview.endsWith('...')) return preview;
  return truncate(`${preview}...`, maxLength);
}

function getResolvedPath(tool: ToolCall, metadata: Metadata | null): string | null {
  if (typeof tool.input?.file_path === 'string') {
    return resolvePath(tool.input.file_path, metadata);
  }
  if (typeof tool.input?.notebook_path === 'string') {
    return resolvePath(tool.input.notebook_path, metadata);
  }
  if (typeof tool.input?.path === 'string') {
    return resolvePath(tool.input.path, metadata);
  }
  if (Array.isArray(tool.input?.locations) && typeof tool.input.locations[0]?.path === 'string') {
    return resolvePath(tool.input.locations[0].path, metadata);
  }
  return null;
}

function getLineRange(tool: ToolCall): string | null {
  const start =
    typeof tool.input?.offset === 'number'
      ? tool.input.offset + 1
      : typeof tool.result?.file?.startLine === 'number'
        ? tool.result.file.startLine
        : null;
  const total =
    typeof tool.input?.limit === 'number'
      ? tool.input.limit
      : typeof tool.result?.file?.numLines === 'number'
        ? tool.result.file.numLines
        : null;

  if (start === null || total === null || total <= 0) return null;
  return `Lines ${start}-${start + total - 1}`;
}

function getCommandSummary(tool: ToolCall): string | null {
  if (typeof tool.input?.command !== 'string') return null;
  return truncate(tool.input.command, 120);
}

function getShellResultSummary(tool: ToolCall): string | null {
  if (tool.state === 'running') return null;

  if (typeof tool.result === 'string') {
    return summarizeTextPreview(tool.result, 120);
  }

  const stderr =
    typeof tool.result?.stderr === 'string' ? summarizeTextPreview(tool.result.stderr, 120) : null;
  const stdout =
    typeof tool.result?.stdout === 'string' ? summarizeTextPreview(tool.result.stdout, 120) : null;
  if (stderr) return stderr;
  if (stdout) return stdout;
  return null;
}

function getEditSummary(tool: ToolCall, metadata: Metadata | null): string | null {
  const path = getResolvedPath(tool, metadata);
  if (tool.name === 'MultiEdit' && Array.isArray(tool.input?.edits)) {
    const count = tool.input.edits.length;
    return path ? `${count} edits queued` : `${count} edits`;
  }
  if (typeof tool.input?.old_string === 'string' || typeof tool.input?.new_string === 'string') {
    const before = typeof tool.input?.old_string === 'string' ? tool.input.old_string.length : 0;
    const after = typeof tool.input?.new_string === 'string' ? tool.input.new_string.length : 0;
    if (before || after) {
      return `Replace ${before} chars with ${after} chars`;
    }
  }
  if (typeof tool.input?.content === 'string') {
    return `${tool.input.content.split('\n').length} lines written`;
  }
  if (typeof tool.input?.edit_mode === 'string') {
    return path ? tool.input.edit_mode : `Notebook ${tool.input.edit_mode}`;
  }
  return path;
}

function getMcpSummary(tool: ToolCall): string | null {
  const input = tool.input;
  if (typeof input?.query === 'string') return truncate(input.query, 120);
  if (typeof input?.title === 'string') return truncate(input.title, 120);
  if (typeof input?.url === 'string') return truncate(input.url, 120);
  if (typeof input?.issue === 'string') return input.issue;
  if (typeof input?.project === 'string') return input.project;
  if (typeof input?.fileKey === 'string' && typeof input?.nodeId === 'string') {
    return `${input.fileKey} · ${input.nodeId}`;
  }
  return null;
}

export function formatMCPTitle(toolName: string): string {
  const withoutPrefix = toolName.replace(/^mcp__/, '');
  const parts = withoutPrefix.split('__');

  if (parts.length >= 2) {
    const serverName = snakeToPascalWithSpaces(parts[0]);
    const toolNamePart = snakeToPascalWithSpaces(parts.slice(1).join('_'));
    return `MCP: ${serverName} ${toolNamePart}`;
  }

  return `MCP: ${snakeToPascalWithSpaces(withoutPrefix)}`;
}

export function classifyToolFamily(name: string): ToolFamily {
  if (name.startsWith('mcp__')) return 'mcp';
  if (['Read', 'read', 'LS', 'NotebookRead'].includes(name)) return 'read';
  if (
    [
      'Edit',
      'MultiEdit',
      'Write',
      'NotebookEdit',
      'edit',
      'CodexPatch',
      'CodexDiff',
      'ExitPlanMode',
      'exit_plan_mode',
    ].includes(name)
  ) {
    return 'write';
  }
  if (['Bash', 'CodexBash', 'shell', 'execute'].includes(name)) return 'shell';
  if (
    ['Grep', 'Glob', 'ToolSearch', 'WebFetch', 'webfetch', 'websearch_web_search_exa'].includes(
      name
    )
  ) {
    return 'search';
  }
  if (name.startsWith('chrome-devtools_')) return 'browser';
  return 'other';
}

export function getToolFamilyLabel(family: ToolFamily, count: number): string {
  switch (family) {
    case 'read':
      return `${count} read${count === 1 ? '' : 's'}`;
    case 'write':
      return `${count} edit${count === 1 ? '' : 's'}`;
    case 'shell':
      return `${count} shell`;
    case 'search':
      return `${count} search`;
    case 'browser':
      return `${count} browser`;
    case 'mcp':
      return `${count} MCP`;
    default:
      return `${count} step${count === 1 ? '' : 's'}`;
  }
}

export function getToolTitle(tool: ToolCall, metadata: Metadata | null): string {
  const knownTool = knownTools[tool.name as keyof typeof knownTools] as any;

  if (tool.name.startsWith('mcp__')) {
    return formatMCPTitle(tool.name);
  }

  if (knownTool?.title) {
    return typeof knownTool.title === 'function'
      ? knownTool.title({ tool, metadata })
      : knownTool.title;
  }

  return tool.name;
}

export function getToolSubtitle(tool: ToolCall, metadata: Metadata | null): string | null {
  const knownTool = knownTools[tool.name as keyof typeof knownTools] as any;
  if (knownTool && typeof knownTool.extractSubtitle === 'function') {
    const subtitle = knownTool.extractSubtitle({ tool, metadata });
    if (typeof subtitle === 'string' && subtitle) {
      return subtitle;
    }
  }
  return null;
}

export function getToolSummary(tool: ToolCall, metadata: Metadata | null): string | null {
  const subtitle = getToolSubtitle(tool, metadata);
  if (subtitle) return subtitle;

  const knownTool = knownTools[tool.name as keyof typeof knownTools] as any;
  if (knownTool && typeof knownTool.extractDescription === 'function') {
    const description = knownTool.extractDescription({ tool, metadata });
    if (typeof description === 'string' && description) {
      return description;
    }
  }

  const family = classifyToolFamily(tool.name);
  switch (family) {
    case 'read':
      return getLineRange(tool) || getResolvedPath(tool, metadata);
    case 'write':
      return getEditSummary(tool, metadata);
    case 'shell':
      return getShellResultSummary(tool) || getCommandSummary(tool);
    case 'search':
      if (typeof tool.input?.pattern === 'string') return truncate(tool.input.pattern, 120);
      if (typeof tool.input?.url === 'string') return truncate(tool.input.url, 120);
      if (typeof tool.input?.path === 'string') return resolvePath(tool.input.path, metadata);
      return null;
    case 'mcp':
      return getMcpSummary(tool);
    default:
      return getResolvedPath(tool, metadata) || getCommandSummary(tool);
  }

  return null;
}

export function getToolHeaderIcon(
  tool: ToolCall,
  metadata: Metadata | null,
  size: number,
  color: string
): React.ReactNode {
  const knownTool = knownTools[tool.name as keyof typeof knownTools] as any;

  if (tool.name.startsWith('mcp__')) {
    return <Ionicons name="extension-puzzle-outline" size={size} color={color} />;
  }

  if (knownTool && typeof knownTool.icon === 'function') {
    return knownTool.icon(size, color);
  }

  return <Ionicons name="construct-outline" size={size} color={color} />;
}

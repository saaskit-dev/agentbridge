/**
 * Gemini Constants
 *
 * Centralized constants for Gemini integration including environment variable names
 * and default values.
 */

import { trimIdent } from '@/utils/trimIdent';

/** Environment variable name for Gemini API key */
export const GEMINI_API_KEY_ENV = 'GEMINI_API_KEY';

/** Environment variable name for Google API key (alternative) */
export const GOOGLE_API_KEY_ENV = 'GOOGLE_API_KEY';

/** Environment variable name for Gemini model selection */
export const GEMINI_MODEL_ENV = 'GEMINI_MODEL';

/** Default Gemini model */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro';

/**
 * Instruction for changing chat title.
 * Used in prompts to instruct agents to call the change_title MCP tool.
 *
 * The tool is exposed via the "free" MCP server. All ACP agents see the
 * same tool, but the old `functions.free__change_title` phrasing caused
 * Cursor agent to treat it as a codebase reference (grep for the symbol)
 * instead of a tool-call intent — especially in workspaces that contain
 * source files mentioning `change_title`.
 *
 * Using a natural-language description avoids this ambiguity.
 */
export const CHANGE_TITLE_INSTRUCTION = trimIdent(
  `Based on this message, call the change_title tool (from the "free" MCP server) to set a short chat session title that represents the current task. If the topic changes dramatically, call it again to update the title.`
);

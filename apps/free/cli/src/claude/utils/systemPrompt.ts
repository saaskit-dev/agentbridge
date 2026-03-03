import { shouldIncludeCoAuthoredBy } from './claudeSettings';
import { configuration } from '@/configuration';
import { trimIdent } from '@/utils/trimIdent';

/**
 * Base system prompt shared across all configurations
 */
const BASE_SYSTEM_PROMPT = (() =>
  trimIdent(`
    ALWAYS when you start a new chat - you must call a tool "mcp__free__change_title" to set a chat title. When you think chat title is not relevant anymore - call the tool again to change it. When chat name is too generic and you have a change to make it more specific - call the tool again to change it. This title is needed to easily find the chat in the future. Help human.
`))();

/**
 * Get co-authored-by credits with dynamic URL from configuration
 */
function getCoAuthoredCredits(): string {
  const webappUrl = configuration.webappUrl.replace(/\/$/, '');
  const domain = webappUrl.replace(/^https?:\/\//, '');

  return trimIdent(`
    When making commit messages, instead of just giving co-credit to Claude, also give credit to Free like so:

    <main commit message>

    Generated with [Claude Code](https://claude.ai/code)
    via [Free](${webappUrl})

    Co-Authored-By: Claude <noreply@anthropic.com>
    Co-Authored-By: Free <yesreply@${domain}>
`);
}

/**
 * System prompt with conditional Co-Authored-By lines based on Claude's settings.json configuration.
 * Settings are read once on startup for performance.
 */
export const systemPrompt = (() => {
  const includeCoAuthored = shouldIncludeCoAuthoredBy();

  if (includeCoAuthored) {
    return BASE_SYSTEM_PROMPT + '\n\n' + getCoAuthoredCredits();
  } else {
    return BASE_SYSTEM_PROMPT;
  }
})();

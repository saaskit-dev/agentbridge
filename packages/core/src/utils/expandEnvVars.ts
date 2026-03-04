/**
 * Environment variable expansion utility
 *
 * Expands ${VAR} and ${VAR:-default} references in strings.
 * Useful for configuration files that reference environment variables.
 *
 */

/**
 * Expand ${VAR} and ${VAR:-default} references in a string
 *
 * @param value - String containing ${VAR} references
 * @param sourceEnv - Source environment (usually process.env)
 * @returns String with all references expanded
 *
 * @example
 * ```typescript
 * process.env.HOME = '/home/user';
 * expandEnvVars('${HOME}/.config'); // '/home/user/.config'
 * expandEnvVars('${UNDEFINED:-default}'); // 'default'
 * ```
 */
export function expandEnvVars(value: string, sourceEnv: NodeJS.ProcessEnv = process.env): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, expr) => {
    // Support bash parameter expansion: ${VAR:-default}
    const colonDashIndex = expr.indexOf(':-');
    let varName: string;
    let defaultValue: string | undefined;

    if (colonDashIndex !== -1) {
      // Split ${VAR:-default} into varName and defaultValue
      varName = expr.substring(0, colonDashIndex);
      defaultValue = expr.substring(colonDashIndex + 2);
    } else {
      // Simple ${VAR} reference
      varName = expr;
    }

    const resolvedValue = sourceEnv[varName];
    if (resolvedValue !== undefined) {
      return resolvedValue;
    } else if (defaultValue !== undefined) {
      return defaultValue;
    } else {
      // Variable not found and no default - keep placeholder
      return match;
    }
  });
}

/**
 * Expand ${VAR} and ${VAR:-default} references in environment variables object
 *
 * @param envVars - Environment variables that may contain ${VAR} references
 * @param sourceEnv - Source environment (usually process.env) to resolve references from
 * @returns New object with all ${VAR} references expanded to actual values
 *
 * @example
 * ```typescript
 * const daemonEnv = { Z_AI_AUTH_TOKEN: 'sk-real-key' };
 * const profileVars = { ANTHROPIC_AUTH_TOKEN: '${Z_AI_AUTH_TOKEN}' };
 *
 * const expanded = expandEnvironmentVariables(profileVars, daemonEnv);
 * // Result: { ANTHROPIC_AUTH_TOKEN: 'sk-real-key' }
 * ```
 */
export function expandEnvironmentVariables(
  envVars: Record<string, string>,
  sourceEnv: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const expanded: Record<string, string> = {};

  for (const [key, value] of Object.entries(envVars)) {
    expanded[key] = expandEnvVars(value, sourceEnv);
  }

  return expanded;
}

/**
 * Get list of undefined variable names referenced in a string
 *
 * @param value - String to check
 * @param sourceEnv - Source environment
 * @returns Array of variable names that are referenced but not defined
 */
export function getUndefinedVars(
  value: string,
  sourceEnv: NodeJS.ProcessEnv = process.env
): string[] {
  const undefinedVars: string[] = [];

  value.replace(/\$\{([^}]+)\}/g, (match, expr) => {
    const colonDashIndex = expr.indexOf(':-');
    const varName = colonDashIndex !== -1 ? expr.substring(0, colonDashIndex) : expr;

    if (sourceEnv[varName] === undefined) {
      undefinedVars.push(varName);
    }
    return match;
  });

  return undefinedVars;
}

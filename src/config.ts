/**
 * Configuration Loader for LACRM MCP Server
 *
 * Loads the LACRM API key from multiple sources with the following priority:
 * 1. LACRM_API_KEY environment variable (highest priority)
 * 2. ~/.lacrm-config.json (user home directory)
 * 3. .lacrm-config.json (current working directory)
 *
 * Config file format:
 * ```json
 * {
 *   "apiKey": "your-lacrm-api-key"
 * }
 * ```
 *
 * Security notes:
 * - Environment variables are preferred for production/CI
 * - Config files should have restricted permissions (chmod 600)
 * - Never commit config files containing API keys to version control
 *
 * @module config
 */

import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { AuthenticationError } from './utils/errors.js';
import { logger } from './utils/logger.js';

/**
 * Server configuration containing the LACRM API key.
 */
export interface Config {
  /** The LACRM API key for authentication */
  apiKey: string;
}

/**
 * Shape of the JSON config file.
 * All fields are optional since the file might be incomplete.
 */
interface ConfigFile {
  apiKey?: string;
}

/**
 * Attempt to load and parse a JSON config file.
 *
 * @param path - Absolute path to the config file
 * @returns Parsed config object, or null if file doesn't exist or is invalid
 */
function loadConfigFile(path: string): ConfigFile | null {
  try {
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf-8');
      const config = JSON.parse(content) as ConfigFile;
      logger.debug(`Loaded config from ${path}`);
      return config;
    }
  } catch (error) {
    logger.warn(`Failed to load config from ${path}`, error);
  }
  return null;
}

/**
 * Load server configuration from environment or config files.
 *
 * Searches for API key in order of priority:
 * 1. LACRM_API_KEY environment variable
 * 2. ~/.lacrm-config.json
 * 3. ./.lacrm-config.json
 *
 * @returns Configuration object with the API key
 * @throws {AuthenticationError} If no API key is found in any source
 *
 * @example
 * // Using environment variable
 * process.env.LACRM_API_KEY = 'my-api-key';
 * const config = loadConfig();
 *
 * @example
 * // Using config file at ~/.lacrm-config.json
 * // { "apiKey": "my-api-key" }
 * const config = loadConfig();
 */
export function loadConfig(): Config {
  // Priority 1: Environment variable (most secure, recommended for production)
  const envApiKey = process.env.LACRM_API_KEY;
  if (envApiKey) {
    logger.debug('Using API key from LACRM_API_KEY environment variable');
    return { apiKey: envApiKey };
  }

  // Priority 2: User home config file (convenient for development)
  const homeConfigPath = join(homedir(), '.lacrm-config.json');
  const homeConfig = loadConfigFile(homeConfigPath);
  if (homeConfig?.apiKey) {
    return { apiKey: homeConfig.apiKey };
  }

  // Priority 3: Local config file (project-specific configuration)
  const localConfigPath = join(process.cwd(), '.lacrm-config.json');
  const localConfig = loadConfigFile(localConfigPath);
  if (localConfig?.apiKey) {
    return { apiKey: localConfig.apiKey };
  }

  // No API key found - throw with helpful message
  throw new AuthenticationError(
    'No API key found. Set LACRM_API_KEY environment variable or create a config file at ~/.lacrm-config.json with {"apiKey": "your-key"}'
  );
}

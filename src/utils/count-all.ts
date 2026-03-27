/**
 * Count-All Pagination Utility
 *
 * Auto-paginates through all pages of a list API call and returns
 * only aggregate counts with optional breakdowns. Used by count_only
 * mode on search/list tools to get accurate totals without returning
 * the full result set.
 *
 * @module utils/count-all
 */

import type { LacrmClient } from '../client.js';

/**
 * Configuration for a single breakdown dimension.
 * Tells the counter which field to group by and what to call it.
 */
export interface BreakdownConfig {
  /** Label for this breakdown in the output (e.g., "by_status") */
  label: string;
  /**
   * Dot-separated path to the field value within each item.
   * Examples: "StatusMetaData.Name", "IsComplete", "AssignedTo"
   */
  path: string;
}

/**
 * Extract a nested value from an object using a dot-separated path.
 *
 * @param obj - The object to extract from
 * @param path - Dot-separated path (e.g., "StatusMetaData.Name")
 * @returns The string value at the path, or "Unknown" if not found
 */
function getNestedValue(obj: unknown, path: string): string {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return 'Unknown';
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current === 'boolean') return current ? 'Yes' : 'No';
  return current != null ? String(current) : 'Unknown';
}

/**
 * Auto-paginate through all pages and return aggregate counts.
 *
 * Iterates through up to MAX_PAGES pages of results, counting items
 * and aggregating breakdowns without accumulating the full result set.
 *
 * @param client - LACRM API client
 * @param apiFunction - API function name (e.g., "GetPipelineItems")
 * @param baseParams - Base parameters for the API call (pagination params will be added)
 * @param breakdowns - Which fields to count by (empty array = total only)
 * @returns Object with total count and breakdown counts
 */
export async function countAll(
  client: LacrmClient,
  apiFunction: string,
  baseParams: Record<string, unknown>,
  breakdowns: BreakdownConfig[]
): Promise<{ total: number; breakdowns: Record<string, Record<string, number>> }> {
  const MAX_PAGES = 100;
  const PAGE_SIZE = 10000;

  let total = 0;
  const breakdownCounts: Record<string, Record<string, number>> = {};
  for (const bd of breakdowns) {
    breakdownCounts[bd.label] = {};
  }

  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = { ...baseParams, MaxNumberOfResults: PAGE_SIZE, Page: page };
    const result = await client.call<{ Results?: unknown[]; HasMoreResults?: boolean }>(apiFunction, params);

    const items = Array.isArray(result) ? result : (result.Results || []);
    total += items.length;

    // Aggregate breakdowns
    for (const item of items) {
      for (const bd of breakdowns) {
        const val = getNestedValue(item, bd.path);
        breakdownCounts[bd.label][val] = (breakdownCounts[bd.label][val] || 0) + 1;
      }
    }

    // Determine if more pages exist. The API normally returns
    // { Results: [...], HasMoreResults: bool }, but some endpoints
    // return a plain array. For plain arrays, assume more pages
    // exist if the current page is full (items.length === PAGE_SIZE).
    const hasMore = Array.isArray(result)
      ? items.length >= PAGE_SIZE
      : result.HasMoreResults === true;
    if (!hasMore || items.length === 0) break;
  }

  return { total, breakdowns: breakdownCounts };
}

/**
 * Response Summarization Utility
 *
 * Wraps list results in a structured envelope with machine-counted
 * summary statistics. This prevents LLMs from miscounting items
 * in large JSON arrays — a known failure mode when datasets exceed
 * ~50 items.
 *
 * @module utils/summarize
 */

/**
 * Configuration for a single breakdown dimension.
 * Tells the summarizer which field to group by and what to call it.
 */
export interface BreakdownConfig {
  /** Label for this breakdown in the summary (e.g., "by_status") */
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
 * @returns The value at the path, or "Unknown" if not found
 */
function getNestedValue(obj: unknown, path: string): string {
  let current: unknown = obj;
  for (const key of path.split('.')) {
    if (current && typeof current === 'object' && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return 'Unknown';
    }
  }
  if (typeof current === 'boolean') return current ? 'Yes' : 'No';
  return current != null ? String(current) : 'Unknown';
}

/**
 * LACRM's page size when a list call sends no `MaxNumberOfResults`
 * (documented as "default 500, max 10,000" on every paginated function).
 */
export const LACRM_DEFAULT_PAGE_SIZE = 500;

/**
 * The most items LACRM serves on one page, whatever `MaxNumberOfResults` asks
 * for ("max 10,000" on every paginated function).
 */
export const LACRM_MAX_PAGE_SIZE = 10000;

/**
 * Pass as `pageSize` for a LACRM function that is NOT paginated (its reference
 * lists no `MaxNumberOfResults`/`Page` and it answers with every item at once,
 * e.g. `GetFilesAttachedToContact`): a bare answer is then the whole list.
 */
export const NOT_PAGINATED = null;

/**
 * Whether more results exist beyond this page of a LACRM list call, for
 * `summarizeResults`' `has_more_results`.
 *
 * LACRM signals it with `HasMoreResults` on a wrapped `{ HasMoreResults, Results }`
 * answer: true on a non-last page, false on the last. When that boolean is
 * present it decides, because it is the API saying so. Some functions answer
 * with a bare array (or leave the flag out); then nothing says whether the
 * list ended, so a full page reads true and only a short page - which LACRM's
 * fixed-size pages make the last one - reads false. A full page is what LACRM
 * serves, not what was asked for: the size asked (LACRM's default 500 when
 * none was) capped at its 10,000 per page. A function that is not paginated
 * (`NOT_PAGINATED`) answers with everything, so without the flag it reads false.
 *
 * @param result - The raw answer from `client.call` (wrapped object or bare array)
 * @param items - The items taken from that answer
 * @param pageSize - The `MaxNumberOfResults` sent (LACRM's default when none was),
 *   or `NOT_PAGINATED`
 */
export function pageHasMore(
  result: unknown,
  items: unknown[],
  pageSize: unknown = LACRM_DEFAULT_PAGE_SIZE
): boolean {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const flag = (result as Record<string, unknown>).HasMoreResults;
    if (typeof flag === 'boolean') return flag;
  }
  if (pageSize === NOT_PAGINATED) return false;
  const asked = Number(pageSize);
  const size = Number.isFinite(asked) && asked > 0 ? asked : LACRM_DEFAULT_PAGE_SIZE;
  return items.length >= Math.min(size, LACRM_MAX_PAGE_SIZE);
}

/**
 * Wrap list results with a machine-counted summary header.
 *
 * @param items - The array of result items
 * @param hasMore - Whether the API has more results beyond this page
 * @param breakdowns - Which fields to count by (empty array = total only)
 * @returns JSON string with summary envelope: { summary: { page_count, has_more_results, note?, breakdowns... }, results }
 *
 * @example
 * // Pipeline items with status breakdown
 * return summarizeResults(items, false, [
 *   { label: 'by_status', path: 'StatusMetaData.Name' }
 * ]);
 *
 * // Tasks with completion breakdown
 * return summarizeResults(items, false, [
 *   { label: 'by_completion', path: 'IsComplete' }
 * ]);
 *
 * // Simple total-only summary
 * return summarizeResults(items, false, []);
 */
export function summarizeResults(
  items: unknown[],
  hasMore: boolean,
  breakdowns: BreakdownConfig[]
): string {
  const summary: Record<string, unknown> = {
    page_count: items.length,
    has_more_results: hasMore,
  };

  if (hasMore) {
    summary.note = 'page_count is ONLY the number of items on this page, NOT the total. Use count_only=true for accurate totals across all pages.';
  }

  for (const { label, path } of breakdowns) {
    const counts: Record<string, number> = {};
    for (const item of items) {
      const value = getNestedValue(item, path);
      counts[value] = (counts[value] || 0) + 1;
    }
    summary[label] = counts;
  }

  const envelope = { summary, results: items };
  return JSON.stringify(envelope, null, 2);
}

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

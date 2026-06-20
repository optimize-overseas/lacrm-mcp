/**
 * Shared types for the generic LACRM bulk-CSV tools.
 *
 * These types are deliberately instance-agnostic: nothing here encodes a specific
 * CRM's field names, merge rules, or use cases. Callers supply the full field
 * configuration (which columns exist, how each merges) at call time.
 *
 * @module tools/bulk/types
 */

/**
 * How an update-mode field reacts to the uploaded CSV.
 *
 * The model is column-presence based. A column ABSENT from the uploaded CSV is
 * always left unchanged (omitted from the EditContact call) regardless of strategy.
 * When a column IS present, the strategy decides what happens:
 *
 *   - `replace`            : write the cell value; a BLANK cell clears the field.
 *   - `preserve_if_blank`  : write the cell value; a blank cell is ignored (field kept).
 *   - `union_semicolon`    : union-merge the cell value into the existing value
 *                            (semicolon-delimited, de-duplicated); blank is ignored.
 *   - `never_write`        : never write this field (always preserved).
 */
export type MergeStrategy = 'replace' | 'preserve_if_blank' | 'union_semicolon' | 'never_write';

/**
 * Configuration for one field of a bulk operation. Supplied by the caller.
 */
export interface FieldSpec {
  /** CSV header (column) name this field reads from. */
  column: string;
  /** LACRM API parameter key to write to. Defaults to `column` when omitted. */
  field?: string;
  /** Merge strategy applied in update mode (ignored in create mode). */
  strategy: MergeStrategy;
  /**
   * When true the column must be present and every row must carry a non-blank
   * value (enforced during validation, not merging). Typical for the key column.
   */
  required?: boolean;
  /** Separator used to JOIN merged values for `union_semicolon`. Default `'; '`. */
  separator?: string;
  /** Optional example value used when a template is generated with an example row. */
  example?: string;
  /** Optional human-readable description surfaced in the generated template report. */
  description?: string;
}

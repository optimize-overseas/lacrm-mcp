import { describe, it, expect } from 'vitest';
import { countAll } from './count-all.js';

/**
 * count_only is where the has_more_results note sends a caller for an accurate
 * total, so its answer must say when it is NOT the whole total: the 100-page
 * safety cap stops the walk while LACRM still has more, or a page answers with
 * no HasMoreResults flag.
 */
const PAGE = 10000;
const FULL_PAGE = Array.from({ length: PAGE }, () => ({ AssignedTo: 'Staff' }));

type Answer = (page: number) => unknown;

function client(answer: Answer) {
  const pages: number[] = [];
  return {
    pages,
    call: async (_fn: string, params: Record<string, unknown>) => {
      const page = Number(params.Page);
      pages.push(page);
      return answer(page);
    },
  };
}

describe('countAll completeness', () => {
  it('says the total is complete when LACRM reports the last page', async () => {
    const c = client((page) => ({
      HasMoreResults: page < 3,
      Results: page < 3 ? FULL_PAGE : FULL_PAGE.slice(0, 1234),
    }));
    const out = await countAll(c as never, 'GetContacts', {}, [{ label: 'by_assigned_to', path: 'AssignedTo' }]);
    expect(out.total).toBe(2 * PAGE + 1234);
    expect(out.complete).toBe(true);
    expect(out).not.toHaveProperty('note');
    expect(out.breakdowns.by_assigned_to).toEqual({ Staff: 2 * PAGE + 1234 });
  });

  it('says the total is NOT complete when the page cap stops it while LACRM has more', async () => {
    const c = client(() => ({ HasMoreResults: true, Results: FULL_PAGE }));
    const out = await countAll(c as never, 'GetContacts', {}, []);
    expect(c.pages).toHaveLength(100);
    expect(out.total).toBe(100 * PAGE);
    expect(out.complete).toBe(false);
    expect(out.note).toMatch(/at least/);
  });

  it('keeps counting past a full page that carries no HasMoreResults flag', async () => {
    const c = client((page) => ({ Results: page === 1 ? FULL_PAGE : FULL_PAGE.slice(0, 5) }));
    const out = await countAll(c as never, 'GetContacts', {}, []);
    expect(c.pages).toEqual([1, 2]);
    expect(out.total).toBe(PAGE + 5);
    expect(out.complete).toBe(true);
  });

  it('keeps counting past a full bare-array page and stops on a short one', async () => {
    const c = client((page) => (page === 1 ? FULL_PAGE : FULL_PAGE.slice(0, 7)));
    const out = await countAll(c as never, 'GetNotes', {}, []);
    expect(c.pages).toEqual([1, 2]);
    expect(out.total).toBe(PAGE + 7);
    expect(out.complete).toBe(true);
  });

  it('does not call an empty page complete when LACRM still says more', async () => {
    const c = client(() => ({ HasMoreResults: true, Results: [] }));
    const out = await countAll(c as never, 'GetContacts', {}, []);
    expect(c.pages).toEqual([1]);
    expect(out.total).toBe(0);
    expect(out.complete).toBe(false);
  });
});

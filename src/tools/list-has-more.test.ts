import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Every list tool's summary `has_more_results` comes from `pageHasMore`: LACRM's
 * `HasMoreResults` decides when the answer carries it; a bare-array answer (some
 * LACRM functions) with a full page reads true, because nothing says the list
 * ended. Before, a bare-array answer always read false, even on a full page.
 */
let answer: (params: Record<string, unknown>) => unknown = () => [];

vi.mock('../client.js', () => ({
  getClient: () => ({
    call: async (_fn: string, params: Record<string, unknown>) => answer(params),
  }),
}));

const { registerTaskTools } = await import('./tasks/index.js');
const { registerEmailTools } = await import('./emails/index.js');
const { registerNoteTools } = await import('./notes/index.js');
const { registerGroupMembershipTools } = await import('./groups/index.js');
const { registerEventTools } = await import('./events/index.js');
const { registerFileTools } = await import('./files/index.js');
const { registerPipelineItemTools } = await import('./pipeline-items/index.js');

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

const tools: Record<string, Handler> = {};
const fakeServer = {
  registerTool: (name: string, _def: unknown, handler: Handler) => {
    tools[name] = handler;
  },
};
for (const register of [
  registerTaskTools,
  registerEmailTools,
  registerNoteTools,
  registerGroupMembershipTools,
  registerEventTools,
  registerFileTools,
  registerPipelineItemTools,
]) {
  register(fakeServer as never);
}

// The list tools that summarize a page of a PAGINATED LACRM function, with the
// least each needs to run.
const LIST_TOOLS: Array<[string, Record<string, unknown>]> = [
  ['search_tasks', { start_date: '2026-01-01', end_date: '2026-12-31' }],
  ['get_tasks_attached_to_contact', { contact_id: '1' }],
  ['search_emails', {}],
  ['get_emails_attached_to_contact', { contact_id: '1' }],
  ['search_notes', {}],
  ['get_notes_attached_to_contact', { contact_id: '1' }],
  ['get_contacts_in_group', { group_name: 'Priority' }],
  ['search_events', { start_date: '2026-01-01', end_date: '2026-12-31' }],
  ['get_events_attached_to_contact', { contact_id: '1' }],
  ['search_pipeline_items', { pipeline_id: '9' }],
];

// LACRM does not paginate these two (its function reference lists no
// MaxNumberOfResults/Page and answers "all files" / "all pipeline items"), so
// whatever comes back is the whole answer: only LACRM itself saying
// HasMoreResults: true could mean more.
const UNPAGINATED_TOOLS: Array<[string, Record<string, unknown>]> = [
  ['get_files_attached_to_contact', { contact_id: '1' }],
  ['get_pipeline_items_attached_to_contact', { contact_id: '1' }],
];

function page(n: number) {
  return Array.from({ length: n }, (_, i) => ({ Id: String(i) }));
}

async function summary(tool: string, args: Record<string, unknown>) {
  const res = await tools[tool](args);
  expect(res.isError, res.content[0].text).toBeFalsy();
  return JSON.parse(res.content[0].text).summary as { page_count: number; has_more_results: boolean };
}

describe('list tools has_more_results', () => {
  beforeEach(() => {
    answer = () => [];
  });

  it.each(LIST_TOOLS)('%s: a full bare-array page says more', async (tool, args) => {
    answer = (params) => page(Number(params.MaxNumberOfResults ?? 500));
    const s = await summary(tool, args);
    expect(s.page_count).toBe(500);
    expect(s.has_more_results).toBe(true);
  });

  it.each(UNPAGINATED_TOOLS)('%s: a 500-item bare answer is the whole list, not "more"', async (tool, args) => {
    answer = () => page(500);
    const s = await summary(tool, args);
    expect(s.page_count).toBe(500);
    expect(s.has_more_results).toBe(false);
  });

  it.each(UNPAGINATED_TOOLS)('%s: still follows LACRM if it says HasMoreResults', async (tool, args) => {
    answer = () => ({ HasMoreResults: true, Results: page(3) });
    expect((await summary(tool, args)).has_more_results).toBe(true);
    answer = () => ({ HasMoreResults: false, Results: page(3) });
    expect((await summary(tool, args)).has_more_results).toBe(false);
  });

  it.each([...LIST_TOOLS, ...UNPAGINATED_TOOLS])('%s: a short bare-array page says no more', async (tool, args) => {
    answer = () => page(12);
    const s = await summary(tool, args);
    expect(s.page_count).toBe(12);
    expect(s.has_more_results).toBe(false);
  });

  it.each(LIST_TOOLS)('%s: LACRM HasMoreResults decides a wrapped page', async (tool, args) => {
    answer = () => ({ HasMoreResults: true, Results: page(3) });
    expect((await summary(tool, args)).has_more_results).toBe(true);
    answer = () => ({ HasMoreResults: false, Results: page(500) });
    expect((await summary(tool, args)).has_more_results).toBe(false);
  });

  it('a flagless answer is full at LACRM\'s 10,000-per-page cap, whatever max_results asked for', async () => {
    answer = (params) => page(Math.min(Number(params.MaxNumberOfResults ?? 500), 10000));
    const s = await summary('search_notes', { max_results: 20000 });
    expect(s.page_count).toBe(10000);
    expect(s.has_more_results).toBe(true);
  });

  it('honours a max_results page size for a bare-array page', async () => {
    answer = (params) => page(Number(params.MaxNumberOfResults ?? 500));
    const s = await summary('search_notes', { max_results: 40 });
    expect(s.page_count).toBe(40);
    expect(s.has_more_results).toBe(true);
  });
});

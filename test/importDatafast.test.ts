import { describe, expect, it } from 'vitest';
import { parseCsv, detectFileType, normalizeDate, aggregateDatafastFiles, generateMinilyticsImport } from '../src/shared/importDatafast';

describe('parseCsv', () => {
  it('parses standard CSV lines and headers', () => {
    const csv = `Date,Visitors,Pageviews,Bounce Rate,Visit Duration\n2024-05-01,150,300,55.2%,45`;
    const { headers, rows } = parseCsv(csv);
    expect(headers).toEqual(['date', 'visitors', 'pageviews', 'bounce_rate', 'visit_duration']);
    expect(rows).toHaveLength(1);
    expect(rows[0].visitors).toBe('150');
    expect(rows[0].date).toBe('2024-05-01');
  });

  it('handles quoted fields and commas inside quotes', () => {
    const csv = `date,source,visitors\n2024-05-01,"Google, Inc.",25\n2024-05-01,"Twitter / ""X""",50`;
    const { headers, rows } = parseCsv(csv);
    expect(headers).toEqual(['date', 'source', 'visitors']);
    expect(rows[0].source).toBe('Google, Inc.');
    expect(rows[1].source).toBe('Twitter / "X"');
  });

  it('handles CRLF line endings', () => {
    const csv = "date,visitors\r\n2024-05-01,100\r\n2024-05-02,120\r\n";
    const { rows } = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[1].visitors).toBe('120');
  });
});

describe('detectFileType', () => {
  it('detects sources, pages, and visitors files', () => {
    expect(detectFileType('sources.csv', ['date', 'source', 'visitors'])).toBe('sources');
    expect(detectFileType('referrers.csv', ['referrer', 'visitors'])).toBe('sources');
    expect(detectFileType('pages.csv', ['date', 'page', 'visitors', 'pageviews'])).toBe('pages');
    expect(detectFileType('visitors.csv', ['date', 'visitors', 'pageviews'])).toBe('visitors');
    expect(detectFileType('countries.csv', ['date', 'country', 'visitors'])).toBe('countries');
    expect(detectFileType('custom-events.csv', ['date', 'goal', 'visitors', 'events'])).toBe('custom_events');
  });
});

describe('aggregateDatafastFiles and generateMinilyticsImport', () => {
  it('aggregates Plausible/Datafast CSV files and creates Minilytics records', () => {
    const visitorsCsv = `date,visitors,pageviews,bounce_rate,visit_duration\n2024-05-01,10,20,50%,60`;
    const sourcesCsv = `date,source,visitors\n2024-05-01,Google,6\n2024-05-01,t.co,4`;
    const pagesCsv = `date,page,visitors,pageviews\n2024-05-01,/,8,12\n2024-05-01,/pricing,5,8`;

    const parsedVisitors = { filename: 'visitors.csv', ...parseCsv(visitorsCsv) };
    const parsedSources = { filename: 'sources.csv', ...parseCsv(sourcesCsv) };
    const parsedPages = { filename: 'pages.csv', ...parseCsv(pagesCsv) };

    const { days, summary } = aggregateDatafastFiles([parsedVisitors, parsedSources, parsedPages], 'USD');

    expect(summary.totalDays).toBe(1);
    expect(summary.totalVisitors).toBe(10);
    expect(summary.totalPageviews).toBe(20);

    const batches = generateMinilyticsImport(days, 'test_site', 'test.com', 'USD', 10);
    expect(batches.length).toBeGreaterThan(0);

    const firstBatch = batches[0];
    expect(firstBatch.sessions).toHaveLength(10);
    expect(firstBatch.visitors).toHaveLength(10);
    expect(firstBatch.events.length).toBeGreaterThanOrEqual(10);

    // Verify classified sources
    const sourcesFound = firstBatch.sessions.map((s) => s.source);
    expect(sourcesFound).toContain('Google');
    expect(sourcesFound).toContain('X');
  });

  it('handles single overview CSV with revenue and payments', () => {
    const overviewCsv = `date,visitors,pageviews,revenue,payments\n2024-05-01,5,10,198,2`;
    const parsedOverview = { filename: 'overview.csv', ...parseCsv(overviewCsv) };

    const { days, summary } = aggregateDatafastFiles([parsedOverview], 'USD');
    expect(summary.totalRevenue).toBe(19800); // 198 dollars in cents
    expect(summary.totalPayments).toBe(2);

    const batches = generateMinilyticsImport(days, 'test_site', 'test.com', 'USD', 5);
    expect(batches[0].payments).toHaveLength(2);
    expect(batches[0].payments[0].amount + batches[0].payments[1].amount).toBe(19800);
  });
});

describe('handleImportBatch and handleClearDatafastImport', () => {
  it('executes batch inserts and clear statements', async () => {
    const executedBatches: any[][] = [];
    const mockDb = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) {
            return { sql, args };
          },
        };
      },
      async batch(stmts: any[]) {
        executedBatches.push(stmts);
        return stmts.map(() => ({}));
      },
    };

    const mockSite = { id: 'test_site', domain: 'test.com', currency: 'USD', created_at: 1700000000000 };
    const { handleImportBatch, handleClearDatafastImport } = await import('../src/worker/importer');

    let jsonResponse: any = null;
    const mockCtx = {
      get: (key: string) => (key === 'site' ? mockSite : null),
      env: { DB: mockDb },
      req: {
        async json() {
          return {
            earliestTs: 1600000000000,
            visitors: [{ id: 'v1', first_seen: 1600000000000 }],
            sessions: [{
              id: 's1',
              visitor_id: 'v1',
              started_at: 1600000000000,
              last_seen_at: 1600000060000,
              duration: 60000,
              pageviews: 1,
              goals: 0,
              hostname: 'test.com',
              entry_page: '/',
              exit_page: '/',
              source: 'Google',
              channel: 'Organic Search',
            }],
            events: [{
              session_id: 's1',
              visitor_id: 'v1',
              ts: 1600000000000,
              type: 'pageview',
              path: '/',
            }],
            payments: [{
              id: 'pay1',
              provider: 'datafast',
              ts: 1600000060000,
              amount: 4900,
              currency: 'USD',
            }],
          };
        },
      },
      json: (data: any, status?: number) => {
        jsonResponse = { data, status };
        return jsonResponse;
      },
    } as any;

    const res = (await handleImportBatch(mockCtx)) as any;
    expect(res.data.ok).toBe(true);
    expect(res.data.inserted.sessions).toBe(1);
    expect(res.data.inserted.visitors).toBe(1);
    expect(res.data.inserted.events).toBe(1);
    expect(res.data.inserted.payments).toBe(1);
    expect(executedBatches.length).toBeGreaterThan(0);

    // Test clear
    executedBatches.length = 0;
    const clearRes = (await handleClearDatafastImport(mockCtx)) as any;
    expect(clearRes.data.ok).toBe(true);
    expect(executedBatches.length).toBe(1);
    expect(executedBatches[0]).toHaveLength(4); // 4 delete statements
  });
});


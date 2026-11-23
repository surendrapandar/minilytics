#!/usr/bin/env node
/**
 * CLI tool to import historical data from DataFast or Plausible into Minilytics.
 * Usage:
 *   node scripts/import-datafast.mjs --site <siteId> <export.zip or file.csv...>
 *   node scripts/import-datafast.mjs --site <siteId> --remote <export.zip>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { unzipSync } from 'fflate';
import {
  parseCsv,
  aggregateDatafastFiles,
  generateMinilyticsImport,
} from '../src/shared/importDatafast.ts';

const args = process.argv.slice(2);
let siteId = '';
let isRemote = false;
const files = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--site' && args[i + 1]) {
    siteId = args[++i];
  } else if (args[i] === '--remote') {
    isRemote = true;
  } else if (args[i] === '--local') {
    isRemote = false;
  } else if (!args[i].startsWith('-')) {
    files.push(args[i]);
  }
}

if (!siteId || files.length === 0) {
  console.log(`
Usage:
  node scripts/import-datafast.mjs --site <site-id> [--remote] <path-to-file.zip or .csv files...>

Examples:
  node scripts/import-datafast.mjs --site my_site_123 ./datafast-export.zip
  node scripts/import-datafast.mjs --site my_site_123 --remote ./visitors.csv ./sources.csv
`);
  process.exit(1);
}

console.log(`\n📦 Minilytics DataFast Importer`);
console.log(`Site ID: ${siteId}`);
console.log(`Target: ${isRemote ? 'Remote (Production Cloudflare D1)' : 'Local (--local)'}\n`);

const parsedFiles = [];

for (const filePath of files) {
  const fullPath = resolve(process.cwd(), filePath);
  const buf = readFileSync(fullPath);

  if (filePath.endsWith('.zip')) {
    console.log(`Extracting ZIP: ${basename(filePath)}...`);
    const unzipped = unzipSync(new Uint8Array(buf));
    const decoder = new TextDecoder();
    for (const [name, data] of Object.entries(unzipped)) {
      if (name.toLowerCase().endsWith('.csv') && !name.includes('__MACOSX')) {
        const text = decoder.decode(data);
        const { headers, rows } = parseCsv(text);
        if (rows.length > 0) {
          const fn = basename(name);
          console.log(`  - Found ${fn} (${rows.length} rows)`);
          parsedFiles.push({ filename: fn, headers, rows });
        }
      }
    }
  } else if (filePath.endsWith('.csv')) {
    const text = buf.toString('utf-8');
    const { headers, rows } = parseCsv(text);
    if (rows.length > 0) {
      const fn = basename(filePath);
      console.log(`Read CSV: ${fn} (${rows.length} rows)`);
      parsedFiles.push({ filename: fn, headers, rows });
    }
  }
}

if (parsedFiles.length === 0) {
  console.error('❌ No CSV data found to import.');
  process.exit(1);
}

console.log(`\nAggregating metrics...`);
const { days, summary } = aggregateDatafastFiles(parsedFiles);

console.log(`\n📊 Data Summary:`);
console.log(`  Date Range: ${summary.dateRange?.from} → ${summary.dateRange?.to} (${summary.totalDays} days)`);
console.log(`  Visitors:   ${summary.totalVisitors.toLocaleString()}`);
console.log(`  Pageviews:  ${summary.totalPageviews.toLocaleString()}`);
console.log(`  Revenue:    $${(summary.totalRevenue / 100).toFixed(2)} (${summary.totalPayments} payments)`);

console.log(`\nSynthesizing records for Minilytics...`);
const batches = generateMinilyticsImport(days, siteId, 'domain.com', 'USD', 500);

const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const sqlStatements = [];

// Update site.created_at if earliest data is older
if (summary.dateRange?.from) {
  const earliestTs = new Date(summary.dateRange.from).getTime();
  sqlStatements.push(`UPDATE sites SET created_at = MIN(created_at, ${earliestTs}) WHERE id = ${q(siteId)};`);
}

for (const batch of batches) {
  for (const v of batch.visitors) {
    sqlStatements.push(`INSERT OR IGNORE INTO visitors (site_id, id, first_seen, name, email) VALUES (${q(siteId)}, ${q(v.id)}, ${v.first_seen}, ${q(v.name)}, ${q(v.email)});`);
  }
  for (const s of batch.sessions) {
    sqlStatements.push(
      `INSERT OR REPLACE INTO sessions (site_id, id, visitor_id, started_at, last_seen_at, duration, pageviews, goals, hostname, entry_page, exit_page, referrer, referrer_domain, source, channel, country, city, browser, os, device) VALUES (${q(siteId)}, ${q(s.id)}, ${q(s.visitor_id)}, ${s.started_at}, ${s.last_seen_at}, ${s.duration}, ${s.pageviews}, ${s.goals}, ${q(s.hostname)}, ${q(s.entry_page)}, ${q(s.exit_page)}, ${q(s.referrer)}, ${q(s.referrer_domain)}, ${q(s.source)}, ${q(s.channel)}, ${q(s.country)}, ${q(s.city)}, ${q(s.browser)}, ${q(s.os)}, ${q(s.device)});`
    );
  }
  for (const e of batch.events) {
    sqlStatements.push(`INSERT INTO events (site_id, session_id, visitor_id, ts, type, name, path) VALUES (${q(siteId)}, ${q(e.session_id)}, ${q(e.visitor_id)}, ${e.ts}, ${q(e.type)}, ${q(e.name)}, ${q(e.path)});`);
  }
  for (const p of batch.payments) {
    sqlStatements.push(`INSERT OR REPLACE INTO payments (id, site_id, provider, ts, amount, kind, currency, visitor_id, session_id, customer_id, email, name) VALUES (${q(p.id)}, ${q(siteId)}, ${q(p.provider)}, ${p.ts}, ${p.amount}, ${q(p.kind)}, ${q(p.currency)}, ${q(p.visitor_id)}, ${q(p.session_id)}, ${q(p.customer_id)}, ${q(p.email)}, ${q(p.name)});`);
  }
}

mkdirSync('.wrangler', { recursive: true });
const sqlPath = resolve(process.cwd(), `.wrangler/import-${siteId}.sql`);
writeFileSync(sqlPath, sqlStatements.join('\n'));
console.log(`\nGenerated ${sqlStatements.length} SQL statements in:`);
console.log(`  ${sqlPath}`);

const targetFlag = isRemote ? '--remote' : '--local';
console.log(`\nExecuting into D1 (${targetFlag})...`);
try {
  execSync(`npx wrangler d1 execute minilytics ${targetFlag} --file "${sqlPath}"`, { stdio: 'inherit' });
  console.log(`\n✅ Successfully imported data into ${siteId}!`);
} catch (err) {
  console.error(`\n❌ Failed to execute into D1. You can run the SQL manually:`);
  console.error(`   npx wrangler d1 execute minilytics ${targetFlag} --file "${sqlPath}"`);
}

import { useState, useRef, type DragEvent, type ChangeEvent } from 'react';
import { unzip } from 'fflate';
import { api, type Site } from '../lib/api';
import {
  parseCsv,
  aggregateDatafastFiles,
  generateMinilyticsImport,
  type ImportPreviewSummary,
  type DayData,
} from '../../shared/importDatafast';

interface Props {
  site: Site;
  onSuccess?: () => void;
}

export function DatafastImport({ site, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<{
    summary: ImportPreviewSummary;
    days: Map<string, DayData>;
  } | null>(null);
  const [completed, setCompleted] = useState<{
    visitors: number;
    pageviews: number;
    revenue: number;
    payments: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function processFiles(files: FileList | File[]) {
    setError('');
    setCompleted(null);
    setLoading(true);
    setStatusMessage('Reading files...');

    try {
      const parsedFiles: { filename: string; headers: string[]; rows: Record<string, string>[] }[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.name.endsWith('.zip')) {
          setStatusMessage(`Unzipping ${file.name}...`);
          const buf = await file.arrayBuffer();
          const unzipped = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
            unzip(new Uint8Array(buf), (err, res) => {
              if (err) reject(err);
              else resolve(res);
            });
          });

          const decoder = new TextDecoder();
          for (const [filename, data] of Object.entries(unzipped)) {
            if (filename.toLowerCase().endsWith('.csv') && !filename.includes('__MACOSX')) {
              const text = decoder.decode(data);
              const { headers, rows } = parseCsv(text);
              if (rows.length > 0) {
                const baseName = filename.split('/').pop() || filename;
                parsedFiles.push({ filename: baseName, headers, rows });
              }
            }
          }
        } else if (file.name.toLowerCase().endsWith('.csv')) {
          const text = await file.text();
          const { headers, rows } = parseCsv(text);
          if (rows.length > 0) {
            parsedFiles.push({ filename: file.name, headers, rows });
          }
        }
      }

      if (parsedFiles.length === 0) {
        throw new Error('No valid CSV data found in the selected file(s). Upload a DataFast .csv or .zip export.');
      }

      setStatusMessage('Analyzing data...');
      const { days, summary } = aggregateDatafastFiles(parsedFiles, site.currency);

      if (summary.totalDays === 0 || summary.totalVisitors === 0) {
        throw new Error('Could not extract visitor or event rows from the uploaded file(s).');
      }

      setPreview({ summary, days });
      setStatusMessage('');
    } catch (e) {
      setError((e as Error).message);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }

  async function startImport() {
    if (!preview) return;
    setError('');
    setLoading(true);
    setProgress(0);

    try {
      setStatusMessage('Preparing batches...');
      // 100 sessions per batch to stay comfortably within D1 and Worker time limits
      const batches = generateMinilyticsImport(preview.days, site.id, site.domain, site.currency, 100);

      let totalSessions = 0;
      for (let i = 0; i < batches.length; i++) {
        setStatusMessage(`Importing batch ${i + 1} of ${batches.length}...`);
        await api(`/api/sites/${site.id}/import/datafast`, {
          method: 'POST',
          json: batches[i],
        });
        totalSessions += batches[i].sessions.length;
        setProgress(Math.round(((i + 1) / batches.length) * 100));
      }

      setCompleted({
        visitors: preview.summary.totalVisitors,
        pageviews: preview.summary.totalPageviews,
        revenue: preview.summary.totalRevenue,
        payments: preview.summary.totalPayments,
      });

      setPreview(null);
      setProgress(null);
      setStatusMessage('');
      onSuccess?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function clearImportedData() {
    if (!confirm('Are you sure you want to delete all historical data imported from DataFast? Real-time visits recorded by Minilytics will NOT be touched.')) {
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api(`/api/sites/${site.id}/import/datafast`, { method: 'DELETE' });
      setCompleted(null);
      alert('DataFast imported data cleared successfully.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
  }

  return (
    <div className="space-y-4">
      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragOver ? 'border-amber-500 bg-amber-50/50' : 'border-stone-200 hover:border-stone-400 bg-stone-50/50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".csv,.zip"
          onChange={handleFileChange}
          className="hidden"
        />
        <svg
          className="h-10 w-10 text-stone-400 mb-2"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p className="text-sm font-medium text-stone-700">
          Drop your DataFast or Plausible <code className="text-xs bg-stone-200 px-1 py-0.5 rounded">.zip</code> or <code className="text-xs bg-stone-200 px-1 py-0.5 rounded">.csv</code> files here
        </p>
        <p className="mt-1 text-xs text-stone-500">
          Or click to browse files. Supports individual report CSVs or full export archives.
        </p>
      </div>

      {loading && (
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="flex items-center justify-between text-sm text-stone-600 mb-2">
            <span>{statusMessage || 'Processing...'}</span>
            {progress !== null && <span>{progress}%</span>}
          </div>
          {progress !== null && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-stone-100">
              <div
                className="h-full bg-amber-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Preview Card */}
      {preview && !loading && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-stone-800 text-sm">Ready to import</h4>
            <span className="text-xs font-medium text-stone-500">
              {preview.summary.totalDays} days detected ({preview.summary.dateRange?.from} → {preview.summary.dateRange?.to})
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
            <div className="rounded-lg bg-white p-2.5 shadow-sm border border-stone-100">
              <div className="text-stone-500">Visitors</div>
              <div className="text-base font-semibold text-stone-900 mt-0.5">
                {preview.summary.totalVisitors.toLocaleString()}
              </div>
            </div>
            <div className="rounded-lg bg-white p-2.5 shadow-sm border border-stone-100">
              <div className="text-stone-500">Pageviews</div>
              <div className="text-base font-semibold text-stone-900 mt-0.5">
                {preview.summary.totalPageviews.toLocaleString()}
              </div>
            </div>
            <div className="rounded-lg bg-white p-2.5 shadow-sm border border-stone-100">
              <div className="text-stone-500">Revenue</div>
              <div className="text-base font-semibold text-emerald-600 mt-0.5">
                {site.currency} {(preview.summary.totalRevenue / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="rounded-lg bg-white p-2.5 shadow-sm border border-stone-100">
              <div className="text-stone-500">Payments</div>
              <div className="text-base font-semibold text-stone-900 mt-0.5">
                {preview.summary.totalPayments.toLocaleString()}
              </div>
            </div>
          </div>

          <div className="text-xs text-stone-500">
            Files analyzed: {preview.summary.detectedFiles.map((f) => `${f.name} (${f.rowCount} rows)`).join(', ')}
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={startImport}
              className="btn-dark text-xs py-1.5 px-3"
            >
              Start Import
            </button>
            <button
              onClick={() => setPreview(null)}
              className="btn text-xs py-1.5 px-3"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Completion Card */}
      {completed && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
          <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm">
            <svg className="w-5 h-5 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            Import Complete!
          </div>
          <p className="text-xs text-emerald-700">
            Successfully imported {completed.visitors.toLocaleString()} visitors, {completed.pageviews.toLocaleString()} pageviews
            {completed.revenue > 0 ? ` and ${site.currency} ${(completed.revenue / 100).toFixed(2)} in revenue.` : '.'}
          </p>
          <div className="pt-2">
            <a
              href={`/site/${site.id}?period=all`}
              className="inline-block text-xs font-semibold bg-emerald-700 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-800 transition-colors"
            >
              View in Dashboard (All Time) →
            </a>
          </div>
        </div>
      )}

      {/* Clear imported data option */}
      <div className="pt-2">
        <details className="text-xs text-stone-500">
          <summary className="cursor-pointer hover:text-stone-700 font-medium">
            Manage imported data
          </summary>
          <div className="mt-2 p-3 bg-stone-100 rounded-lg space-y-2">
            <p>
              Uploaded the wrong file or want to re-import? You can clear only data imported from DataFast without affecting real tracking visits.
            </p>
            <button
              onClick={clearImportedData}
              disabled={loading}
              className="text-xs px-2.5 py-1 text-red-600 bg-white border border-red-200 rounded hover:bg-red-50 font-medium transition-colors"
            >
              Clear imported DataFast data
            </button>
          </div>
        </details>
      </div>
    </div>
  );
}

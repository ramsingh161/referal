"use client";

import { useActionState, useRef, useState } from "react";

import { uploadConnections, type UploadState } from "../actions";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

/**
 * The connections-file upload.
 *
 * This is the highest-friction moment in the whole product — the user has to
 * leave, wait for LinkedIn to email them, come back, and hand over a file about
 * other people. So the copy does two jobs the UI cannot: it says exactly where
 * the file comes from, and it says what happens to it.
 */
export function CsvDropzone({ hasExistingConnections }: { hasExistingConnections: boolean }) {
  const [state, formAction, isPending] = useActionState<UploadState, FormData>(
    uploadConnections,
    { status: "idle" },
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  function acceptDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);

    const dropped = event.dataTransfer.files;
    if (dropped.length === 0 || !inputRef.current) return;

    // Hand the drop to the real file input so the form submits it the ordinary
    // way — no parallel state, and the input stays the single source of truth.
    inputRef.current.files = dropped;
    setFileName(dropped[0]?.name ?? null);
  }

  return (
    <div>
      <form action={formAction}>
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={acceptDrop}
          className={cn(
            "border border-dashed p-8 text-center transition-colors duration-100",
            isDragging
              ? "border-signal bg-signal-soft/50"
              : "border-hairline bg-paper/40",
          )}
        >
          <input
            ref={inputRef}
            id="connections-file"
            type="file"
            name="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
          />

          {fileName === null ? (
            <>
              <p className="text-sm text-ink-soft">
                Drop{" "}
                <span className="font-mono text-[0.8rem] text-ink">Connections.csv</span>{" "}
                here
              </p>
              <label
                htmlFor="connections-file"
                className="mt-4 inline-flex h-10 cursor-pointer items-center justify-center rounded-[3px] border border-hairline bg-surface px-4 text-sm font-medium text-ink transition-colors duration-100 hover:border-ink hover:bg-paper"
              >
                Choose file
              </label>
            </>
          ) : (
            <>
              <p className="font-mono text-sm text-ink">{fileName}</p>
              <div className="mt-4 flex items-center justify-center gap-3">
                <Button type="submit" variant="solid" disabled={isPending}>
                  {isPending ? "Importing…" : "Import connections"}
                </Button>
                <label
                  htmlFor="connections-file"
                  className="cursor-pointer text-sm text-muted underline underline-offset-2 hover:text-ink"
                >
                  Pick a different file
                </label>
              </div>
            </>
          )}
        </div>
      </form>

      {state.status === "error" && (
        <Notice tone="caution" className="mt-4" role="alert">
          {state.message}
        </Notice>
      )}

      {state.status === "success" && <ImportSummaryReport summary={state.summary} />}

      {state.status === "idle" && hasExistingConnections && (
        <p className="mt-4 text-sm text-muted">
          Uploading again refreshes job titles and adds anyone new. Nobody already
          imported is removed.
        </p>
      )}
    </div>
  );
}

type Summary = Extract<UploadState, { status: "success" }>["summary"];

function ImportSummaryReport({ summary }: { summary: Summary }) {
  const stats: [string, string][] = [
    ["Connections stored", summary.storedTotal.toLocaleString()],
    ["Companies to check", summary.distinctCompanies.toLocaleString()],
    ["New this upload", summary.created.toLocaleString()],
    ["Refreshed", summary.updated.toLocaleString()],
  ];

  return (
    <div className="mt-5 border border-conduit/30 bg-conduit-soft/40 p-5">
      <p className="label text-conduit">Imported</p>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dd className="font-heading text-2xl font-bold tracking-tight text-ink">
              {value}
            </dd>
            <dt className="mt-0.5 text-xs text-muted">{label}</dt>
          </div>
        ))}
      </dl>

      {summary.withoutCompany > 0 && (
        <p className="mt-4 text-sm text-ink-soft">
          {summary.withoutCompany.toLocaleString()}{" "}
          {summary.withoutCompany === 1 ? "connection has" : "connections have"} no
          company listed in the export, so we can't check a job board for them.
        </p>
      )}

      {(summary.skipped.unnamed > 0 || summary.skipped.duplicate > 0) && (
        <p className="mt-2 text-sm text-muted">
          Skipped {summary.skipped.duplicate.toLocaleString()} duplicate and{" "}
          {summary.skipped.unnamed.toLocaleString()} unnamed{" "}
          {summary.skipped.unnamed === 1 ? "row" : "rows"} out of{" "}
          {summary.totalRows.toLocaleString()}.
        </p>
      )}

      {summary.warnings.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-muted hover:text-ink">
            {summary.warnings.length} row
            {summary.warnings.length === 1 ? "" : "s"} we couldn't fully read
          </summary>
          <ul className="mt-3 space-y-1.5 text-sm text-muted">
            {summary.warnings.map((warning) => (
              <li key={`${warning.dataRow}-${warning.reason}`}>
                Row {warning.dataRow}: {warning.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

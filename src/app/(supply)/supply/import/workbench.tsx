"use client";

import { useState } from "react";
import { beginSupplyUpload, processSupplyUpload } from "@/features/supply/actions";
import { createClient } from "@/lib/supabase/client";
import { aggregateImport, guessColumns, parseCsv, type ImportKind, type ImportMapping } from "@/lib/supply/csv";

export function ImportWorkbench({
  mappings,
}: {
  mappings: { id: string; name: string; kind: string; columns: Record<string, string>; dateFormat: string; delimiter: string }[];
}) {
  const [mappingId, setMappingId] = useState(mappings[0]?.id ?? "");
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");

  const mapping = mappings.find((item) => item.id === mappingId);

  return (
    <div className="space-y-4">
      <label className="block text-sm font-semibold">
        Mapping
        <select value={mappingId} onChange={(event) => setMappingId(event.target.value)} className="mt-1 h-11 w-full rounded-2xl border border-line bg-field px-3 text-base">
          {mappings.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="block text-sm font-semibold">
        File
        <input
          type="file"
          accept=".csv,text/csv"
          className="mt-1 block min-h-11 w-full text-sm"
          onChange={async (event) => {
            const next = event.target.files?.[0] ?? null;
            setFile(next);
            setMessage("");
            if (!next || !mapping) return;
            const text = await next.text();
            const chosen: ImportMapping = {
              kind: mapping.kind as ImportKind,
              columns: mapping.columns,
              dateFormat: mapping.dateFormat as ImportMapping["dateFormat"],
              delimiter: mapping.delimiter === "\t" ? "\t" : mapping.delimiter === ";" ? ";" : ",",
            };
            const headers = parseCsv(text, chosen.delimiter)[0] ?? [];
            const columns = Object.keys(chosen.columns).length > 0 ? chosen.columns : guessColumns(headers, chosen.kind);
            setPreview(aggregateImport(text, { ...chosen, columns }, () => "preview").preview);
          }}
        />
      </label>
      {preview.length > 0 ? (
        <div className="grid gap-2">
          {preview.map((row, index) => (
            <p key={index} className="truncate text-sm text-grey">{Object.values(row).join(" · ")}</p>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="inline-flex min-h-11 items-center rounded-full bg-red px-4 text-sm font-semibold text-white"
        onClick={async () => {
          if (!file || !mapping) return;
          setMessage("Uploading");
          const started = await beginSupplyUpload(mapping.id, file.name);
          if ("error" in started && started.error) {
            setMessage(started.error);
            return;
          }
          if (!("token" in started) || !started.token || !started.path || !started.batchId) return;
          if (started.token !== "fixture") {
            const uploaded = await createClient().storage.from("supply-imports").uploadToSignedUrl(started.path, started.token, file, { contentType: "text/csv" });
            if (uploaded.error) {
              setMessage("Could not upload that file.");
              return;
            }
          }
          const chosen: ImportMapping = {
            kind: mapping.kind as ImportKind,
            columns: mapping.columns,
            dateFormat: mapping.dateFormat as ImportMapping["dateFormat"],
            delimiter: mapping.delimiter === "\t" ? "\t" : mapping.delimiter === ";" ? ";" : ",",
          };
          const done = await processSupplyUpload(started.batchId, chosen);
          setMessage(done && "error" in done && done.error ? done.error : "Imported");
        }}
      >
        Upload
      </button>
      {message ? <p className="text-sm">{message}</p> : null}
    </div>
  );
}

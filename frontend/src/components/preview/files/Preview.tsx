"use client";

import { FileText } from "lucide-react";
import * as React from "react";

import {
  fetchFileBytes,
  getSlug,
  watchPaste,
  type FileMeta,
} from "@/lib/api";

import { DownloadButton } from "./Download";

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${sizes[i]}`;
}


function ImageCard({ file, index }: { file: FileMeta; index: number }) {
  const [url, setUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    let obj: string | null = null;
    fetchFileBytes(getSlug(), index)
      .then((bytes) => {
        obj = URL.createObjectURL(new Blob([bytes], { type: file.type }));
        if (live) setUrl(obj);
      })
      .catch(() => {});
    return () => {
      live = false;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [index, file.type]);

  if (!url) {
    return <div className="group relative aspect-square w-32 min-w-28 shrink-0 overflow-hidden rounded-2xl bg-muted p-4 animate-pulse" />;
  }

  return (
    <div
      title={file.name}
      className="group relative aspect-square w-32 min-w-28 shrink-0 overflow-hidden rounded-2xl border-none p-0"
    >
      <img src={url} alt={file.name} loading="lazy" className="size-full object-cover" />
      <DownloadButton file={file} index={index} />
    </div>
  );
}

function FileCard({ file, index }: { file: FileMeta; index: number }) {
  const isImage = file.type.startsWith("image/");
  if (isImage) return <ImageCard file={file} index={index} />;

  return (
    <div
      title={file.name}
      className="group relative aspect-square w-32 min-w-28 shrink-0 overflow-hidden rounded-2xl border border-line bg-muted p-4"
    >
      <div className="flex h-full w-full flex-col items-start gap-1">
        <span className="line-clamp-2 text-sm font-medium">{file.name}</span>
        <div className="mt-auto flex w-full items-center gap-2 whitespace-nowrap">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <FileText className="size-3.5 shrink-0 text-danger" />
            {file.name.split(".").pop()?.toUpperCase()}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatBytes(file.size)}
          </span>
        </div>
      </div>
      <DownloadButton file={file} index={index} />
    </div>
  );
}

type State = "loading" | "locked" | "error" | FileMeta[];

export function FilePreview() {
  const [state, setState] = React.useState<State>("loading");

  React.useEffect(
    () =>
      watchPaste(
        (paste) => setState(paste.filesMeta ?? "locked"),
        () => setState("error"),
      ),
    [],
  );

  if (state === "loading" || state === "error") return null;

  if (state === "locked") {
    return (
      <p className="font-ibm text-sm text-muted-foreground">
        Unlock to see files
      </p>
    );
  }

  if (state.length === 0) {
    return (
      <p className="font-ibm text-sm text-muted-foreground">No files attached</p>
    );
  }

  return (
    <div className="flex flex-wrap justify-center gap-2 p-1.5">
      {state.map((file, index) => (
        <FileCard key={index} file={file} index={index} />
      ))}
    </div>
  );
}
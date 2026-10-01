"use client";

import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { downloadFile } from "../../../lib/payload/download";
import type { FileMeta } from "../../../lib/payload/collect";

export function DownloadButton({
  file,
  index,
}: {
  file: FileMeta;
  index: number;
}) {
  return (
    <Button
      variant="secondary"
      size="icon"
      title={`Download ${file.name}`}
      onClick={() => void downloadFile(file, index)}
      className="absolute top-2 right-2 size-7 rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
    >
      <Download className="size-3.5" />
    </Button>
  );
}
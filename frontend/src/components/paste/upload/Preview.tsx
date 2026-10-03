"use client";

import { FileText, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadItemProgress,
  FileUploadList,
} from "@/components/ui/file-upload";

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${sizes[i]}`;
}

function ImagePreview() {
  return (
    <FileUploadItemPreview className="size-full rounded-none border-none bg-transparent p-0">
      <FileUploadItemProgress size={40} />
    </FileUploadItemPreview>
  );
}

function GenericFilePreview({ file }: { file: File }) {
  return (
    <>
      <FileUploadItemPreview className="absolute inset-0 size-full border-none bg-transparent p-0 [&>svg]:hidden">
        <FileUploadItemProgress size={40} />
      </FileUploadItemPreview>
      <FileUploadItemMetadata className="h-full w-full">
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
      </FileUploadItemMetadata>
    </>
  );
}

function DeleteButton() {
  return (
    <FileUploadItemDelete
      render={(props) => (
        <Button
          variant="secondary"
          size="icon"
          className="absolute top-2 right-2 size-7 rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
          {...props}
        >
          <X className="size-3.5" />
        </Button>
      )}
    />
  );
}

function FileCard({ file }: { file: File }) {
  const isImage = file.type.startsWith("image/");

  return (
    <FileUploadItem
      value={file}
      title={file.name}
      className={`group relative aspect-square w-32 min-w-28 shrink-0 overflow-hidden rounded-2xl ${
        isImage
          ? "border-none p-0"
          : "flex-col items-start justify-center gap-1 border-line bg-muted p-4"
      }`}
    >
      {isImage ? <ImagePreview /> : <GenericFilePreview file={file} />}
      <DeleteButton />
    </FileUploadItem>
  );
}

export function FilePreviewList({ files }: { files: File[] }) {
  return (
    <FileUploadList
      orientation="horizontal"
      className="flex-wrap justify-center overflow-x-visible"
    >
      {files.map((file, index) => (
        <FileCard key={index} file={file} />
      ))}
    </FileUploadList>
  );
}

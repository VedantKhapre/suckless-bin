"use client";

import { Upload } from "lucide-react";
import * as React from "react";
import { Toaster, toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  FileUpload as FileUploadRoot,
  FileUploadDropzone,
  FileUploadTrigger,
} from "@/components/ui/file-upload";

import { FilePreviewList } from "./Preview";

let currentFiles: File[] = [];
export const getFiles = () => currentFiles;

export function FileUpload() {
  const [files, setFiles] = React.useState<File[]>([]);

  const handleChange = (next: File[]) => {
    currentFiles = next;
    setFiles(next);
  };
  
  const onUpload = React.useCallback(
    async (
      files: File[],
      {
        onProgress,
        onSuccess,
        onError,
      }: {
        onProgress: (file: File, progress: number) => void;
        onSuccess: (file: File) => void;
        onError: (file: File, error: Error) => void;
      },
    ) => {
      try {
        const uploadPromises = files.map(async (file) => {
          try {
            const totalChunks = 10;
            let uploadedChunks = 0;

            for (let i = 0; i < totalChunks; i++) {
              await new Promise((resolve) =>
                setTimeout(resolve, Math.random() * 200 + 100),
              );
              uploadedChunks++;
              onProgress(file, (uploadedChunks / totalChunks) * 100);
            }

            await new Promise((resolve) => setTimeout(resolve, 500));
            onSuccess(file);
          } catch (error) {
            onError(
              file,
              error instanceof Error ? error : new Error("Upload failed"),
            );
          }
        });

        await Promise.all(uploadPromises);
      } catch (error) {
        console.error("Unexpected error during upload:", error);
      }
    },
    [],
  );

  const onFileReject = React.useCallback((file: File, message: string) => {
    toast(message, {
      description: `"${file.name.length > 20 ? `${file.name.slice(0, 20)}...` : file.name}" has been rejected`,
    });
  }, []);

  return (
    <>
      <Toaster position="bottom-left" />
      <FileUploadRoot
        value={files}
        onValueChange={handleChange}
        maxFiles={5}
        maxSize={10 * 1024 * 1024}
        className="w-full max-w-md"
        onUpload={onUpload}
        onFileReject={onFileReject}
        multiple
      >
        <FileUploadDropzone>
          <div className="flex flex-col items-center gap-1 text-center">
            <div className="flex items-center justify-center rounded-full border border-line p-2.5">
              <Upload className="size-6 text-muted-foreground" />
            </div>
            <p className="text-base font-ibm">Drag & drop files here</p>
          <p className="text-sm font-ibm text-muted-foreground">
            Or Browse files (max 5, 10 MB each)
          </p>
        </div>
        <FileUploadTrigger
          render={(props) => (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-fit border-line"
              {...props}
            >
              Browse files
            </Button>
          )}
        />
      </FileUploadDropzone>

      <FilePreviewList files={files} />
    </FileUploadRoot>
    </>
  );
}

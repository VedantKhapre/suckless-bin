import { fetchFileBytes, getSlug, type FileMeta } from "@/lib/api";

/** Fetch an attached file and hand it to the browser's save dialog. */
export async function downloadFile(file: FileMeta, index: number) {
  const bytes = await fetchFileBytes(getSlug(), index);
  const url = URL.createObjectURL(new Blob([bytes], { type: file.type }));

  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
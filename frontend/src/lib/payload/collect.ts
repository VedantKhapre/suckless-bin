import { getPasteText, getLanguage } from "@/components/paste/editor/editor";
import { getFiles } from "@/components/paste/upload/Upload";

export type FileMeta = {
  name: string;
  size: number;
  type: string;
  lastModified: number;
};

export type Collected = {
  files: File[];
  filesMeta: FileMeta[];
  text: string;
  totalChars: number;
  language: string;
  title: string;
  expiration: string;
  visibility: "public" | "private";
  password: string | null;
};

const value = (selector: string) =>
  document.querySelector<HTMLInputElement>(selector)?.value ?? "";

export function collect(): Collected {
  const files = getFiles();
  const text = getPasteText();
  const visibility =
    value('input[name="visibility"]:checked') === "private"
      ? "private"
      : "public";

  return {
    files,
    filesMeta: files.map(({ name, size, type, lastModified }) => ({
      name,
      size,
      type,
      lastModified,
    })),
    text,
    totalChars: text.length,
    language: getLanguage(),
    title: value("#title").trim(),
    expiration: value('input[name="expiration"]:checked'),
    visibility,
    password: visibility === "private" ? value("#password") : null,
  };
}

export function validate(c: Collected): string[] {
  const errors: string[] = [];

  if (!c.title) errors.push("Title is required");
  if (!c.text.trim()) errors.push("Paste area is empty");
  if (c.visibility === "private" && (c.password ?? "").length < 8) {
    errors.push("Password must be 8+ characters");
  }

  return errors;
}
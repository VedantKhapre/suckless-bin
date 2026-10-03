"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "cn";
import * as React from "react";

import { useAsRef } from "@/components/hooks/use-as-ref";
import { useLazyRef } from "@/components/hooks/use-lazy-ref";
import { useDirection } from "@/components/ui/direction";

const ROOT_NAME = "FileUpload";
const DROPZONE_NAME = "FileUploadDropzone";
const TRIGGER_NAME = "FileUploadTrigger";
const LIST_NAME = "FileUploadList";
const ITEM_NAME = "FileUploadItem";
const ITEM_PREVIEW_NAME = "FileUploadItemPreview";
const ITEM_METADATA_NAME = "FileUploadItemMetadata";
const ITEM_PROGRESS_NAME = "FileUploadItemProgress";
const ITEM_DELETE_NAME = "FileUploadItemDelete";

type Direction = "ltr" | "rtl";

interface FileState {
  file: File;
  progress: number;
  error?: string;
  status: "idle" | "uploading" | "error" | "success";
}

interface StoreState {
  files: Map<File, FileState>;
  dragOver: boolean;
  invalid: boolean;
}

type StoreAction =
  | { type: "ADD_FILES"; files: File[] }
  | { type: "SET_FILES"; files: File[] }
  | { type: "SET_PROGRESS"; file: File; progress: number }
  | { type: "SET_SUCCESS"; file: File }
  | { type: "SET_ERROR"; file: File; error: string }
  | { type: "REMOVE_FILE"; file: File }
  | { type: "SET_DRAG_OVER"; dragOver: boolean }
  | { type: "SET_INVALID"; invalid: boolean };

type Store = {
  getState: () => StoreState;
  dispatch: (action: StoreAction) => void;
  subscribe: (listener: () => void) => () => void;
};

const StoreContext = React.createContext<Store | null>(null);

function useStoreContext(consumerName: string) {
  const context = React.useContext(StoreContext);
  if (!context) {
    throw new Error(`\`${consumerName}\` must be used within \`${ROOT_NAME}\``);
  }
  return context;
}

function useStore<T>(selector: (state: StoreState) => T): T {
  const store = useStoreContext("useStore");

  const lastValueRef = useLazyRef<{ value: T; state: StoreState } | null>(
    () => null,
  );

  const getSnapshot = React.useCallback(() => {
    const state = store.getState();
    const prevValue = lastValueRef.current;

    if (prevValue && prevValue.state === state) {
      return prevValue.value;
    }

    const nextValue = selector(state);
    lastValueRef.current = { value: nextValue, state };
    return nextValue;
  }, [store, selector, lastValueRef]);

  return React.useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

interface FileUploadContextValue {
  inputId: string;
  dropzoneId: string;
  listId: string;
  labelId: string;
  dir: Direction;
  inputRef: React.RefObject<HTMLInputElement | null>;
  urlCache: WeakMap<File, string>;
}

const FileUploadContext = React.createContext<FileUploadContextValue | null>(
  null,
);

function useFileUploadContext(consumerName: string) {
  const context = React.useContext(FileUploadContext);
  if (!context) {
    throw new Error(`\`${consumerName}\` must be used within \`${ROOT_NAME}\``);
  }
  return context;
}

interface FileUploadProps extends Omit<
  React.ComponentProps<"div"> & useRender.ComponentProps<"div">,
  "defaultValue" | "onChange"
> {
  value?: File[];
  onValueChange?: (files: File[]) => void;
  onFileReject?: (file: File, message: string) => void;
  onUpload?: (
    files: File[],
    options: {
      onProgress: (file: File, progress: number) => void;
      onSuccess: (file: File) => void;
      onError: (file: File, error: Error) => void;
    },
  ) => Promise<void> | void;
  maxFiles?: number;
  maxSize?: number;
  multiple?: boolean;
}

function FileUpload(props: FileUploadProps) {
  const {
    value,
    onValueChange,
    onFileReject,
    onUpload,
    maxFiles,
    maxSize,
    render,
    multiple = false,
    children,
    className,
    ...rootProps
  } = props;

  const inputId = React.useId();
  const dropzoneId = React.useId();
  const listId = React.useId();
  const labelId = React.useId();

  const dir = useDirection();
  const listeners = useLazyRef(() => new Set<() => void>()).current;
  const files = useLazyRef<Map<File, FileState>>(() => new Map()).current;
  const urlCache = useLazyRef(() => new WeakMap<File, string>()).current;
  const inputRef = React.useRef<HTMLInputElement>(null);
  const isControlled = value !== undefined;

  const propsRef = useAsRef({ onValueChange, onFileReject, onUpload });

  const store = React.useMemo<Store>(() => {
    let state: StoreState = {
      files,
      dragOver: false,
      invalid: false,
    };

    function notifyValueChange() {
      propsRef.current.onValueChange?.(
        Array.from(files.values()).map((fileState) => fileState.file),
      );
    }

    function reducer(state: StoreState, action: StoreAction): StoreState {
      switch (action.type) {
        case "ADD_FILES": {
          for (const file of action.files) {
            files.set(file, { file, progress: 0, status: "idle" });
          }
          notifyValueChange();
          return { ...state, files };
        }

        case "SET_FILES": {
          const newFileSet = new Set(action.files);
          for (const existingFile of files.keys()) {
            if (!newFileSet.has(existingFile)) {
              files.delete(existingFile);
            }
          }

          for (const file of action.files) {
            if (!files.has(file)) {
              files.set(file, { file, progress: 0, status: "idle" });
            }
          }
          return { ...state, files };
        }

        case "SET_PROGRESS": {
          const fileState = files.get(action.file);
          if (fileState) {
            files.set(action.file, {
              ...fileState,
              progress: action.progress,
              status: "uploading",
            });
          }
          return { ...state, files };
        }

        case "SET_SUCCESS": {
          const fileState = files.get(action.file);
          if (fileState) {
            files.set(action.file, {
              ...fileState,
              progress: 100,
              status: "success",
            });
          }
          return { ...state, files };
        }

        case "SET_ERROR": {
          const fileState = files.get(action.file);
          if (fileState) {
            files.set(action.file, {
              ...fileState,
              error: action.error,
              status: "error",
            });
          }
          return { ...state, files };
        }

        case "REMOVE_FILE": {
          const cachedUrl = urlCache.get(action.file);
          if (cachedUrl) {
            URL.revokeObjectURL(cachedUrl);
            urlCache.delete(action.file);
          }

          files.delete(action.file);
          notifyValueChange();
          return { ...state, files };
        }

        case "SET_DRAG_OVER": {
          return { ...state, dragOver: action.dragOver };
        }

        case "SET_INVALID": {
          return { ...state, invalid: action.invalid };
        }

        default:
          return state;
      }
    }

    return {
      getState: () => state,
      dispatch: (action) => {
        state = reducer(state, action);
        for (const listener of listeners) {
          listener();
        }
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }, [listeners, files, propsRef, urlCache]);

  const onProgress = useLazyRef(() => {
    let frame = 0;
    return (file: File, progress: number) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        store.dispatch({
          type: "SET_PROGRESS",
          file,
          progress: Math.min(Math.max(0, progress), 100),
        });
      });
    };
  }).current;

  React.useEffect(() => {
    if (isControlled) {
      store.dispatch({ type: "SET_FILES", files: value });
    }
  }, [value, isControlled, store]);

  React.useEffect(() => {
    return () => {
      for (const file of files.keys()) {
        const cachedUrl = urlCache.get(file);
        if (cachedUrl) {
          URL.revokeObjectURL(cachedUrl);
        }
      }
    };
  }, [files, urlCache]);

  const onFilesUpload = React.useCallback(
    async (files: File[]) => {
      try {
        for (const file of files) {
          store.dispatch({ type: "SET_PROGRESS", file, progress: 0 });
        }

        if (propsRef.current.onUpload) {
          await propsRef.current.onUpload(files, {
            onProgress,
            onSuccess: (file) => {
              store.dispatch({ type: "SET_SUCCESS", file });
            },
            onError: (file, error) => {
              store.dispatch({
                type: "SET_ERROR",
                file,
                error: error.message ?? "Upload failed",
              });
            },
          });
        } else {
          for (const file of files) {
            store.dispatch({ type: "SET_SUCCESS", file });
          }
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Upload failed";
        for (const file of files) {
          store.dispatch({ type: "SET_ERROR", file, error: errorMessage });
        }
      }
    },
    [store, propsRef, onProgress],
  );

  const onFilesChange = React.useCallback(
    (originalFiles: File[]) => {
      let filesToProcess = [...originalFiles];
      let invalid = false;

      if (maxFiles) {
        const currentCount = store.getState().files.size;
        const remainingSlotCount = Math.max(0, maxFiles - currentCount);

        if (remainingSlotCount < filesToProcess.length) {
          const overflowFiles = filesToProcess.slice(remainingSlotCount);
          filesToProcess = filesToProcess.slice(0, remainingSlotCount);
          invalid = true;

          for (const file of overflowFiles) {
            propsRef.current.onFileReject?.(
              file,
              `Maximum ${maxFiles} files allowed`,
            );
          }
        }
      }

      const acceptedFiles: File[] = [];

      for (const file of filesToProcess) {
        if (maxSize && file.size > maxSize) {
          propsRef.current.onFileReject?.(file, "File too large");
          invalid = true;
          continue;
        }
        acceptedFiles.push(file);
      }

      if (invalid) {
        store.dispatch({ type: "SET_INVALID", invalid: true });
        setTimeout(() => {
          store.dispatch({ type: "SET_INVALID", invalid: false });
        }, 2000);
      }

      if (acceptedFiles.length > 0) {
        store.dispatch({ type: "ADD_FILES", files: acceptedFiles });

        if (propsRef.current.onUpload) {
          requestAnimationFrame(() => {
            onFilesUpload(acceptedFiles);
          });
        }
      }
    },
    [store, propsRef, onFilesUpload, maxFiles, maxSize],
  );

  const onInputChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      onFilesChange(files);
      event.target.value = "";
    },
    [onFilesChange],
  );

  const contextValue = React.useMemo<FileUploadContextValue>(
    () => ({ dropzoneId, inputId, listId, labelId, dir, inputRef, urlCache }),
    [dropzoneId, inputId, listId, labelId, dir, urlCache],
  );

  const element = useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        dir,
        className: cn("relative flex flex-col gap-2", className),
        children: (
          <>
            {children}
            <input
              type="file"
              id={inputId}
              aria-labelledby={labelId}
              aria-describedby={dropzoneId}
              ref={inputRef}
              tabIndex={-1}
              className="sr-only"
              multiple={multiple}
              onChange={onInputChange}
            />
            <div id={labelId} className="sr-only">
              File upload
            </div>
          </>
        ),
      },
      rootProps,
    ),
    render,
    state: { slot: "file-upload" },
  });

  return (
    <StoreContext.Provider value={store}>
      <FileUploadContext.Provider value={contextValue}>
        {element}
      </FileUploadContext.Provider>
    </StoreContext.Provider>
  );
}

interface FileUploadDropzoneProps
  extends React.ComponentProps<"div">, useRender.ComponentProps<"div"> {}

function FileUploadDropzone(props: FileUploadDropzoneProps) {
  const { render, className, ...dropzoneProps } = props;

  const context = useFileUploadContext(DROPZONE_NAME);
  const store = useStoreContext(DROPZONE_NAME);
  const dragOver = useStore((state) => state.dragOver);
  const invalid = useStore((state) => state.invalid);

  const pushFilesToInput = React.useCallback(
    (files: File[]) => {
      const inputElement = context.inputRef.current;
      if (!inputElement || files.length === 0) return;

      const dataTransfer = new DataTransfer();
      for (const file of files) {
        dataTransfer.items.add(file);
      }

      inputElement.files = dataTransfer.files;
      inputElement.dispatchEvent(new Event("change", { bubbles: true }));
    },
    [context.inputRef],
  );

  const onClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;

      const target = event.target;
      const isFromTrigger =
        target instanceof HTMLElement &&
        target.closest('[data-slot="file-upload-trigger"]');

      if (!isFromTrigger) {
        context.inputRef.current?.click();
      }
    },
    [context.inputRef],
  );

  const onDragOver = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      store.dispatch({ type: "SET_DRAG_OVER", dragOver: true });
    },
    [store],
  );

  const onDragEnter = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      store.dispatch({ type: "SET_DRAG_OVER", dragOver: true });
    },
    [store],
  );

  const onDragLeave = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;

      const relatedTarget = event.relatedTarget;
      if (
        relatedTarget &&
        relatedTarget instanceof Node &&
        event.currentTarget.contains(relatedTarget)
      ) {
        return;
      }

      event.preventDefault();
      store.dispatch({ type: "SET_DRAG_OVER", dragOver: false });
    },
    [store],
  );

  const onDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;

      event.preventDefault();
      store.dispatch({ type: "SET_DRAG_OVER", dragOver: false });
      pushFilesToInput(Array.from(event.dataTransfer.files));
    },
    [store, pushFilesToInput],
  );

  const onPaste = React.useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;

      event.preventDefault();
      store.dispatch({ type: "SET_DRAG_OVER", dragOver: false });

      const items = event.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item?.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }

      pushFilesToInput(files);
    },
    [store, pushFilesToInput],
  );

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (
        !event.defaultPrevented &&
        (event.key === "Enter" || event.key === " ")
      ) {
        event.preventDefault();
        context.inputRef.current?.click();
      }
    },
    [context.inputRef],
  );

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        role: "region",
        id: context.dropzoneId,
        "aria-controls": `${context.inputId} ${context.listId}`,
        "aria-invalid": invalid,
        dir: context.dir,
        tabIndex: 0,
        className: cn(
          "relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line p-6 transition-colors outline-none select-none hover:bg-accent/30 focus-visible:border-ring/50 data-dragging:border-primary/30 data-dragging:bg-accent/30 data-invalid:border-destructive data-invalid:ring-destructive/20",
          className,
        ),
        onClick,
        onDragEnter,
        onDragLeave,
        onDragOver,
        onDrop,
        onKeyDown,
        onPaste,
      },
      dropzoneProps,
    ),
    render,
    state: {
      slot: "file-upload-dropzone",
      dragging: dragOver ? "" : undefined,
      invalid: invalid ? "" : undefined,
    },
  });
}

interface FileUploadTriggerProps
  extends React.ComponentProps<"button">, useRender.ComponentProps<"button"> {}

function FileUploadTrigger(props: FileUploadTriggerProps) {
  const { render, ...triggerProps } = props;

  const context = useFileUploadContext(TRIGGER_NAME);

  const onClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.defaultPrevented) return;
      context.inputRef.current?.click();
    },
    [context.inputRef],
  );

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        type: "button",
        "aria-controls": context.inputId,
        onClick,
      },
      triggerProps,
    ),
    render,
    state: { slot: "file-upload-trigger" },
  });
}

interface FileUploadListProps
  extends React.ComponentProps<"div">, useRender.ComponentProps<"div"> {
  orientation?: "horizontal" | "vertical";
}

function FileUploadList(props: FileUploadListProps) {
  const { className, orientation = "vertical", render, ...listProps } = props;

  const context = useFileUploadContext(LIST_NAME);
  const fileCount = useStore((state) => state.files.size);
  const shouldRender = fileCount > 0;

  const element = useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        role: "list",
        id: context.listId,
        "aria-orientation": orientation,
        dir: context.dir,
        className: cn(
          "flex flex-col gap-2 data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-top-2 data-[state=inactive]:animate-out data-[state=inactive]:fade-out-0 data-[state=inactive]:slide-out-to-top-2",
          orientation === "horizontal" && "flex-row overflow-x-auto p-1.5",
          className,
        ),
      },
      listProps,
    ),
    render,
    state: {
      slot: "file-upload-list",
      orientation,
      state: shouldRender ? "active" : "inactive",
    },
  });

  if (!shouldRender) return null;

  return element;
}

interface FileUploadItemContextValue {
  id: string;
  fileState: FileState | undefined;
  nameId: string;
  sizeId: string;
  statusId: string;
  messageId: string;
}

const FileUploadItemContext =
  React.createContext<FileUploadItemContextValue | null>(null);

function useFileUploadItemContext(consumerName: string) {
  const context = React.useContext(FileUploadItemContext);
  if (!context) {
    throw new Error(`\`${consumerName}\` must be used within \`${ITEM_NAME}\``);
  }
  return context;
}

interface FileUploadItemProps
  extends React.ComponentProps<"div">, useRender.ComponentProps<"div"> {
  value: File;
}

function FileUploadItem(props: FileUploadItemProps) {
  const { value, render, className, ...itemProps } = props;

  const id = React.useId();
  const statusId = `${id}-status`;
  const nameId = `${id}-name`;
  const sizeId = `${id}-size`;
  const messageId = `${id}-message`;

  const context = useFileUploadContext(ITEM_NAME);
  const fileState = useStore((state) => state.files.get(value));
  const fileCount = useStore((state) => state.files.size);
  const fileIndex = useStore((state) => {
    const files = Array.from(state.files.keys());
    return files.indexOf(value) + 1;
  });

  const itemContext = React.useMemo(
    () => ({ id, fileState, nameId, sizeId, statusId, messageId }),
    [id, fileState, statusId, nameId, sizeId, messageId],
  );

  const statusText = fileState?.error
    ? `Error: ${fileState.error}`
    : fileState?.status === "uploading"
      ? `Uploading: ${fileState.progress}% complete`
      : fileState?.status === "success"
        ? "Upload complete"
        : "Ready to upload";

  const element = useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        role: "listitem",
        id,
        "aria-setsize": fileCount,
        "aria-posinset": fileIndex,
        "aria-describedby": `${nameId} ${sizeId} ${statusId} ${
          fileState?.error ? messageId : ""
        }`,
        "aria-labelledby": nameId,
        dir: context.dir,
        className: cn(
          "relative flex items-center gap-2.5 rounded-md border p-3",
          className,
        ),
        children: (
          <>
            {props.children}
            <span id={statusId} className="sr-only">
              {statusText}
            </span>
          </>
        ),
      },
      itemProps,
    ),
    render,
    state: { slot: "file-upload-item" },
  });

  if (!fileState) return null;

  return (
    <FileUploadItemContext.Provider value={itemContext}>
      {element}
    </FileUploadItemContext.Provider>
  );
}

interface FileUploadItemPreviewProps
  extends React.ComponentProps<"div">, useRender.ComponentProps<"div"> {}

function FileUploadItemPreview(props: FileUploadItemPreviewProps) {
  const { render, children, className, ...previewProps } = props;

  const itemContext = useFileUploadItemContext(ITEM_PREVIEW_NAME);
  const context = useFileUploadContext(ITEM_PREVIEW_NAME);

  const renderPreview = (file: File) => {
    if (!file.type.startsWith("image/")) return null;

    let url = context.urlCache.get(file);
    if (!url) {
      url = URL.createObjectURL(file);
      context.urlCache.set(file, url);
    }

    return <img src={url} alt={file.name} className="size-full object-cover" />;
  };

  const element = useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        "aria-labelledby": itemContext.nameId,
        className: cn(
          "relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded border bg-accent/50 [&>svg]:size-10",
          className,
        ),
        children: itemContext.fileState ? (
          <>
            {renderPreview(itemContext.fileState.file)}
            {children}
          </>
        ) : null,
      },
      previewProps,
    ),
    render,
    state: { slot: "file-upload-preview" },
  });

  if (!itemContext.fileState) return null;

  return element;
}

interface FileUploadItemMetadataProps
  extends React.ComponentProps<"div">, useRender.ComponentProps<"div"> {}

function FileUploadItemMetadata(props: FileUploadItemMetadataProps) {
  const { render, children, className, ...metadataProps } = props;

  const context = useFileUploadContext(ITEM_METADATA_NAME);
  const itemContext = useFileUploadItemContext(ITEM_METADATA_NAME);

  const element = useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        dir: context.dir,
        className: cn("flex min-w-0 flex-1 flex-col", className),
        children,
      },
      metadataProps,
    ),
    render,
    state: { slot: "file-upload-metadata" },
  });

  if (!itemContext.fileState) return null;

  return element;
}

interface FileUploadItemProgressProps
  extends React.ComponentProps<"div">, useRender.ComponentProps<"div"> {
  size?: number;
}

function FileUploadItemProgress(props: FileUploadItemProgressProps) {
  const { size = 40, render, className, ...progressProps } = props;

  const itemContext = useFileUploadItemContext(ITEM_PROGRESS_NAME);

  const progress = itemContext.fileState?.progress;
  const shouldRender = progress !== undefined && progress !== 100;

  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset =
    circumference - ((progress ?? 0) / 100) * circumference;

  const element = useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        role: "progressbar",
        "aria-valuemin": 0,
        "aria-valuemax": 100,
        "aria-valuenow": progress ?? 0,
        "aria-valuetext": `${progress ?? 0}%`,
        "aria-labelledby": itemContext.nameId,
        className: cn(
          "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
          className,
        ),
        children: (
          <svg
            className="-rotate-90 transform"
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            fill="none"
            stroke="currentColor"
          >
            <circle
              className="text-primary/20"
              strokeWidth="2"
              cx={size / 2}
              cy={size / 2}
              r={radius}
            />
            <circle
              className="text-primary transition-[stroke-dashoffset] duration-300 ease-linear"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              cx={size / 2}
              cy={size / 2}
              r={radius}
            />
          </svg>
        ),
      },
      progressProps,
    ),
    render,
    state: { slot: "file-upload-progress" },
  });

  if (!itemContext.fileState || !shouldRender) return null;

  return element;
}

interface FileUploadItemDeleteProps
  extends React.ComponentProps<"button">, useRender.ComponentProps<"button"> {}

function FileUploadItemDelete(props: FileUploadItemDeleteProps) {
  const { render, ...deleteProps } = props;

  const store = useStoreContext(ITEM_DELETE_NAME);
  const itemContext = useFileUploadItemContext(ITEM_DELETE_NAME);

  const onClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!itemContext.fileState || event.defaultPrevented) return;

      store.dispatch({
        type: "REMOVE_FILE",
        file: itemContext.fileState.file,
      });
    },
    [store, itemContext.fileState],
  );

  const element = useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        type: "button",
        "aria-controls": itemContext.id,
        "aria-describedby": itemContext.nameId,
        onClick,
      },
      deleteProps,
    ),
    render,
    state: { slot: "file-upload-item-delete" },
  });

  if (!itemContext.fileState) return null;

  return element;
}

export {
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadItemProgress,
  FileUploadList,
  FileUploadTrigger,
};

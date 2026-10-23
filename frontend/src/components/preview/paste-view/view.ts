import { basicSetup } from "codemirror";
import { EditorState, Compartment, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { watchPaste } from "@/lib/api";

const darkTheme = [
  oneDark,
  Prec.highest(
    EditorView.theme(
      {
        "&": { backgroundColor: "var(--background)" },
        ".cm-gutters": {
          backgroundColor: "var(--background)",
          borderRight: "1px solid var(--line)",
        },
        ".cm-activeLine, .cm-activeLineGutter": {
          backgroundColor: "rgba(255, 255, 255, 0.05)",
        },
      },
      { dark: true },
    ),
  ),
];

const viewElement = document.querySelector<HTMLDivElement>("#view");
const overlay = document.querySelector<HTMLDivElement>("#unlock-overlay");

if (!viewElement) {
  throw new Error("Paste view element not found");
}

const languageCompartment = new Compartment();
const themeCompartment = new Compartment();
const themeFor = () =>
  document.documentElement.classList.contains("dark") ? darkTheme : [];

const view = new EditorView({
  state: EditorState.create({
    doc: "",
    extensions: [
      basicSetup,
      EditorState.readOnly.of(true),
      languageCompartment.of([]),
      EditorView.theme({
        "&": { height: "100%" },
        ".cm-scroller": { overflow: "auto" },
      }),
      themeCompartment.of(themeFor()),
    ],
  }),
  parent: viewElement,
});

new MutationObserver(() =>
  view.dispatch({ effects: themeCompartment.reconfigure(themeFor()) }),
).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["class"],
});

const copyButton = document.querySelector<HTMLButtonElement>("#copy-btn");

copyButton?.addEventListener("click", async () => {
  const text = view.state.doc.toString();
  await navigator.clipboard.writeText(text);
  copyButton.textContent = "copied!";
  setTimeout(() => {
    copyButton.textContent = "copy";
  }, 1500);
});

function setText(text: string) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
}

async function setLanguage(name: string) {
  const language = languages.find((l) => l.name === name);
  if (!language) return;
  const support = await language.load();
  view.dispatch({ effects: languageCompartment.reconfigure(support) });
}

watchPaste(
  (paste) => {
    if (paste.text !== undefined) {
      setText(paste.text);
      overlay?.classList.add("hidden");
    } else {
      overlay?.classList.remove("hidden");
    }
    if (paste.language) void setLanguage(paste.language);
  },
  () => setText(
    String.raw
      `
  ______________________________________
 / Holy cow! This paste is gone. Either \
 | 404 ate it or time turned it into    |
 \ cheese.                              /
  --------------------------------------
         \   ^__^
          \  (oo)\_______
             (__)\       )\/\
                 ||----w |
                 ||     ||
      `
  ),
);
import { basicSetup } from "codemirror";
import { EditorState, Compartment, Prec } from "@codemirror/state";
import { completeAnyWord } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";

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
      },
      { dark: true },
    ),
  ),
];

const themeCompartment = new Compartment();
const themeFor = () =>
  document.documentElement.classList.contains("dark") ? darkTheme : [];

export const MAX_PASTE_CHARS = 50000;
const WARN_AT = 45000;

const editorElement = document.querySelector<HTMLDivElement>("#editor");
const languageSelect =
  document.querySelector<HTMLSelectElement>("#language-select");
const counter = document.querySelector("#paste-count");
const warn = document.querySelector("#paste-warn");

if (!editorElement || !languageSelect) {
  throw new Error("Code editor elements not found");
}

const languageCompartment = new Compartment();
let truncated = false;

const charLimit = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.newDoc.length <= MAX_PASTE_CHARS) return tr;
  truncated = true;
  const capped = tr.newDoc.sliceString(0, MAX_PASTE_CHARS);
  return {
    changes: { from: 0, to: tr.startState.doc.length, insert: capped },
    selection: {
      anchor: Math.min(tr.startState.selection.main.anchor, capped.length),
    },
    scrollIntoView: true,
  };
});

const updateCounter = EditorView.updateListener.of((u) => {
  if (!u.docChanged) return;
  const len = u.state.doc.length;

  if (counter) {
    counter.textContent = `${len.toLocaleString()} / 50,000 chars`;
    counter.classList.toggle(
      "text-warning",
      len >= WARN_AT && len < MAX_PASTE_CHARS,
    );
    counter.classList.toggle("text-danger", len >= MAX_PASTE_CHARS);
  }

  if (warn) {
    if (truncated) {
      warn.textContent = "Truncated to 50,000 chars.";
      truncated = false;
      setTimeout(() => {
        if (warn.textContent?.startsWith("Truncated")) warn.textContent = "";
      }, 4000);
    } else if (len >= WARN_AT && len < MAX_PASTE_CHARS) {
      warn.textContent = `${(MAX_PASTE_CHARS - len).toLocaleString()} chars left`;
    } else {
      warn.textContent = "";
    }
  }
});

const view = new EditorView({
  state: EditorState.create({
    doc: "",
    extensions: [
      basicSetup,
      EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }]),
      languageCompartment.of([]),
      charLimit,
      updateCounter,
      EditorView.theme({
        "&": { height: "100%", maxHeight: "100%", fontSize: "14px" },
        ".cm-scroller": { overflow: "auto" },
      }),
      themeCompartment.of(themeFor()),
    ],
  }),
  parent: editorElement,
});

new MutationObserver(() =>
  view.dispatch({ effects: themeCompartment.reconfigure(themeFor()) }),
).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["class"],
});

for (const language of languages) {
  const option = document.createElement("option");
  option.value = language.name;
  option.textContent = language.name;
  languageSelect.appendChild(option);
}

languageSelect.addEventListener("change", async () => {
  const name = languageSelect.value;
  if (!name) {
    view.dispatch({ effects: languageCompartment.reconfigure([]) });
    return;
  }
  const language = languages.find((l) => l.name === name);
  if (!language) return;
  const support = await language.load();
  view.dispatch({ effects: languageCompartment.reconfigure(support) });
});

export const getPasteText = () => view.state.doc.toString();
export const getLanguage = () => languageSelect.value || "plaintext";
import { type SelectedElement } from "./protocol";

export const DECK_HINT_MESSAGE =
  "Single-click selects, double-click edits text, and the Pages panel navigates slides.";

export function hostDocumentChangeDelay(reason: string) {
  return reason === "input" || reason === "source" ? 1000 : 250;
}

export function mergeSelectionEcho(
  current: SelectedElement | null,
  incoming: SelectedElement | null,
  inspectorTextFocused: boolean,
) {
  if (inspectorTextFocused && current && incoming && current.id === incoming.id) {
    return { ...incoming, text: current.text };
  }
  return incoming;
}

export function shouldInstallBeforeUnload(isVsCode: boolean, sourceDirty: boolean) {
  return !isVsCode && sourceDirty;
}

export function markBeforeUnloadDirty(event: Pick<BeforeUnloadEvent, "preventDefault" | "returnValue">) {
  event.preventDefault();
  event.returnValue = "";
  return "";
}

export function shouldShowDeckHint(slideCount: number, alreadyShown: boolean) {
  return slideCount > 0 && !alreadyShown;
}

export type HostDocumentEdit = {
  from: number;
  to: number;
  text: string;
  expected: string;
  fallbackHtml: string;
};

export type HostEditPlan =
  | { mode: "targeted"; from: number; to: number; text: string }
  | { mode: "fallback"; html: string; reason: string };

export function planHostEdit(current: string, edit: HostDocumentEdit): HostEditPlan;

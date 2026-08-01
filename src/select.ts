/**
 * A plain, JSX-free description of one entry in a `DialogSelect`. The dialog
 * layer maps these onto `api.ui.DialogSelect`'s option objects; keeping the
 * shape pure (no `footer`/`onSelect` JSX) means the option-building logic is
 * unit-testable without the TUI runtime.
 */
export interface SelectOption<Value> {
  title: string
  value: Value
  description?: string
  category?: string
}

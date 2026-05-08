## 2024-03-24 - Missing ARIA Labels on Icon-only Buttons
**Learning:** The application heavily relies on icon-only buttons (`btn-icon` class) across toolbars, list headers, and dialogs (e.g., Composer formatting, Dashboard menu toggles, Contact management). Screen readers couldn't understand these actions without explicit labels.
**Action:** Added `aria-label` attributes describing the action (e.g., "Open menu", "Clear search", "Toggle Two-Factor Authentication") to make these accessible. Future components using icon-only buttons should enforce the `aria-label` attribute.

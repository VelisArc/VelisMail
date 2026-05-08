## 2024-05-08 - [XSS] Unsanitized initialBody in Composer

**Vulnerability:** The `Composer` component in the frontend directly set the `innerHTML` of the rich text editor using `initialBody`. Since `initialBody` was populated directly from email contents when forwarding or replying (e.g. `selectedEmail.body`), this allowed arbitrary HTML strings to execute JavaScript in the user's browser context.
**Learning:** `innerHTML` should never be set with untrusted input unless it has been strictly sanitized using a library like `DOMPurify`.
**Prevention:** We have introduced `DOMPurify.sanitize()` before setting the `innerHTML` of the composer editor. All dynamically injected HTML must be sanitized in a similar manner.

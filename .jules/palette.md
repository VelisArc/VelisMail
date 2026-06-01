## 2024-05-18 - [Fix Design Flaws]
**Learning:** All boxes, shadows and radiuses must be completely disabled for pure flat minimalist UI. Delete Forever logic should not exist.
**Action:** Fixed all CSS components and Modals.tsx fallback

## 2024-05-18 - Fix Email Header Overflow UI

**Learning:** Text elements within flexbox containers (like email addresses in the inbox meta header) can cause layouts to break on smaller screens if they don't have proper wrapping or truncation constraints. Using `word-break: break-all` can cause awkward mid-word breaks.

**Action:** When styling text inside flexbox containers for the frontend, prefer `overflow-wrap: anywhere` or `word-break: break-word`. Use `text-overflow: ellipsis` along with `overflow: hidden`, `flex-shrink: 1`, and `min-width: 0` on flex items to handle long strings (like email addresses) without breaking responsive layouts. Also, when text is visually truncated, add a `title` attribute to the element to maintain accessibility and allow users to see the full content on hover.

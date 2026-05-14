# Design: Atomic Upload for /api/rate

**Date:** 2026-05-14
**Status:** Approved

## Problem

`uploadedFiles` is a module-level singleton shared across all HTTP connections. Any concurrent user can overwrite another user's uploaded files before `/api/rate` is called, leaking sensitive genealogical data (names, dates, family relationships) to an unintended caller. The race condition is directly exploitable with two concurrent browser sessions.

## Decision

Eliminate the two-step upload flow. Both files are held in the browser until Compare is clicked, then sent together in one `multipart/form-data` POST to `/api/rate`. The separate upload endpoints and the global singleton are deleted.

## Architecture

### Removed

- `POST /api/upload-gedcom` — deleted entirely
- `POST /api/upload-xml` — deleted entirely
- `let uploadedFiles = { gedcom: null, xml: null }` global — deleted entirely

### Changed: `POST /api/rate`

- Middleware changes from `upload.single(...)` to `upload.fields([{name: 'gedcom', maxCount: 1}, {name: 'xml', maxCount: 1}])`
- Reads `req.files.gedcom[0]` and `req.files.xml[0]` for file paths and original names
- Cleanup moves from success-only to a `finally` block (accepting explicit path arguments) so temp files are always removed regardless of outcome

### Changed: `public/app.js`

- File change event handlers no longer call `uploadFile()` or hit the server; they store the `File` object in the local `uploadedFiles` tracker
- `showLoading()`/`hideLoading()` removed from change handlers (no round-trip on selection)
- Form submit builds a `FormData` containing both `File` objects and POSTs it directly to `/api/rate`
- `Content-Type: application/json` header and empty JSON body removed from the submit fetch call
- Unused `uploadFile()` function removed

### Unchanged

- Client-side filename validation and page-number matching (still runs on file selection)
- All comparison, reporting, and quality metrics logic
- `cleanupUploadedFiles` helper logic (refactored to accept explicit paths rather than reading a global)
- Error handling middleware and 404 handler

## Error Handling

- Missing file fields → 400 with descriptive message (same as before)
- Parse/processing failure → 500; `finally` block ensures temp files are cleaned up
- Multer file size limit (10 MB) unchanged

## Testing Criteria

- Single browser session: select GEDCOM + XML, click Compare, verify results appear
- Error path: submit with one file missing, verify 400 response and no temp files remain
- Error path: submit a malformed GEDCOM/XML, verify 500 response and no temp files remain
- Concurrent sessions: two users submit simultaneously; each receives only their own results

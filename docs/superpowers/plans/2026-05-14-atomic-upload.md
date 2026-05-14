# Atomic Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-step file upload flow with a single atomic multipart POST to `/api/rate`, eliminating cross-user data leakage via the shared global `uploadedFiles` singleton.

**Architecture:** The global `uploadedFiles` object and the separate `/api/upload-gedcom` and `/api/upload-xml` endpoints are deleted. `/api/rate` is changed to accept both files via `upload.fields()` in a single multipart request. The client stores `File` objects locally and sends them together when Compare is clicked. Temp file cleanup is moved to a `finally` block so it runs on both success and failure paths.

**Tech Stack:** Node.js, Express 4, Multer 1.x, vanilla browser JS (fetch + FormData), Mocha integration tests

---

## File Map

| File | Change |
|---|---|
| `LLMquality.js` | Delete global, delete 2 upload endpoints, refactor `/api/rate`, add `cleanupFiles()` |
| `public/app.js` | Store `File` objects on selection, remove `uploadFile()`, update submit handler |
| `test/serverIntegrationTest.js` | Add failing tests for old endpoints (404) and new multer config |

---

### Task 1: Write Failing Integration Tests

**Files:**
- Modify: `test/serverIntegrationTest.js`

These tests assert the post-refactor state. They must **fail** before implementation and pass after.

- [ ] **Step 1.1: Add tests for removed endpoints and new multer config**

Open `test/serverIntegrationTest.js`. After the closing `});` of the existing `'API Endpoints'` describe block (currently line 65), add the following two new describe blocks:

```javascript
    describe('Removed upload endpoints', function() {
        it('/api/upload-gedcom should no longer exist (404)', function(done) {
            const postData = '{}';
            const options = {
                hostname: serverHost,
                port: serverPort,
                path: '/api/upload-gedcom',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };
            const req = http.request(options, (res) => {
                assert.strictEqual(res.statusCode, 404,
                    '/api/upload-gedcom should be gone (404)');
                done();
            });
            req.on('error', done);
            req.write(postData);
            req.end();
        });

        it('/api/upload-xml should no longer exist (404)', function(done) {
            const postData = '{}';
            const options = {
                hostname: serverHost,
                port: serverPort,
                path: '/api/upload-xml',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };
            const req = http.request(options, (res) => {
                assert.strictEqual(res.statusCode, 404,
                    '/api/upload-xml should be gone (404)');
                done();
            });
            req.on('error', done);
            req.write(postData);
            req.end();
        });
    });

    describe('Atomic upload configuration', function() {
        it('server should use upload.fields (not upload.single) for /api/rate', function() {
            const serverContent = fs.readFileSync(
                path.join(__dirname, '../LLMquality.js'), 'utf8');
            assert(serverContent.includes('upload.fields('),
                'LLMquality.js must use upload.fields for /api/rate');
            assert(!serverContent.includes('uploadedFiles'),
                'LLMquality.js must not contain the uploadedFiles global');
        });

        it('/api/rate with no files returns 400 mentioning GEDCOM', function(done) {
            const boundary = '----LLMTestBoundary';
            const body = `--${boundary}--\r\n`;
            const options = {
                hostname: serverHost,
                port: serverPort,
                path: '/api/rate',
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': Buffer.byteLength(body)
                }
            };
            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    assert.strictEqual(res.statusCode, 400);
                    const json = JSON.parse(data);
                    assert.strictEqual(json.success, false);
                    assert.ok(json.error.includes('GEDCOM'),
                        'Error message should mention GEDCOM');
                    done();
                });
            });
            req.on('error', done);
            req.write(body);
            req.end();
        });
    });
```

- [ ] **Step 1.2: Run tests to confirm they fail**

Start the server in a separate terminal first: `npm start`

Then run:
```
npm test
```

Expected: The three new tests fail. The "Removed upload endpoints" tests fail because those endpoints currently return 400 (not 404). The "upload.fields" source inspection test fails because `upload.fields` is not present and `uploadedFiles` is present.

---

### Task 2: Refactor Server (`LLMquality.js`)

**Files:**
- Modify: `LLMquality.js`

- [ ] **Step 2.1: Delete the `uploadedFiles` global (lines 32–35)**

Remove these lines entirely:
```javascript
// Store uploaded files temporarily
let uploadedFiles = {
    gedcom: null,
    xml: null
};
```

- [ ] **Step 2.2: Delete the `/api/upload-gedcom` handler (lines 84–114)**

Remove the entire block from `// API route to handle GEDCOM file upload` through its closing `});`.

- [ ] **Step 2.3: Delete the `/api/upload-xml` handler (lines 117–147)**

Remove the entire block from `// API route to handle XML file upload` through its closing `});`.

- [ ] **Step 2.4: Replace the `/api/rate` handler signature and file extraction**

Change the first line of the handler from:
```javascript
app.post('/api/rate', async (req, res) => {
```
to:
```javascript
app.post('/api/rate', upload.fields([
    { name: 'gedcom', maxCount: 1 },
    { name: 'xml', maxCount: 1 }
]), async (req, res) => {
    const gedcomFile = req.files && req.files.gedcom && req.files.gedcom[0];
    const xmlFile = req.files && req.files.xml && req.files.xml[0];
```

- [ ] **Step 2.5: Replace file-presence checks and file path references inside `/api/rate`**

Replace the old checks that read from `uploadedFiles`:
```javascript
        // Check if both files are uploaded
        if (!uploadedFiles.gedcom) {
            return res.status(400).json({
                success: false,
                error: 'Please upload a GEDCOM file first'
            });
        }

        if (!uploadedFiles.xml) {
            return res.status(400).json({
                success: false,
                error: 'Please upload an XML file first'
            });
        }
```
with:
```javascript
        if (!gedcomFile) {
            return res.status(400).json({
                success: false,
                error: 'Please upload a GEDCOM file'
            });
        }

        if (!xmlFile) {
            return res.status(400).json({
                success: false,
                error: 'Please upload an XML file'
            });
        }
```

Then update the GEDCOM processing block. Replace:
```javascript
            const gedModel = gedReader.read(uploadedFiles.gedcom.path);
            gedPageModel = gedModel.toPageModel(); // Convert GEDCOM to PageModel
            
            // Extract and set location from GEDCOM filename
            gedPageModel.location = extractLocationFromFilename(uploadedFiles.gedcom.originalName);
```
with:
```javascript
            const gedModel = gedReader.read(gedcomFile.path);
            gedPageModel = gedModel.toPageModel();
            gedPageModel.location = extractLocationFromFilename(
                fixFilenameEncoding(gedcomFile.originalname));
```

Then update the XML processing block. Replace:
```javascript
            const xmlModel = await xmlReader.readXml(uploadedFiles.xml.path);
            xmlPageModel = xmlModel.toPageModel();
            
            // Extract and set location from XML filename
            xmlPageModel.location = extractLocationFromFilename(uploadedFiles.xml.originalName);
```
with:
```javascript
            const xmlModel = await xmlReader.readXml(xmlFile.path);
            xmlPageModel = xmlModel.toPageModel();
            xmlPageModel.location = extractLocationFromFilename(
                fixFilenameEncoding(xmlFile.originalname));
```

Then update the `compareModels` call. Replace:
```javascript
        const results = await compareModels(gedPageModel, xmlPageModel, {
            gedcomFile: uploadedFiles.gedcom.originalName,
            xmlFile: uploadedFiles.xml.originalName
        });

        // Clean up uploaded files after processing
        cleanupUploadedFiles();

        res.json({
```
with:
```javascript
        const results = await compareModels(gedPageModel, xmlPageModel, {
            gedcomFile: fixFilenameEncoding(gedcomFile.originalname),
            xmlFile: fixFilenameEncoding(xmlFile.originalname)
        });

        res.json({
```

- [ ] **Step 2.6: Add `finally` block to the `/api/rate` handler**

The handler's outer `try/catch` currently ends with:
```javascript
    } catch (error) {
        console.error('Error in rate endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Processing failed: ' + error.message
        });
    }
});
```

Change it to:
```javascript
    } catch (error) {
        console.error('Error in rate endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Processing failed: ' + error.message
        });
    } finally {
        cleanupFiles(
            gedcomFile && gedcomFile.path,
            xmlFile && xmlFile.path
        );
    }
});
```

- [ ] **Step 2.7: Replace `cleanupUploadedFiles()` with `cleanupFiles(gedcomPath, xmlPath)`**

Find and replace the old `cleanupUploadedFiles` function:
```javascript
// Helper function to clean up uploaded files
function cleanupUploadedFiles() {
    try {
        if (uploadedFiles.gedcom && fs.existsSync(uploadedFiles.gedcom.path)) {
            fs.unlinkSync(uploadedFiles.gedcom.path);
        }
        if (uploadedFiles.xml && fs.existsSync(uploadedFiles.xml.path)) {
            fs.unlinkSync(uploadedFiles.xml.path);
        }
        // Reset the uploaded files
        uploadedFiles = { gedcom: null, xml: null };
    } catch (error) {
        console.error('Error cleaning up uploaded files:', error);
    }
}
```

with:
```javascript
function cleanupFiles(gedcomPath, xmlPath) {
    try {
        if (gedcomPath && fs.existsSync(gedcomPath)) {
            fs.unlinkSync(gedcomPath);
        }
        if (xmlPath && fs.existsSync(xmlPath)) {
            fs.unlinkSync(xmlPath);
        }
    } catch (error) {
        console.error('Error cleaning up files:', error);
    }
}
```

- [ ] **Step 2.8: Run the test suite**

Restart the server (`npm start` in a separate terminal), then:
```
npm test
```

Expected: All tests pass. The three previously-failing tests now pass. The existing "API Endpoints" test (empty POST → 400/500) continues to pass because multer receives a JSON body, finds no files, and `gedcomFile` is undefined, returning 400.

- [ ] **Step 2.9: Commit**

```bash
git add LLMquality.js test/serverIntegrationTest.js
git commit -m "fix: replace global upload state with atomic multipart /api/rate

Removes /api/upload-gedcom and /api/upload-xml endpoints along with
the shared uploadedFiles singleton that allowed cross-user data leakage.
/api/rate now accepts both files in a single upload.fields() request.
Temp file cleanup moves to a finally block to run on all code paths.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Refactor Client (`public/app.js`)

**Files:**
- Modify: `public/app.js`

- [ ] **Step 3.1: Remove the `uploadFile()` function**

Delete the entire function (lines 102–123):
```javascript
    // File upload functions
    async function uploadFile(file, endpoint) {
        const formData = new FormData();
        formData.append(endpoint === '/api/upload-gedcom' ? 'gedcom' : 'xml', file);
        
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Upload failed');
            }
            
            return result;
        } catch (error) {
            console.error('Upload error:', error);
            throw error;
        }
    }
```

- [ ] **Step 3.2: Rewrite the `gedcomFile` change handler**

Replace the entire `gedcomFile.addEventListener('change', ...)` block (lines 491–544) with:

```javascript
    gedcomFile.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            if (!file.name.toLowerCase().endsWith('.ged')) {
                showError('❌ Invalid GEDCOM File Extension\n\nGEDCOM files must have a .ged extension.\n\nExample: Tannenkirch.000.ged');
                e.target.value = '';
                return;
            }

            const fileInfo = extractPageNumber(file.name);
            if (!fileInfo) {
                showError('❌ Invalid GEDCOM Filename Format\n\nGEDCOM filename must follow the pattern:\nbasename.###.ged\n\nExample: Tannenkirch.000.ged\n(where 000 is the 3-digit page number)');
                e.target.value = '';
                return;
            }

            uploadedFiles.gedcom = {
                originalName: file.name,
                file: file
            };

            gedcomFileName.textContent = file.name;
            gedcomUploadBtn.classList.add('file-selected');
            const uploadTextElement = gedcomUploadBtn.querySelector('.upload-text');
            if (uploadTextElement) {
                uploadTextElement.textContent = 'GEDCOM File Selected';
            }

            updateFormValidation();

            if (uploadedFiles.xml) {
                const pageValidation = validatePageNumbers();
                if (!pageValidation.isValid) {
                    showError('❌ File Mismatch Detected\n\n' + pageValidation.message +
                        '\n\nPlease ensure both files reference the same page and have matching base names.');
                }
            }
        }
    });
```

- [ ] **Step 3.3: Rewrite the `xmlFile` change handler**

Replace the entire `xmlFile.addEventListener('change', ...)` block (lines 546–595) with:

```javascript
    xmlFile.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            if (!file.name.toLowerCase().endsWith('.xml')) {
                showError('❌ Invalid XML File Extension\n\nXML files must have a .xml extension.\n\nExample: Tannenkirch.000.xml');
                e.target.value = '';
                return;
            }

            const fileInfo = extractPageNumber(file.name);
            if (!fileInfo) {
                showError('❌ Invalid XML Filename Format\n\nXML filename must follow the pattern:\nbasename.###.xml\n\nExample: Tannenkirch.000.xml\n(where 000 is the 3-digit page number)');
                e.target.value = '';
                return;
            }

            uploadedFiles.xml = {
                originalName: file.name,
                file: file
            };

            xmlFileName.textContent = file.name;
            xmlUploadBtn.classList.add('file-selected');
            xmlUploadBtn.querySelector('.upload-text').textContent = 'XML File Selected';

            updateFormValidation();

            if (uploadedFiles.gedcom) {
                const pageValidation = validatePageNumbers();
                if (!pageValidation.isValid) {
                    showError('❌ File Mismatch Detected\n\n' + pageValidation.message +
                        '\n\nPlease ensure both files reference the same page and have matching base names.');
                }
            }
        }
    });
```

- [ ] **Step 3.4: Rewrite the form submit handler**

Replace the entire `form.addEventListener('submit', ...)` block (lines 440–480) with:

```javascript
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        hideError();

        const validation = validateForm();
        if (!validation.isValid) {
            showError(validation.errors.join(', '));
            return;
        }

        showLoading();

        try {
            const formData = new FormData();
            formData.append('gedcom', uploadedFiles.gedcom.file);
            formData.append('xml', uploadedFiles.xml.file);

            const response = await fetch('/api/rate', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (response.ok && result.success) {
                resultsArea.value = result.results;
                resultsArea.scrollTop = 0;
            } else {
                throw new Error(result.error || 'An error occurred during processing');
            }
        } catch (error) {
            console.error('Error:', error);
            showError('Error: ' + error.message);
            resultsArea.value = `Error: ${error.message}\n\nPlease check your configuration and try again.`;
        } finally {
            hideLoadingAndReset();
        }
    });
```

- [ ] **Step 3.5: Manual smoke test in browser**

Start the server (`npm start`). Open `http://localhost:3000` in a browser.

Verify the happy path:
1. Select a valid `.ged` file (e.g. `Tannenkirch.000.ged`) — UI shows "GEDCOM File Selected", no server request yet
2. Select the matching `.xml` file (e.g. `Tannenkirch.000.xml`) — UI shows "XML File Selected", Compare button becomes active
3. Click Compare — browser sends one multipart POST to `/api/rate`, results appear in the textarea

Verify error path:
1. Select a GEDCOM file only, skip XML, try to click Compare — button remains disabled (client-side validation prevents submission)
2. Open DevTools Network tab, confirm no requests to `/api/upload-gedcom` or `/api/upload-xml` are made at any point

- [ ] **Step 3.6: Commit**

```bash
git add public/app.js
git commit -m "refactor: hold files in browser until Compare, send as single multipart POST

Removes the two-step pre-upload flow from the client. File objects are
stored locally on selection and sent together with the rate request.
Eliminates all calls to the now-removed upload endpoints.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Final Verification

**Files:** none

- [ ] **Step 4.1: Run full test suite**

With the server running:
```
npm test
```

Expected output (all passing):
```
LLMquality Server Integration Tests
  Server Health Check
    ✓ should respond to GET /
  API Endpoints
    ✓ should have upload endpoints available
  Removed upload endpoints
    ✓ /api/upload-gedcom should no longer exist (404)
    ✓ /api/upload-xml should no longer exist (404)
  Atomic upload configuration
    ✓ server should use upload.fields (not upload.single) for /api/rate
    ✓ /api/rate with no files returns 400 mentioning GEDCOM
  Method Name Verification
    ✓ should confirm server uses correct reader methods

7 passing
```

- [ ] **Step 4.2: Verify no temp files are orphaned on parse error**

In a separate terminal, watch the temp directory:
```bash
watch -n1 'ls /tmp/llmquality-uploads/ 2>/dev/null | wc -l'
```

Submit a malformed file (rename a `.txt` file with a `.ged` extension and submit it). Confirm the temp file count returns to 0 after the 500 response — the `finally` block ran cleanup even though processing failed.

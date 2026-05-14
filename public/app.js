/**
 * LLMquality Client-Side JavaScript
 * Enhanced functionality for genealogical data processing application
 */

document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const form = document.getElementById('dataForm');
    const compareBtn = document.getElementById('compareBtn');
    const helpBtn = document.getElementById('helpBtn');
    const saveBtn = document.getElementById('saveBtn');
    const btnText = document.querySelector('.btn-text');
    const btnSpinner = document.querySelector('.btn-spinner');
    const resultsArea = document.getElementById('resultsArea');
    const errorDiv = document.getElementById('error');
    const errorContent = document.getElementById('errorContent');

    // File upload elements
    const gedcomFile = document.getElementById('gedcomFile');
    const xmlFile = document.getElementById('xmlFile');
    const gedcomUploadBtn = document.getElementById('gedcomUploadBtn');
    const xmlUploadBtn = document.getElementById('xmlUploadBtn');
    const gedcomFileName = document.getElementById('gedcomFileName');
    const xmlFileName = document.getElementById('xmlFileName');

    // Modal elements
    const helpModal = document.getElementById('helpModal');
    const saveFileModal = document.getElementById('saveFileModal');
    const closeHelpModal = document.getElementById('closeHelpModal');
    const closeSaveFileModal = document.getElementById('closeSaveFileModal');
    const closeHelp = document.getElementById('closeHelp');
    const fileName = document.getElementById('fileName');
    const saveFileOk = document.getElementById('saveFileOk');
    const saveFileCancel = document.getElementById('saveFileCancel');

    // File upload tracking
    let uploadedFiles = {
        gedcom: null,
        xml: null
    };

    // Extract page number from filename
    function extractPageNumber(filename) {
        // Match pattern: basename.###.extension where ### is the page number
        const match = filename.match(/^(.+)\.(\d{3})\.(ged|xml)$/i);
        if (match) {
            return {
                basename: match[1],
                pageNumber: match[2],
                extension: match[3].toLowerCase()
            };
        }
        return null;
    }

    // Validate that GEDCOM and XML files have matching page numbers
    function validatePageNumbers() {
        if (!uploadedFiles.gedcom || !uploadedFiles.xml) {
            return { isValid: true, message: '' }; // Can't validate until both files are uploaded
        }

        const gedcomInfo = extractPageNumber(uploadedFiles.gedcom.originalName);
        const xmlInfo = extractPageNumber(uploadedFiles.xml.originalName);

        if (!gedcomInfo) {
            return { 
                isValid: false, 
                message: `GEDCOM filename "${uploadedFiles.gedcom.originalName}" must follow pattern: basename.###.ged\n\nExample: Tannenkirch.000.ged` 
            };
        }

        if (!xmlInfo) {
            return { 
                isValid: false, 
                message: `XML filename "${uploadedFiles.xml.originalName}" must follow pattern: basename.###.xml\n\nExample: Tannenkirch.000.xml` 
            };
        }

        if (gedcomInfo.pageNumber !== xmlInfo.pageNumber) {
            return { 
                isValid: false, 
                message: `Page number mismatch:\n• GEDCOM: ${uploadedFiles.gedcom.originalName} (page ${gedcomInfo.pageNumber})\n• XML: ${uploadedFiles.xml.originalName} (page ${xmlInfo.pageNumber})\n\nBoth files must reference the same page number.` 
            };
        }

        if (gedcomInfo.basename.toLowerCase() !== xmlInfo.basename.toLowerCase()) {
            return { 
                isValid: false, 
                message: `Base name mismatch:\n• GEDCOM: "${gedcomInfo.basename}"\n• XML: "${xmlInfo.basename}"\n\nBoth files must have the same base name.` 
            };
        }

        return { 
            isValid: true, 
            message: '', 
            pageNumber: gedcomInfo.pageNumber,
            basename: gedcomInfo.basename 
        };
    }

    // Initialize form
    function initializeForm() {
        updateFormValidation();
    }

    // Form validation
    function validateForm() {
        let isValid = true;
        let errors = [];

        // Validate file uploads
        if (!uploadedFiles.gedcom) {
            errors.push('Please upload a GEDCOM file');
            isValid = false;
        }

        if (!uploadedFiles.xml) {
            errors.push('Please upload an XML file');
            isValid = false;
        }

        // Validate page numbers if both files are uploaded
        if (uploadedFiles.gedcom && uploadedFiles.xml) {
            const pageValidation = validatePageNumbers();
            if (!pageValidation.isValid) {
                errors.push(pageValidation.message);
                isValid = false;
            }
        }

        return { isValid, errors };
    }

    // Real-time validation
    function updateFormValidation() {
        const validation = validateForm();
        compareBtn.disabled = !validation.isValid;
        
        if (!validation.isValid) {
            compareBtn.style.opacity = '0.6';
            compareBtn.style.cursor = 'not-allowed';
        } else {
            compareBtn.style.opacity = '1';
            compareBtn.style.cursor = 'pointer';
        }
    }

    // Show error message in prominent overlay
    function showError(message) {
        // Remove any existing error overlay
        hideError();
        
        // Create error overlay
        const errorOverlay = document.createElement('div');
        errorOverlay.id = 'errorOverlay';
        errorOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            backdrop-filter: blur(2px);
        `;
        
        // Create error dialog
        const errorDialog = document.createElement('div');
        errorDialog.style.cssText = `
            background: #fee2e2;
            border: 2px solid #dc2626;
            border-radius: 12px;
            padding: 24px;
            max-width: 500px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
            position: relative;
            animation: errorSlideIn 0.3s ease-out;
        `;
        
        // Create error content
        const errorContent = document.createElement('div');
        errorContent.style.cssText = `
            color: #dc2626;
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            font-size: 14px;
            line-height: 1.5;
            white-space: pre-wrap;
            word-wrap: break-word;
        `;
        errorContent.textContent = message;
        
        // Create close button
        const closeButton = document.createElement('button');
        closeButton.innerHTML = '✕';
        closeButton.style.cssText = `
            position: absolute;
            top: 12px;
            right: 12px;
            background: none;
            border: none;
            font-size: 20px;
            color: #dc2626;
            cursor: pointer;
            width: 30px;
            height: 30px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background-color 0.2s;
        `;
        
        closeButton.addEventListener('mouseenter', function() {
            this.style.backgroundColor = '#fca5a5';
        });
        
        closeButton.addEventListener('mouseleave', function() {
            this.style.backgroundColor = 'transparent';
        });
        
        closeButton.addEventListener('click', hideError);
        
        // Create OK button
        const okButton = document.createElement('button');
        okButton.textContent = 'OK';
        okButton.style.cssText = `
            background: #dc2626;
            color: white;
            border: none;
            padding: 8px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            margin-top: 16px;
            transition: background-color 0.2s;
        `;
        
        okButton.addEventListener('mouseenter', function() {
            this.style.backgroundColor = '#b91c1c';
        });
        
        okButton.addEventListener('mouseleave', function() {
            this.style.backgroundColor = '#dc2626';
        });
        
        okButton.addEventListener('click', hideError);
        
        // Assemble dialog
        errorDialog.appendChild(closeButton);
        errorDialog.appendChild(errorContent);
        errorDialog.appendChild(okButton);
        errorOverlay.appendChild(errorDialog);
        
        // Add animation keyframes if not already added
        if (!document.querySelector('#errorAnimations')) {
            const style = document.createElement('style');
            style.id = 'errorAnimations';
            style.textContent = `
                @keyframes errorSlideIn {
                    from {
                        opacity: 0;
                        transform: scale(0.9) translateY(-20px);
                    }
                    to {
                        opacity: 1;
                        transform: scale(1) translateY(0);
                    }
                }
            `;
            document.head.appendChild(style);
        }
        
        // Add to document
        document.body.appendChild(errorOverlay);
        
        // Close on escape key
        function handleEscape(e) {
            if (e.key === 'Escape') {
                hideError();
                document.removeEventListener('keydown', handleEscape);
            }
        }
        document.addEventListener('keydown', handleEscape);
        
        // Close on backdrop click
        errorOverlay.addEventListener('click', function(e) {
            if (e.target === errorOverlay) {
                hideError();
            }
        });
        
        // Auto-hide after 10 seconds for very long messages
        setTimeout(() => {
            if (document.getElementById('errorOverlay')) {
                hideError();
            }
        }, 10000);
    }

    // Hide error message
    function hideError() {
        const existingOverlay = document.getElementById('errorOverlay');
        if (existingOverlay) {
            existingOverlay.remove();
        }
        
        // Also hide the old error div if it exists
        if (errorDiv) {
            errorDiv.style.display = 'none';
        }
    }

    // Show loading state
    function showLoading() {
        btnText.textContent = 'Comparing...';
        btnSpinner.style.display = 'inline-block';
        compareBtn.disabled = true;
        compareBtn.style.opacity = '0.8';
    }

    // Hide loading state
    function hideLoading() {
        btnText.textContent = 'Compare';
        btnSpinner.style.display = 'none';
        compareBtn.disabled = false;
        compareBtn.style.opacity = '1';
        updateFormValidation();
    }
    
    // Hide loading state and reset UI after comparison
    function hideLoadingAndReset() {
        btnText.textContent = 'Compare';
        btnSpinner.style.display = 'none';
        compareBtn.disabled = true; // Keep disabled after comparison
        compareBtn.style.opacity = '0.6';
        
        // Reset file selections
        resetFileSelections();
    }
    
    // Reset file selections and UI state
    function resetFileSelections() {
        // Clear file inputs
        gedcomFile.value = '';
        xmlFile.value = '';
        
        // Reset file displays - use empty string to show initial state
        gedcomFileName.textContent = '';
        xmlFileName.textContent = '';
        
        // Reset upload button states - find the correct spans
        const gedcomUploadText = gedcomUploadBtn.querySelector('.upload-text');
        const xmlUploadText = xmlUploadBtn.querySelector('.upload-text');
        
        if (gedcomUploadText) {
            gedcomUploadText.textContent = 'Choose GEDCOM File';
        }
        if (xmlUploadText) {
            xmlUploadText.textContent = 'Choose XML File';
        }
        
        // Remove file-selected class if it exists
        gedcomUploadBtn.classList.remove('file-selected');
        xmlUploadBtn.classList.remove('file-selected');
        
        // Clear uploaded files tracking
        uploadedFiles = {
            gedcom: null,
            xml: null
        };
    }

    // Show modal
    function showModal(modal) {
        modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
    }

    // Hide modal
    function hideModal(modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }

    // Handle form submission
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

    // File upload handlers
    gedcomUploadBtn.addEventListener('click', function() {
        gedcomFile.click();
    });

    xmlUploadBtn.addEventListener('click', function() {
        xmlFile.click();
    });

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

    // Help modal handlers
    helpBtn.addEventListener('click', function() {
        showModal(helpModal);
    });

    closeHelp.addEventListener('click', function() {
        hideModal(helpModal);
    });

    closeHelpModal.addEventListener('click', function() {
        hideModal(helpModal);
    });

    // Save button handlers
    saveBtn.addEventListener('click', function() {
        if (!resultsArea.value.trim()) {
            showError('No results to save. Please run a rating analysis first.');
            return;
        }
        
        // Generate default filename with page number
        const pageValidation = validatePageNumbers();
        let defaultFilename = 'LLMquality_results';
        
        if (pageValidation.isValid && pageValidation.pageNumber) {
            defaultFilename = `${pageValidation.basename}.${pageValidation.pageNumber}_results`;
        } else {
            // Fallback to timestamp-based filename
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
            defaultFilename = `llm-quality-results-${timestamp}`;
        }
        
        fileName.value = defaultFilename;
        showModal(saveFileModal);
    });

    saveFileOk.addEventListener('click', async function() {
        const fileNameValue = fileName.value.trim();
        if (!fileNameValue) {
            showError('Please enter a file name.');
            return;
        }
        
        // Add .txt extension if not present
        const finalFileName = fileNameValue.endsWith('.txt') ? fileNameValue : fileNameValue + '.txt';
        
        try {
            // Save to client machine
            const saved = await saveToClient(finalFileName, resultsArea.value);
            
            if (saved) {
                // Close modal and show success message
                hideModal(saveFileModal);
                const timestamp = new Date().toLocaleString();
                const saveMethod = ('showSaveFilePicker' in window) ? 'Saved to chosen location' : 'Downloaded to your computer';
                resultsArea.value += `\n\n=== FILE SAVED ===\nTimestamp: ${timestamp}\nFile: ${finalFileName}\nStatus: ${saveMethod}\n==================`;
                resultsArea.scrollTop = resultsArea.scrollHeight;
            } else {
                // User cancelled save dialog
                hideModal(saveFileModal);
            }
        } catch (error) {
            showError('Failed to save file: ' + error.message);
        }
    });

    saveFileCancel.addEventListener('click', function() {
        hideModal(saveFileModal);
    });

    closeSaveFileModal.addEventListener('click', function() {
        hideModal(saveFileModal);
    });

    // Close modals when clicking outside
    window.addEventListener('click', function(event) {
        if (event.target === helpModal) {
            hideModal(helpModal);
        }
        if (event.target === saveFileModal) {
            hideModal(saveFileModal);
        }
    });

    // Real-time validation listeners
    // Save to client machine functionality
    async function saveToClient(filename, content) {
        try {
            // Check if File System Access API is supported (modern browsers)
            if ('showSaveFilePicker' in window) {
                // Use File System Access API for better user experience
                const fileHandle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{
                        description: 'Text files',
                        accept: { 'text/plain': ['.txt'] }
                    }]
                });
                
                const writable = await fileHandle.createWritable();
                await writable.write(content);
                await writable.close();
                
                return true; // Success
            } else {
                // Fallback to traditional download for older browsers
                fallbackSaveToClient(filename, content);
                return true;
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                // User cancelled the save dialog
                return false;
            } else {
                // Other error, fallback to traditional download
                console.warn('File System Access API failed, falling back to download:', error);
                fallbackSaveToClient(filename, content);
                return true;
            }
        }
    }

    // Fallback save function for older browsers
    function fallbackSaveToClient(filename, content) {
        // Create a blob with the content
        const blob = new Blob([content], { type: 'text/plain' });
        
        // Create a temporary URL for the blob
        const url = window.URL.createObjectURL(blob);
        
        // Create a temporary anchor element for download
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        
        // Add to DOM, click, and remove
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // Clean up the temporary URL
        window.URL.revokeObjectURL(url);
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', function(event) {
        // Escape key closes modals
        if (event.key === 'Escape') {
            hideModal(helpModal);
            hideModal(saveFileModal);
        }
        
        // Ctrl/Cmd + Enter submits form
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            if (validateForm().isValid) {
                form.dispatchEvent(new Event('submit'));
            }
        }
    });

    // Initialize
    loadFormValues();
    updateFormValidation();
    
    // Welcome message
    resultsArea.value = `Welcome to LLMquality!\n\nThis application helps you assess the quality of Large Language Model outputs when processing genealogical data.\n\n1. Upload your GEDCOM and XML files\n2. Click 'Compare' to begin assessment\n\nClick 'Help' for detailed instructions.`;
    
    console.log('LLMquality application initialized successfully');
});

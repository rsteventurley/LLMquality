/**
 * LLMquality - Express.js Web Application
 * A genealogical data processing web interface
 * 
 * @author Steve Turley
 * @version 1.1.0
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// Import the data model classes
const GedReader = require('./GEDCOM/GedReader');
const XmlReader = require('./XML/XmlReader');
const CompareModels = require('./DataModel/CompareModels');

// Configure multer for file uploads to temporary directory
const upload = multer({
    dest: path.join(os.tmpdir(), 'llmquality-uploads'),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Set view engine to serve HTML files
app.set('view engine', 'html');
app.engine('html', require('fs').readFileSync);

// Main route - serve the application
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Helper function to fix filename encoding issues
function fixFilenameEncoding(filename) {
    try {
        // Check if the filename is already properly encoded (doesn't contain invalid UTF-8 patterns)
        if (!filename.includes('Ã')) {
            return filename;
        }
        
        // Convert from Latin-1 to UTF-8 by treating each character as a byte
        const bytes = [];
        for (let i = 0; i < filename.length; i++) {
            bytes.push(filename.charCodeAt(i) & 0xFF);
        }
        
        // Convert bytes to UTF-8 string
        const result = Buffer.from(bytes).toString('utf8');
        
        // Validate that the result is sensible UTF-8
        // If it contains replacement characters, fall back to original
        if (result.includes('�')) {
            console.warn('Encoding fix resulted in replacement characters, using original filename');
            return filename;
        }
        
        return result;
    } catch (error) {
        // If conversion fails, return original filename
        console.warn('Failed to fix filename encoding:', error);
        return filename;
    }
}

// API route to handle rating submission
app.post('/api/rate', upload.fields([
    { name: 'gedcom', maxCount: 1 },
    { name: 'xml', maxCount: 1 }
]), async (req, res) => {
    const gedcomFile = req.files && req.files.gedcom && req.files.gedcom[0];
    const xmlFile = req.files && req.files.xml && req.files.xml[0];
    try {
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

        const gedcomOriginalName = fixFilenameEncoding(gedcomFile.originalname);
        const xmlOriginalName = fixFilenameEncoding(xmlFile.originalname);

        // Function to extract location from filename (basename without page number and extension)
        function extractLocationFromFilename(originalName) {
            if (!originalName) return '';
            
            // Remove the extension first
            const nameWithoutExt = originalName.replace(/\.[^.]+$/, '');
            
            // Remove page number pattern (.###) from the end
            const nameWithoutPage = nameWithoutExt.replace(/\.\d{3}$/, '');
            
            return nameWithoutPage || '';
        }

        // Process the GEDCOM file
        let gedPageModel;
        try {
            const gedReader = new GedReader();
            const gedModel = gedReader.read(gedcomFile.path);
            gedPageModel = gedModel.toPageModel();
            gedPageModel.location = extractLocationFromFilename(gedcomOriginalName);
        } catch (error) {
            console.error('Error processing GEDCOM file:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to process GEDCOM file: ' + error.message
            });
        }

        // Process the XML file
        let xmlPageModel;
        try {
            const xmlReader = new XmlReader();
            const xmlModel = await xmlReader.readXml(xmlFile.path);
            xmlPageModel = xmlModel.toPageModel();
            xmlPageModel.location = extractLocationFromFilename(xmlOriginalName);
        } catch (error) {
            console.error('Error processing XML file:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to process XML file: ' + error.message
            });
        }

        // Fill surnames and events for both PageModels before comparison
        try {
            gedPageModel.fillSurname();
            gedPageModel.fillEvents();
            
            xmlPageModel.fillSurname();
            xmlPageModel.fillEvents();
        } catch (error) {
            console.error('Error filling surnames and events:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fill surnames and events: ' + error.message
            });
        }

        // Compare the models and generate results
        const results = await compareModels(gedPageModel, xmlPageModel, {
            gedcomFile: gedcomOriginalName,
            xmlFile: xmlOriginalName
        });

        res.json({
            success: true,
            results: results
        });

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

// Helper function to compare models and generate results
async function compareModels(gedPageModel, xmlPageModel, metadata) {
    // Helper function to get event information for a person
    function getPersonEventInfo(person) {
        if (!person) return '';
        
        // Look for birth or death events to provide meaningful context
        if (person.birth && person.birth.date) {
            return ` (b. ${person.birth.date})`;
        }
        if (person.death && person.death.date) {
            return ` (d. ${person.death.date})`;
        }
        if (person.events && person.events.length > 0) {
            const event = person.events[0];
            if (event.date) {
                return ` (${event.type}: ${event.date})`;
            }
        }
        return '';
    }

    // Create CompareModels object to analyze the differences
    const comparer = new CompareModels(gedPageModel, xmlPageModel);
    
    // Get entry comparison results
    const entryComparison = comparer.compareEntries();
    const peopleComparison = comparer.comparePeople();
    const referencesComparison = comparer.compareReferences();
    const relationshipsComparison = comparer.compareRelationships();
    const eventsComparison = comparer.compareEvents();
    const summary = comparer.getSummary();
    
    const gedEntryCount = gedPageModel.getEntryCount();
    const xmlEntryCount = xmlPageModel.getEntryCount();
    const gedPeopleCount = gedPageModel.getPeopleCount();
    const xmlPeopleCount = xmlPageModel.getPeopleCount();
    
    // Calculate precision, recall, and F1 scores for each category
    function calculateF1Score(precision, recall) {
        if (precision === 0 && recall === 0) return 0;
        return (2 * precision * recall) / (precision + recall);
    }

    const qualityMetrics = {
        entries: { precision: 100, recall: 100, f1: 100 },
        people: { precision: 100, recall: 100, f1: 100 },
        crossReferences: { precision: 100, recall: 100, f1: 100 },
        relationships: { precision: 100, recall: 100, f1: 100 },
        events: { precision: 100, recall: 100, f1: 100 }
    };

    // Entries metrics - assume 100% for both precision and recall if entries were compared
    if (entryComparison.entriesCompared > 0) {
        // Entries comparison typically doesn't have precision/recall errors in this context
        qualityMetrics.entries = { precision: 100, recall: 100, f1: 100 };
    }

    // People metrics from people comparison
    if (peopleComparison.entriesCompared > 0) {
        const peoplePrecision = peopleComparison.precisionRate;
        // For people, we don't have a separate recall rate, so use precision rate as recall too
        const peopleRecall = peoplePrecision;
        qualityMetrics.people = {
            precision: peoplePrecision,
            recall: peopleRecall,
            f1: calculateF1Score(peoplePrecision, peopleRecall)
        };
    }

    // Cross-references metrics from references comparison
    if (referencesComparison.entriesCompared > 0) {
        const crossRefPrecision = Math.max(0, 100 - referencesComparison.precisionErrorRate);
        const crossRefRecall = Math.max(0, 100 - referencesComparison.recallErrorRate);
        qualityMetrics.crossReferences = {
            precision: crossRefPrecision,
            recall: crossRefRecall,
            f1: calculateF1Score(crossRefPrecision, crossRefRecall)
        };
    }

    // Relationships metrics from relationships comparison
    if (relationshipsComparison.entriesCompared > 0) {
        const relationshipPrecision = Math.max(0, 100 - relationshipsComparison.relationshipRecallErrorRate);
        // For relationships, we only have precision errors, so assume 100% recall
        const relationshipRecall = 100;
        qualityMetrics.relationships = {
            precision: relationshipPrecision,
            recall: relationshipRecall,
            f1: calculateF1Score(relationshipPrecision, relationshipRecall)
        };
    }

    // Events metrics from events comparison
    if (eventsComparison.entriesCompared > 0) {
        const eventPrecision = Math.max(0, 100 - eventsComparison.precisionErrorRate);
        const eventRecall = Math.max(0, 100 - eventsComparison.recallErrorRate);
        qualityMetrics.events = {
            precision: eventPrecision,
            recall: eventRecall,
            f1: calculateF1Score(eventPrecision, eventRecall)
        };
    }
    
    // Create detailed entry comparison report
    let entryReport = '';
    if (entryComparison.onlyInFirst.length > 0) {
        entryReport += `\n=== Entries in GEDCOM but not in XML (${entryComparison.onlyInFirst.length}) ===\n`;
        entryComparison.onlyInFirst.forEach(entryId => {
            entryReport += `  • ${entryId}\n`;
        });
    }
    
    if (entryComparison.onlyInSecond.length > 0) {
        entryReport += `\n=== Entries in XML but not in GEDCOM (${entryComparison.onlyInSecond.length}) ===\n`;
        entryComparison.onlyInSecond.forEach(entryId => {
            entryReport += `  • ${entryId}\n`;
        });
    }
    
    if (entryComparison.onlyInFirst.length === 0 && entryComparison.onlyInSecond.length === 0) {
        entryReport += `\n=== Entry Comparison ===\n✓ All entries match between GEDCOM and XML files\n`;
    }

    // Create detailed people comparison report
    let peopleReport = '';
    if (peopleComparison.entriesCompared > 0) {
        peopleReport += `\n=== People Comparison Results ===\n`;
        peopleReport += `Entries compared: ${peopleComparison.entriesCompared}\n`;
        peopleReport += `Total people matches: ${peopleComparison.totalMatches}\n`;
        peopleReport += `  • Exact name matches: ${peopleComparison.exactNameMatches}\n`;
        peopleReport += `  • Event/Reference matches: ${peopleComparison.eventReferenceMatches}\n`;
        peopleReport += `  • Relationship similar matches: ${peopleComparison.relationshipSimilarMatches}\n`;
        peopleReport += `  • Similar name matches: ${peopleComparison.similarNameMatches}\n`;
        
        // Add precision analysis
        peopleReport += `\n=== Precision Analysis ===\n`;
        peopleReport += `Precise matches (exact names): ${peopleComparison.preciseMatches}\n`;
        peopleReport += `Imprecise matches (different names): ${peopleComparison.impreciseMatches}\n`;
        peopleReport += `Precision rate: ${peopleComparison.precisionRate.toFixed(1)}%\n`;
        
        // Show detailed unmatched people information (recall issues)
        let totalUnmatchedInFirst = 0;
        let totalUnmatchedInSecond = 0;
        let unmatchedDetailsFirst = '';
        let unmatchedDetailsSecond = '';
        
        // Show detailed imprecise matches (precision issues)
        let impreciseMatchDetails = '';
        
        peopleComparison.details.forEach(detail => {
            // Process unmatched people (recall issues)
            if (detail.unmatchedInFirst.length > 0) {
                totalUnmatchedInFirst += detail.unmatchedInFirst.length;
                unmatchedDetailsFirst += `\n  Entry ${detail.entryId}:\n`;
                detail.unmatchedInFirst.forEach(person => {
                    const personObj = gedPageModel.people[person.id];
                    const eventInfo = getPersonEventInfo(personObj);
                    unmatchedDetailsFirst += `    • ${person.name}${eventInfo}\n`;
                });
            }
            if (detail.unmatchedInSecond.length > 0) {
                totalUnmatchedInSecond += detail.unmatchedInSecond.length;
                unmatchedDetailsSecond += `\n  Entry ${detail.entryId}:\n`;
                detail.unmatchedInSecond.forEach(person => {
                    const personObj = xmlPageModel.people[person.id];
                    const eventInfo = getPersonEventInfo(personObj);
                    unmatchedDetailsSecond += `    • ${person.name}${eventInfo}\n`;
                });
            }
            
            // Process imprecise matches (precision issues)
            detail.matches.forEach(match => {
                const person1 = gedPageModel.people[match.person1Id];
                const person2 = xmlPageModel.people[match.person2Id];
                
                if (person1 && person2 && !person1.name.exactMatch(person2.name)) {
                    if (!impreciseMatchDetails.includes(`Entry ${detail.entryId}:`)) {
                        impreciseMatchDetails += `\n  Entry ${detail.entryId}:\n`;
                    }
                    const eventInfo1 = getPersonEventInfo(person1);
                    const eventInfo2 = getPersonEventInfo(person2);
                    impreciseMatchDetails += `    • ${match.person1Name}${eventInfo1} ↔ ${match.person2Name}${eventInfo2} [${match.matchType}]\n`;
                }
            });
        });
        
        peopleReport += `Unmatched people in GEDCOM: ${totalUnmatchedInFirst}`;
        if (unmatchedDetailsFirst) {
            peopleReport += unmatchedDetailsFirst;
        } else {
            peopleReport += '\n';
        }
        
        peopleReport += `Unmatched people in XML: ${totalUnmatchedInSecond}`;
        if (unmatchedDetailsSecond) {
            peopleReport += unmatchedDetailsSecond;
        } else {
            peopleReport += '\n';
        }
        
        if (impreciseMatchDetails) {
            peopleReport += `\nImprecise matches (${peopleComparison.impreciseMatches}):${impreciseMatchDetails}`;
        }
        
        if (peopleComparison.details.length > 0 && peopleComparison.totalMatches > 0) {
            peopleReport += `\nMatch Quality Analysis:\n`;
            const matchQuality = (peopleComparison.exactNameMatches + peopleComparison.eventReferenceMatches) / peopleComparison.totalMatches * 100;
            peopleReport += `  • High confidence matches: ${Math.round(matchQuality)}%\n`;
        }
    } else {
        peopleReport += `\n=== People Comparison ===\nNo common entries found for people comparison.\n`;
    }

    // Create detailed cross-references comparison report
    let referencesReport = '';
    if (referencesComparison.entriesCompared > 0) {
        referencesReport += `\n=== Cross-References Comparison Results ===\n`;
        referencesReport += `Entries compared: ${referencesComparison.entriesCompared}\n`;
        referencesReport += `People matches analyzed: ${referencesComparison.totalMatches}\n`;
        referencesReport += `Cross-reference recall errors: ${referencesComparison.crossReferenceRecallErrors}\n`;
        referencesReport += `Cross-reference precision errors: ${referencesComparison.crossReferencePrecisionErrors}\n`;
        referencesReport += `Recall error rate: ${referencesComparison.recallErrorRate.toFixed(1)}%\n`;
        referencesReport += `Precision error rate: ${referencesComparison.precisionErrorRate.toFixed(1)}%\n`;

        // Show detailed recall errors
        let totalRecallErrors = 0;
        let recallErrorDetails = '';
        
        // Show detailed precision errors
        let totalPrecisionErrors = 0;
        let precisionErrorDetails = '';

        referencesComparison.details.forEach(detail => {
            // Process recall errors
            if (detail.recallErrors.length > 0) {
                totalRecallErrors += detail.recallErrors.length;
                recallErrorDetails += `\n  Entry ${detail.entryId}:\n`;
                detail.recallErrors.forEach(error => {
                    const person1 = gedPageModel.people[error.person1Id];
                    const person2 = xmlPageModel.people[error.person2Id];
                    const eventInfo1 = getPersonEventInfo(person1);
                    const eventInfo2 = getPersonEventInfo(person2);
                    recallErrorDetails += `    • ${error.person1Name}${eventInfo1} ↔ ${error.person2Name}${eventInfo2}\n`;
                    recallErrorDetails += `      Expected ${error.expectedCount} refs, found ${error.actualCount} refs\n`;
                    recallErrorDetails += `      Missing references: [${error.missingReferences.join(', ')}]\n`;
                });
            }
            
            // Process precision errors
            if (detail.precisionErrors.length > 0) {
                totalPrecisionErrors += detail.precisionErrors.length;
                precisionErrorDetails += `\n  Entry ${detail.entryId}:\n`;
                detail.precisionErrors.forEach(error => {
                    const person1 = gedPageModel.people[error.person1Id];
                    const person2 = xmlPageModel.people[error.person2Id];
                    const eventInfo1 = getPersonEventInfo(person1);
                    const eventInfo2 = getPersonEventInfo(person2);
                    precisionErrorDetails += `    • ${error.person1Name}${eventInfo1} ↔ ${error.person2Name}${eventInfo2}\n`;
                    precisionErrorDetails += `      GEDCOM refs: [${error.person1References.join(', ')}]\n`;
                    precisionErrorDetails += `      XML refs: [${error.person2References.join(', ')}]\n`;
                    if (error.differentReferences1.length > 0) {
                        precisionErrorDetails += `      Only in GEDCOM: [${error.differentReferences1.join(', ')}]\n`;
                    }
                    if (error.differentReferences2.length > 0) {
                        precisionErrorDetails += `      Only in XML: [${error.differentReferences2.join(', ')}]\n`;
                    }
                });
            }
        });

        if (recallErrorDetails) {
            referencesReport += `\nCross-reference recall errors (${totalRecallErrors}):${recallErrorDetails}`;
        }
        
        if (precisionErrorDetails) {
            referencesReport += `\nCross-reference precision errors (${totalPrecisionErrors}):${precisionErrorDetails}`;
        }
        
        if (totalRecallErrors === 0 && totalPrecisionErrors === 0) {
            referencesReport += `\n✅ All cross-references match perfectly!\n`;
        }
    } else {
        referencesReport += `\n=== Cross-References Comparison ===\nNo common entries found for cross-references comparison.\n`;
    }
    
    // Create detailed relationships comparison report
    let relationshipsReport = '';
    if (relationshipsComparison.entriesCompared > 0) {
        relationshipsReport += `\n=== Relationships Comparison Results ===\n`;
        relationshipsReport += `Entries compared: ${relationshipsComparison.entriesCompared}\n`;
        relationshipsReport += `People matches analyzed: ${relationshipsComparison.totalMatches}\n`;
        relationshipsReport += `Relationship precision errors: ${relationshipsComparison.relationshipRecallErrors}\n`;
        relationshipsReport += `Relationship precision error rate: ${relationshipsComparison.relationshipRecallErrorRate.toFixed(1)}%\n`;

        // Show detailed precision errors
        let totalRelationshipErrors = 0;
        let relationshipErrorDetails = '';

        relationshipsComparison.details.forEach(detail => {
            // Process relationship precision errors
            if (detail.recallErrors.length > 0) {
                totalRelationshipErrors += detail.recallErrors.length;
                relationshipErrorDetails += `\n  Entry ${detail.entryId}:\n`;
                detail.recallErrors.forEach(error => {
                    const person1 = gedPageModel.people[error.person1Id];
                    const person2 = xmlPageModel.people[error.person2Id];
                    const eventInfo1 = getPersonEventInfo(person1);
                    const eventInfo2 = getPersonEventInfo(person2);
                    relationshipErrorDetails += `    • ${error.person1Name}${eventInfo1} ↔ ${error.person2Name}${eventInfo2}\n`;
                    relationshipErrorDetails += `      GEDCOM relationship: "${error.relationship1}" (letters: "${error.letters1}")\n`;
                    relationshipErrorDetails += `      XML relationship: "${error.relationship2}" (letters: "${error.letters2}")\n`;
                    relationshipErrorDetails += `      Match type: ${error.matchType}\n`;
                });
            }
        });

        if (relationshipErrorDetails) {
            relationshipsReport += `\nRelationship precision errors (${totalRelationshipErrors}):${relationshipErrorDetails}`;
        }
        
        if (totalRelationshipErrors === 0) {
            relationshipsReport += `\n✅ All relationship strings match perfectly!\n`;
        }
    } else {
        relationshipsReport += `\n=== Relationships Comparison ===\nNo common entries found for relationships comparison.\n`;
    }
    
    // Create detailed events comparison report
    let eventsReport = '';
    if (eventsComparison.entriesCompared > 0) {
        eventsReport += `\n=== Events Comparison Results ===\n`;
        eventsReport += `Entries compared: ${eventsComparison.entriesCompared}\n`;
        eventsReport += `People matches analyzed: ${eventsComparison.totalMatches}\n`;
        eventsReport += `Event recall errors: ${eventsComparison.eventRecallErrors}\n`;
        eventsReport += `Event precision errors: ${eventsComparison.eventPrecisionErrors}\n`;
        eventsReport += `Event recall error rate: ${eventsComparison.recallErrorRate.toFixed(1)}%\n`;
        eventsReport += `Event precision error rate: ${eventsComparison.precisionErrorRate.toFixed(1)}%\n`;

        // Show detailed recall errors
        let totalEventRecallErrors = 0;
        let eventRecallErrorDetails = '';
        
        // Show detailed precision errors
        let totalEventPrecisionErrors = 0;
        let eventPrecisionErrorDetails = '';

        eventsComparison.details.forEach(detail => {
            // Process event recall errors
            if (detail.recallErrors.length > 0) {
                totalEventRecallErrors += detail.recallErrors.length;
                eventRecallErrorDetails += `\n  Entry ${detail.entryId}:\n`;
                detail.recallErrors.forEach(error => {
                    const person1 = gedPageModel.people[error.person1Id];
                    const person2 = xmlPageModel.people[error.person2Id];
                    const eventInfo1 = getPersonEventInfo(person1);
                    const eventInfo2 = getPersonEventInfo(person2);
                    eventRecallErrorDetails += `    • ${error.person1Name}${eventInfo1} ↔ ${error.person2Name}${eventInfo2}\n`;
                    
                    // Map 'first' to 'GEDCOM' and 'second' to 'XML' for user-friendly error messages
                    const fileType = error.missingIn === 'first' ? 'GEDCOM' : 'XML';
                    
                    if (error.eventType === 'marriage') {
                        eventRecallErrorDetails += `      Missing ${error.eventType} event: ${error.families1Count} vs ${error.families2Count} families\n`;
                        eventRecallErrorDetails += `      Missing in: ${fileType} file\n`;
                    } else {
                        eventRecallErrorDetails += `      Missing ${error.eventType} event in: ${fileType} file\n`;
                        eventRecallErrorDetails += `      GEDCOM ${error.eventType}: ${error.event1 || 'None'}\n`;
                        eventRecallErrorDetails += `      XML ${error.eventType}: ${error.event2 || 'None'}\n`;
                    }
                });
            }
            
            // Process event precision errors
            if (detail.precisionErrors.length > 0) {
                totalEventPrecisionErrors += detail.precisionErrors.length;
                eventPrecisionErrorDetails += `\n  Entry ${detail.entryId}:\n`;
                detail.precisionErrors.forEach(error => {
                    const person1 = gedPageModel.people[error.person1Id];
                    const person2 = xmlPageModel.people[error.person2Id];
                    const eventInfo1 = getPersonEventInfo(person1);
                    const eventInfo2 = getPersonEventInfo(person2);
                    eventPrecisionErrorDetails += `    • ${error.person1Name}${eventInfo1} ↔ ${error.person2Name}${eventInfo2}\n`;
                    eventPrecisionErrorDetails += `      ${error.eventType} event mismatch:\n`;
                    eventPrecisionErrorDetails += `      GEDCOM: ${error.event1}\n`;
                    eventPrecisionErrorDetails += `      XML: ${error.event2}\n`;
                    if (error.datesDiffer) {
                        eventPrecisionErrorDetails += `      Dates differ\n`;
                    }
                    if (error.placesDiffer) {
                        eventPrecisionErrorDetails += `      Places differ\n`;
                    }
                    if (error.familyIndex !== undefined) {
                        eventPrecisionErrorDetails += `      Family index: ${error.familyIndex}\n`;
                    }
                });
            }
        });

        if (eventRecallErrorDetails) {
            eventsReport += `\nEvent recall errors (${totalEventRecallErrors}):${eventRecallErrorDetails}`;
        }
        
        if (eventPrecisionErrorDetails) {
            eventsReport += `\nEvent precision errors (${totalEventPrecisionErrors}):${eventPrecisionErrorDetails}`;
        }
        
        if (totalEventRecallErrors === 0 && totalEventPrecisionErrors === 0) {
            eventsReport += `\n✅ All events match perfectly!\n`;
        }
    } else {
        eventsReport += `\n=== Events Comparison ===\nNo common entries found for events comparison.\n`;
    }
    
    return `
=== LLM Quality Rating Results ===
GEDCOM File: ${metadata.gedcomFile}
XML File: ${metadata.xmlFile}
Timestamp: ${new Date().toISOString()}

=== File Processing Summary ===
GEDCOM Entries Processed: ${gedEntryCount}
XML Entries Processed: ${xmlEntryCount}
GEDCOM People Count: ${gedPeopleCount}
XML People Count: ${xmlPeopleCount}
Common Entries: ${summary.commonEntries}
Location: ${summary.pageModel1.location}
${entryReport}${peopleReport}${referencesReport}${relationshipsReport}${eventsReport}

=== Quality Metrics ===
Entries:
  Precision: ${qualityMetrics.entries.precision.toFixed(1)}%
  Recall: ${qualityMetrics.entries.recall.toFixed(1)}%
  F1 Score: ${qualityMetrics.entries.f1.toFixed(1)}%

People:
  Precision: ${qualityMetrics.people.precision.toFixed(1)}%
  Recall: ${qualityMetrics.people.recall.toFixed(1)}%
  F1 Score: ${qualityMetrics.people.f1.toFixed(1)}%

Cross-References:
  Precision: ${qualityMetrics.crossReferences.precision.toFixed(1)}%
  Recall: ${qualityMetrics.crossReferences.recall.toFixed(1)}%
  F1 Score: ${qualityMetrics.crossReferences.f1.toFixed(1)}%

Relationships:
  Precision: ${qualityMetrics.relationships.precision.toFixed(1)}%
  Recall: ${qualityMetrics.relationships.recall.toFixed(1)}%
  F1 Score: ${qualityMetrics.relationships.f1.toFixed(1)}%

Events:
  Precision: ${qualityMetrics.events.precision.toFixed(1)}%
  Recall: ${qualityMetrics.events.recall.toFixed(1)}%
  F1 Score: ${qualityMetrics.events.f1.toFixed(1)}%

=== Analysis Summary ===
${(() => {
    const avgF1 = (qualityMetrics.entries.f1 + qualityMetrics.people.f1 + qualityMetrics.crossReferences.f1 + qualityMetrics.relationships.f1 + qualityMetrics.events.f1) / 5;
    if (avgF1 >= 90) return '✓ Excellent data quality across all categories';
    if (avgF1 >= 80) return '✓ Good data quality with minor discrepancies';
    if (avgF1 >= 70) return '⚠ Acceptable data quality with some issues to address';
    if (avgF1 >= 60) return '⚠ Below average data quality - significant improvements needed';
    return '❌ Poor data quality - major data integrity issues detected';
})()}
Average F1 Score: ${((qualityMetrics.entries.f1 + qualityMetrics.people.f1 + qualityMetrics.crossReferences.f1 + qualityMetrics.relationships.f1 + qualityMetrics.events.f1) / 5).toFixed(1)}%

Processing completed successfully.
    `.trim();
}

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

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Error:', error);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

// Start server
app.listen(PORT, () => {
    console.log('LLMquality Server Started on port ' + PORT);
});

module.exports = app;

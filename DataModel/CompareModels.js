/**
 * CompareModels - A class for comparing data between two PageModel objects
 * Provides various comparison methods to analyze differences between genealogical datasets
 * 
 * @author Steve Turley
 * @version 1.0.0
 */

class CompareModels {
    /**
     * Create a new CompareModels object
     * @param {PageModel} pageModel1 - The first PageModel to compare
     * @param {PageModel} pageModel2 - The second PageModel to compare
     */
    constructor(pageModel1, pageModel2) {
        this.pageModel1 = pageModel1;
        this.pageModel2 = pageModel2;
    }

    /**
     * Get common entries between the two PageModels
     * @returns {Array<string>} Array of entry IDs that exist in both PageModels
     * @private
     */
    _getCommonEntries() {
        const entriesFirst = Object.keys(this.pageModel1.entries);
        const entriesSecond = Object.keys(this.pageModel2.entries);
        return entriesFirst.filter(entryId => entriesSecond.includes(entryId));
    }

    /**
     * Prepare people arrays for comparison from entry objects
     * @param {EntryModel} entry1 - Entry from first PageModel
     * @param {EntryModel} entry2 - Entry from second PageModel
     * @returns {Object} Object containing people arrays and match tracking sets
     * @private
     */
    _preparePeopleForComparison(entry1, entry2) {
        const people1 = Object.keys(entry1.people).map(id => ({ id: parseInt(id), person: entry1.people[id] }));
        const people2 = Object.keys(entry2.people).map(id => ({ id: parseInt(id), person: entry2.people[id] }));
        const matched1 = new Set();
        const matched2 = new Set();
        
        return { people1, people2, matched1, matched2 };
    }

    /**
     * Execute the complete people matching algorithm between two entry's people
     * @param {Array} people1 - People array from first entry
     * @param {Array} people2 - People array from second entry
     * @param {EntryModel} entry1 - Entry from first PageModel
     * @param {EntryModel} entry2 - Entry from second PageModel
     * @param {Object} result - Result object to populate with matches
     * @param {Set} matched1 - Set to track matched people from first entry
     * @param {Set} matched2 - Set to track matched people from second entry
     * @private
     */
    _executeCompleteMatchingAlgorithm(people1, people2, entry1, entry2, result, matched1, matched2) {
        // Priority 1: Exact name matches that are unique within the entry
        this._findExactNameMatches(people1, people2, entry1, entry2, result, matched1, matched2);

        // Priority 2: Same events or references
        this._findEventReferenceMatches(people1, people2, result, matched1, matched2);

        // Priority 3: Relationship similar matches
        this._findRelationshipSimilarMatches(people1, people2, entry1, entry2, result, matched1, matched2);

        // Priority 4: Similar names
        this._findSimilarNameMatches(people1, people2, result, matched1, matched2);

        // Priority 5: Final pass for exact names (handles ambiguous cases)
        this._findExactNameMatchesFinalPass(people1, people2, entry1, entry2, result, matched1, matched2);
    }

    /**
     * Calculate error rates for comparison results
     * @param {number} errors - Number of errors
     * @param {number} total - Total items compared
     * @returns {number} Error rate as percentage
     * @private
     */
    _calculateErrorRate(errors, total) {
        return total > 0 ? (errors / total) * 100 : 0.0;
    }

    /**
     * Compare entries between the two PageModels
     * @returns {Object} Object containing arrays of entry IDs that are unique to each model
     * @returns {Array<string>} returns.onlyInFirst - Entry IDs that appear only in the first PageModel
     * @returns {Array<string>} returns.onlyInSecond - Entry IDs that appear only in the second PageModel
     */
    compareEntries() {
        // Get entry IDs from both PageModels
        const entriesFirst = Object.keys(this.pageModel1.entries);
        const entriesSecond = Object.keys(this.pageModel2.entries);

        // Convert to Sets for efficient comparison
        const setFirst = new Set(entriesFirst);
        const setSecond = new Set(entriesSecond);

        // Find entries that are only in the first PageModel
        const onlyInFirst = entriesFirst.filter(entryId => !setSecond.has(entryId));

        // Find entries that are only in the second PageModel
        const onlyInSecond = entriesSecond.filter(entryId => !setFirst.has(entryId));

        return {
            onlyInFirst,
            onlyInSecond
        };
    }

    /**
     * Compare people between entries in the two PageModels
     * @returns {Object} Object containing detailed people comparison results
     */
    comparePeople() {
        const results = {
            entriesCompared: 0,
            totalMatches: 0,
            exactNameMatches: 0,
            eventReferenceMatches: 0,
            relationshipSimilarMatches: 0,
            similarNameMatches: 0,
            unmatchedInFirst: 0,
            unmatchedInSecond: 0,
            // Precision metrics
            preciseMatches: 0,
            impreciseMatches: 0,
            precisionRate: 0.0,
            details: []
        };

        // Get common entries using shared method
        const commonEntries = this._getCommonEntries();
        results.entriesCompared = commonEntries.length;

        // Compare people in each common entry
        for (const entryId of commonEntries) {
            const entry1 = this.pageModel1.entries[entryId];
            const entry2 = this.pageModel2.entries[entryId];

            const entryResult = this._comparePeopleInEntry(entry1, entry2, entryId);
            results.details.push(entryResult);

            // Aggregate statistics
            results.totalMatches += entryResult.matches.length;
            results.exactNameMatches += entryResult.exactNameMatches;
            results.eventReferenceMatches += entryResult.eventReferenceMatches;
            results.relationshipSimilarMatches += entryResult.relationshipSimilarMatches;
            results.similarNameMatches += entryResult.similarNameMatches;
            results.unmatchedInFirst += entryResult.unmatchedInFirst.length;
            results.unmatchedInSecond += entryResult.unmatchedInSecond.length;
            
            // Calculate precision for each match
            for (const match of entryResult.matches) {
                const person1 = this.pageModel1.people[match.person1Id];
                const person2 = this.pageModel2.people[match.person2Id];
                
                if (person1 && person2) {
                    if (person1.name.exactMatch(person2.name)) {
                        results.preciseMatches++;
                    } else {
                        results.impreciseMatches++;
                    }
                } else {
                    // If people not found in dictionary, count as imprecise
                    results.impreciseMatches++;
                }
            }
        }

        // Calculate overall precision rate
        if (results.totalMatches > 0) {
            results.precisionRate = (results.preciseMatches / results.totalMatches) * 100;
        }

        return results;
    }

    /**
     * Compare people within a single entry between the two models
     * @param {EntryModel} entry1 - Entry from first PageModel
     * @param {EntryModel} entry2 - Entry from second PageModel
     * @param {string} entryId - The entry ID being compared
     * @returns {Object} Detailed comparison results for this entry
     * @private
     */
    _comparePeopleInEntry(entry1, entry2, entryId) {
        const result = {
            entryId: entryId,
            people1Count: Object.keys(entry1.people).length,
            people2Count: Object.keys(entry2.people).length,
            matches: [],
            unmatchedInFirst: [],
            unmatchedInSecond: [],
            exactNameMatches: 0,
            eventReferenceMatches: 0,
            relationshipSimilarMatches: 0,
            similarNameMatches: 0
        };

        // Prepare people arrays and match tracking using shared method
        const { people1, people2, matched1, matched2 } = this._preparePeopleForComparison(entry1, entry2);

        // Execute complete matching algorithm using shared method
        this._executeCompleteMatchingAlgorithm(people1, people2, entry1, entry2, result, matched1, matched2);

        // Record unmatched people
        result.unmatchedInFirst = people1.filter(p => !matched1.has(p.id)).map(p => ({
            id: p.id,
            name: p.person.name.toString()
        }));
        
        result.unmatchedInSecond = people2.filter(p => !matched2.has(p.id)).map(p => ({
            id: p.id,
            name: p.person.name.toString()
        }));

        return result;
    }

    /**
     * Find people with exact name matches that are unique within the entry
     * @private
     */
    _findExactNameMatches(people1, people2, entry1, entry2, result, matched1, matched2) {
        for (const person1 of people1) {
            if (matched1.has(person1.id)) continue;

            // Check if this name is unique in entry1
            const sameNameInEntry1 = people1.filter(p => p.person.name.exactMatch(person1.person.name));
            if (sameNameInEntry1.length > 1) continue; // Skip if not unique

            for (const person2 of people2) {
                if (matched2.has(person2.id)) continue;

                if (person1.person.name.exactMatch(person2.person.name)) {
                    // Check birth date compatibility first
                    if (!this._haveSimilarBirthDates(person1.person, person2.person)) {
                        continue;
                    }
                    
                    // Check if this name is unique in entry2
                    const sameNameInEntry2 = people2.filter(p => p.person.name.exactMatch(person2.person.name));
                    if (sameNameInEntry2.length === 1) { // Must be unique
                        result.matches.push({
                            person1Id: person1.id,
                            person2Id: person2.id,
                            person1Name: person1.person.name.toString(),
                            person2Name: person2.person.name.toString(),
                            matchType: 'exactNameUnique'
                        });
                        matched1.add(person1.id);
                        matched2.add(person2.id);
                        result.exactNameMatches++;
                        break;
                    }
                }
            }
        }
    }

    /**
     * Find people with matching events or references
     * @private
     */
    _findEventReferenceMatches(people1, people2, result, matched1, matched2) {
        for (const person1 of people1) {
            if (matched1.has(person1.id)) continue;

            for (const person2 of people2) {
                if (matched2.has(person2.id)) continue;

                if (this._hasMatchingEventsOrReferences(person1.person, person2.person)) {
                    // Check birth date compatibility first
                    if (!this._haveSimilarBirthDates(person1.person, person2.person)) {
                        continue;
                    }
                    
                    result.matches.push({
                        person1Id: person1.id,
                        person2Id: person2.id,
                        person1Name: person1.person.name.toString(),
                        person2Name: person2.person.name.toString(),
                        matchType: 'eventReference'
                    });
                    matched1.add(person1.id);
                    matched2.add(person2.id);
                    result.eventReferenceMatches++;
                    break;
                }
            }
        }
    }

    /**
     * Find people with similar names and same relationship
     * @private
     */
    _findRelationshipSimilarMatches(people1, people2, entry1, entry2, result, matched1, matched2) {
        for (const person1 of people1) {
            if (matched1.has(person1.id)) continue;

            for (const person2 of people2) {
                if (matched2.has(person2.id)) continue;

                if (person1.person.name.similarMatch(person2.person.name)) {
                    // Check birth date compatibility first
                    if (!this._haveSimilarBirthDates(person1.person, person2.person)) {
                        continue;
                    }
                    
                    // Additional check: surnames should be similar too for relationship matching
                    // Don't match people with completely different surnames unless they have other evidence
                    const surname1 = person1.person.name.surname.toLowerCase();
                    const surname2 = person2.person.name.surname.toLowerCase();
                    
                    // Create temporary NameModel objects to test surname similarity
                    const NameModel = require('./NameModel');
                    const surnameTest1 = new NameModel('Test', person1.person.name.surname);
                    const surnameTest2 = new NameModel('Test', person2.person.name.surname);
                    
                    // If surnames are not similar, skip this match
                    if (!surnameTest1.similarMatch(surnameTest2)) {
                        continue;
                    }
                    
                    const relationship1 = entry1.getRelationship(person1.id);
                    const relationship2 = entry2.getRelationship(person2.id);
                    
                    if (relationship1 === relationship2 && relationship1 !== '') {
                        // For exact name matches, check for uniqueness to avoid ambiguous matches
                        if (person1.person.name.exactMatch(person2.person.name)) {
                            const sameNameInEntry1 = people1.filter(p => p.person.name.exactMatch(person1.person.name));
                            const sameNameInEntry2 = people2.filter(p => p.person.name.exactMatch(person2.person.name));
                            
                            // Skip if name is not unique in either entry (ambiguous match)
                            if (sameNameInEntry1.length > 1 || sameNameInEntry2.length > 1) {
                                continue;
                            }
                        }
                        
                        result.matches.push({
                            person1Id: person1.id,
                            person2Id: person2.id,
                            person1Name: person1.person.name.toString(),
                            person2Name: person2.person.name.toString(),
                            matchType: 'relationshipSimilar',
                            relationship: relationship1
                        });
                        matched1.add(person1.id);
                        matched2.add(person2.id);
                        result.relationshipSimilarMatches++;
                        break;
                    }
                }
            }
        }
    }

    /**
     * Find people with similar names (fallback matching)
     * @private
     */
    _findSimilarNameMatches(people1, people2, result, matched1, matched2) {
        for (const person1 of people1) {
            if (matched1.has(person1.id)) continue;

            for (const person2 of people2) {
                if (matched2.has(person2.id)) continue;

                if (person1.person.name.similarMatch(person2.person.name)) {
                    // Check birth date compatibility first
                    if (!this._haveSimilarBirthDates(person1.person, person2.person)) {
                        continue;
                    }
                    
                    // For exact name matches, check for uniqueness to avoid ambiguous matches
                    if (person1.person.name.exactMatch(person2.person.name)) {
                        const sameNameInEntry1 = people1.filter(p => p.person.name.exactMatch(person1.person.name));
                        const sameNameInEntry2 = people2.filter(p => p.person.name.exactMatch(person2.person.name));
                        
                        // Skip if name is not unique in either entry (ambiguous match)
                        if (sameNameInEntry1.length > 1 || sameNameInEntry2.length > 1) {
                            continue;
                        }
                    }
                    
                    result.matches.push({
                        person1Id: person1.id,
                        person2Id: person2.id,
                        person1Name: person1.person.name.toString(),
                        person2Name: person2.person.name.toString(),
                        matchType: 'similarName'
                    });
                    matched1.add(person1.id);
                    matched2.add(person2.id);
                    result.similarNameMatches++;
                    break;
                }
            }
        }
    }

    /**
     * Final pass for exact name matches after other matching phases
     * This handles cases where names were initially ambiguous but ambiguity was resolved
     * by other matches (events, relationships, etc.)
     * @private
     */
    _findExactNameMatchesFinalPass(people1, people2, entry1, entry2, result, matched1, matched2) {
        for (const person1 of people1) {
            if (matched1.has(person1.id)) continue;

            for (const person2 of people2) {
                if (matched2.has(person2.id)) continue;

                if (person1.person.name.exactMatch(person2.person.name)) {
                    // Check birth date compatibility first
                    if (!this._haveSimilarBirthDates(person1.person, person2.person)) {
                        continue;
                    }
                    
                    // Check if this name is now unique among unmatched people
                    const unmatchedPeople1 = people1.filter(p => !matched1.has(p.id));
                    const unmatchedPeople2 = people2.filter(p => !matched2.has(p.id));
                    
                    const sameNameInUnmatched1 = unmatchedPeople1.filter(p => p.person.name.exactMatch(person1.person.name));
                    const sameNameInUnmatched2 = unmatchedPeople2.filter(p => p.person.name.exactMatch(person2.person.name));
                    
                    // Only match if the name is unique among remaining unmatched people
                    if (sameNameInUnmatched1.length === 1 && sameNameInUnmatched2.length === 1) {
                        result.matches.push({
                            person1Id: person1.id,
                            person2Id: person2.id,
                            person1Name: person1.person.name.toString(),
                            person2Name: person2.person.name.toString(),
                            matchType: 'exactNameResolved'
                        });
                        matched1.add(person1.id);
                        matched2.add(person2.id);
                        result.exactNameMatches++;
                        break;
                    }
                }
            }
        }
    }

    /**
     * Normalize a cross-reference by stripping the person-number suffix.
     * An LLM may return "1414.7" to mean the 7th person in entry 1414, but
     * the GEDCOM file only stores the entry number "1414". Stripping the suffix
     * lets both forms compare equal.
     * @param {string} ref - The reference string to normalize
     * @returns {string} The reference with any ".N" person-number suffix removed
     * @private
     */
    _normalizeReference(ref) {
        // Only strip the suffix when the entire ref is "digits.digits"
        if (/^\d+\.\d+$/.test(ref)) {
            return ref.split('.')[0];
        }
        return ref;
    }

    /**
     * Check if two people have compatible birth dates (not too far apart)
     * @param {PersonModel} person1 - First person to compare
     * @param {PersonModel} person2 - Second person to compare
     * @returns {boolean} True if birth dates are compatible or unknown
     * @private
     */
    _haveSimilarBirthDates(person1, person2) {
        const birthYear1 = person1.birth && person1.birth.date ? person1.birth.date.year : null;
        const birthYear2 = person2.birth && person2.birth.date ? person2.birth.date.year : null;
        
        // If either birth year is unknown, consider them compatible
        if (!birthYear1 || !birthYear2 || birthYear1 === 0 || birthYear2 === 0) {
            return true;
        }
        
        // Allow up to 5 years difference for birth dates
        // This accounts for approximate dates and minor recording errors
        const yearDifference = Math.abs(birthYear1 - birthYear2);
        return yearDifference <= 5;
    }

    /**
     * Check if two people have matching events or references
     * @param {PersonModel} person1 - First person to compare
     * @param {PersonModel} person2 - Second person to compare
     * @returns {boolean} True if they have at least one matching event or reference
     * @private
     */
    _hasMatchingEventsOrReferences(person1, person2) {
        // Compare references
        const refs1 = person1.references || [];
        const refs2 = person2.references || [];
        
        for (const ref1 of refs1) {
            const normalized1 = this._normalizeReference(ref1);
            if (refs2.some(ref2 => this._normalizeReference(ref2) === normalized1)) {
                return true; // Found matching reference
            }
        }

        // Compare events (birth, death, christening, burial)
        const events1 = [person1.birth, person1.death, person1.christening, person1.burial];
        const events2 = [person2.birth, person2.death, person2.christening, person2.burial];

        for (let i = 0; i < events1.length; i++) {
            if (this._eventsMatch(events1[i], events2[i])) {
                return true; // Found matching event
            }
        }

        return false;
    }

    /**
     * Check if two events match (same date and/or place)
     * @param {EventModel} event1 - First event to compare
     * @param {EventModel} event2 - Second event to compare
     * @returns {boolean} True if events have matching non-empty data
     * @private
     */
    _eventsMatch(event1, event2) {
        if (!event1 || !event2) return false;
        
        // If either event is empty, they don't match
        if (event1.isEmpty() || event2.isEmpty()) return false;
        
        // Events match if they have the same non-empty date or place
        const date1Str = event1.date ? event1.date.toString() : '';
        const date2Str = event2.date ? event2.date.toString() : '';
        const place1 = event1.place || '';
        const place2 = event2.place || '';

        return (date1Str !== '' && date1Str === date2Str) ||
               (place1 !== '' && place1 === place2);
    }

    /**
     * Get a summary of the comparison between the two PageModels
     * @returns {Object} Summary statistics about the comparison
     */
    getSummary() {
        const entryComparison = this.compareEntries();

        return {
            pageModel1: {
                totalEntries: Object.keys(this.pageModel1.entries).length,
                totalPeople: Object.keys(this.pageModel1.people).length,
                totalFamilies: Object.keys(this.pageModel1.families).length,
                location: this.pageModel1.location || 'Unknown'
            },
            pageModel2: {
                totalEntries: Object.keys(this.pageModel2.entries).length,
                totalPeople: Object.keys(this.pageModel2.people).length,
                totalFamilies: Object.keys(this.pageModel2.families).length,
                location: this.pageModel2.location || 'Unknown'
            },
            entriesOnlyInFirst: entryComparison.onlyInFirst.length,
            entriesOnlyInSecond: entryComparison.onlyInSecond.length,
            commonEntries: Object.keys(this.pageModel1.entries).length - entryComparison.onlyInFirst.length
        };
    }

    /**
     * Generate a detailed report of the comparison
     * @returns {string} Formatted report string
     */
    generateReport() {
        const entryComparison = this.compareEntries();
        const summary = this.getSummary();

        let report = '=== PageModel Comparison Report ===\n\n';
        
        report += `First PageModel (${summary.pageModel1.location}):\n`;
        report += `  - Entries: ${summary.pageModel1.totalEntries}\n`;
        report += `  - People: ${summary.pageModel1.totalPeople}\n`;
        report += `  - Families: ${summary.pageModel1.totalFamilies}\n\n`;

        report += `Second PageModel (${summary.pageModel2.location}):\n`;
        report += `  - Entries: ${summary.pageModel2.totalEntries}\n`;
        report += `  - People: ${summary.pageModel2.totalPeople}\n`;
        report += `  - Families: ${summary.pageModel2.totalFamilies}\n\n`;

        report += `Comparison Results:\n`;
        report += `  - Common entries: ${summary.commonEntries}\n`;
        report += `  - Entries only in first: ${summary.entriesOnlyInFirst}\n`;
        report += `  - Entries only in second: ${summary.entriesOnlyInSecond}\n\n`;

        if (entryComparison.onlyInFirst.length > 0) {
            report += `Entries only in first PageModel:\n`;
            entryComparison.onlyInFirst.forEach(entryId => {
                report += `  - ${entryId}\n`;
            });
            report += '\n';
        }

        if (entryComparison.onlyInSecond.length > 0) {
            report += `Entries only in second PageModel:\n`;
            entryComparison.onlyInSecond.forEach(entryId => {
                report += `  - ${entryId}\n`;
            });
            report += '\n';
        }

        return report;
    }

    /**
     * Compare cross-references between people in the two PageModels
     * First matches people using the same algorithm as comparePeople, then checks if their references match
     * @returns {Object} Object containing cross-reference comparison results
     */
    compareReferences() {
        const results = {
            entriesCompared: 0,
            totalMatches: 0,
            crossReferenceRecallErrors: 0,
            crossReferencePrecisionErrors: 0,
            recallErrorRate: 0.0,
            precisionErrorRate: 0.0,
            details: []
        };

        // Get common entries using shared method
        const commonEntries = this._getCommonEntries();
        results.entriesCompared = commonEntries.length;

        // Compare references in each common entry
        for (const entryId of commonEntries) {
            const entry1 = this.pageModel1.entries[entryId];
            const entry2 = this.pageModel2.entries[entryId];

            const entryResult = this._compareReferencesInEntry(entry1, entry2, entryId);
            results.details.push(entryResult);

            // Aggregate statistics
            results.totalMatches += entryResult.matches.length;
            results.crossReferenceRecallErrors += entryResult.recallErrors.length;
            results.crossReferencePrecisionErrors += entryResult.precisionErrors.length;
        }

        // Calculate error rates using shared method
        results.recallErrorRate = this._calculateErrorRate(results.crossReferenceRecallErrors, results.totalMatches);
        results.precisionErrorRate = this._calculateErrorRate(results.crossReferencePrecisionErrors, results.totalMatches);

        return results;
    }

    /**
     * Compare cross-references within a single entry between the two models
     * @param {EntryModel} entry1 - Entry from first PageModel
     * @param {EntryModel} entry2 - Entry from second PageModel
     * @param {string} entryId - The entry ID being compared
     * @returns {Object} Detailed cross-reference comparison results for this entry
     * @private
     */
    _compareReferencesInEntry(entry1, entry2, entryId) {
        const result = {
            entryId: entryId,
            matches: [],
            recallErrors: [],
            precisionErrors: []
        };

        // Prepare people arrays and match tracking using shared method
        const { people1, people2, matched1, matched2 } = this._preparePeopleForComparison(entry1, entry2);

        // Execute complete matching algorithm using shared method
        this._executeCompleteMatchingAlgorithm(people1, people2, entry1, entry2, result, matched1, matched2);

        // Now compare cross-references for matched people
        for (const match of result.matches) {
            const person1 = this.pageModel1.people[match.person1Id];
            const person2 = this.pageModel2.people[match.person2Id];

            if (person1 && person2) {
                const referenceComparison = this._comparePersonReferences(person1, person2, match);
                
                if (referenceComparison && referenceComparison.type === 'recall') {
                    result.recallErrors.push(referenceComparison);
                } else if (referenceComparison && referenceComparison.type === 'precision') {
                    result.precisionErrors.push(referenceComparison);
                }
            }
        }

        return result;
    }

    /**
     * Compare cross-references between two matched people
     * @param {PersonModel} person1 - Person from first PageModel
     * @param {PersonModel} person2 - Person from second PageModel
     * @param {Object} match - The match object containing person IDs and names
     * @returns {Object|null} Reference comparison result or null if references match perfectly
     * @private
     */
    _comparePersonReferences(person1, person2, match) {
        const refs1 = person1.references || [];
        const refs2 = person2.references || [];

        const normalizedRefs1 = refs1.map(ref => this._normalizeReference(ref));
        const normalizedRefs2 = refs2.map(ref => this._normalizeReference(ref));

        // Check if the number of references differs (recall error)
        if (normalizedRefs1.length !== normalizedRefs2.length) {
            const normalizedRefs2Set = new Set(normalizedRefs2);
            const normalizedRefs1Set = new Set(normalizedRefs1);

            const missingRefs = normalizedRefs1.length > normalizedRefs2.length
                ? refs1.filter((ref, i) => !normalizedRefs2Set.has(normalizedRefs1[i]))
                : refs2.filter((ref, i) => !normalizedRefs1Set.has(normalizedRefs2[i]));

            return {
                type: 'recall',
                person1Id: match.person1Id,
                person2Id: match.person2Id,
                person1Name: match.person1Name,
                person2Name: match.person2Name,
                person1References: refs1,
                person2References: refs2,
                missingReferences: missingRefs,
                expectedCount: Math.max(refs1.length, refs2.length),
                actualCount: Math.min(refs1.length, refs2.length)
            };
        }

        // If counts match, check if the actual normalized references are the same (precision error)
        if (normalizedRefs1.length > 0 && normalizedRefs2.length > 0) {
            const normalizedRefs1Set = new Set(normalizedRefs1);
            const normalizedRefs2Set = new Set(normalizedRefs2);

            const differentRefs1 = refs1.filter((ref, i) => !normalizedRefs2Set.has(normalizedRefs1[i]));
            const differentRefs2 = refs2.filter((ref, i) => !normalizedRefs1Set.has(normalizedRefs2[i]));

            if (differentRefs1.length > 0 || differentRefs2.length > 0) {
                return {
                    type: 'precision',
                    person1Id: match.person1Id,
                    person2Id: match.person2Id,
                    person1Name: match.person1Name,
                    person2Name: match.person2Name,
                    person1References: refs1,
                    person2References: refs2,
                    differentReferences1: differentRefs1,
                    differentReferences2: differentRefs2
                };
            }
        }

        // References match perfectly
        return null;
    }

    /**
     * Compare relationship strings between people in the two PageModels
     * First matches people using the same algorithm as comparePeople, then checks if their relationship strings match
     * @returns {Object} Object containing relationship comparison results
     */
    compareRelationships() {
        const results = {
            entriesCompared: 0,
            totalMatches: 0,
            relationshipRecallErrors: 0,
            relationshipRecallErrorRate: 0.0,
            details: []
        };

        // Get common entries using shared method
        const commonEntries = this._getCommonEntries();
        results.entriesCompared = commonEntries.length;

        // Compare relationships in each common entry
        for (const entryId of commonEntries) {
            const entry1 = this.pageModel1.entries[entryId];
            const entry2 = this.pageModel2.entries[entryId];

            const entryResult = this._compareRelationshipsInEntry(entry1, entry2, entryId);
            results.details.push(entryResult);

            // Aggregate statistics
            results.totalMatches += entryResult.matches.length;
            results.relationshipRecallErrors += entryResult.recallErrors.length;
        }

        // Calculate error rate using shared method
        results.relationshipRecallErrorRate = this._calculateErrorRate(results.relationshipRecallErrors, results.totalMatches);

        return results;
    }

    /**
     * Compare relationship strings within a single entry between the two models
     * @param {EntryModel} entry1 - Entry from first PageModel
     * @param {EntryModel} entry2 - Entry from second PageModel
     * @param {string} entryId - The entry ID being compared
     * @returns {Object} Detailed relationship comparison results for this entry
     * @private
     */
    _compareRelationshipsInEntry(entry1, entry2, entryId) {
        const result = {
            entryId: entryId,
            matches: [],
            recallErrors: []
        };

        // Prepare people arrays and match tracking using shared method
        const { people1, people2, matched1, matched2 } = this._preparePeopleForComparison(entry1, entry2);

        // Execute complete matching algorithm using shared method
        this._executeCompleteMatchingAlgorithm(people1, people2, entry1, entry2, result, matched1, matched2);

        // Now compare relationship strings for matched people
        for (const match of result.matches) {
            const relationship1 = entry1.getRelationship(match.person1Id);
            const relationship2 = entry2.getRelationship(match.person2Id);

            // Extract letter portions for comparison (ignore the digit)
            const letters1 = this._extractRelationshipLetters(relationship1);
            const letters2 = this._extractRelationshipLetters(relationship2);

            // Check if relationship strings differ (recall error)
            // Two relationship strings agree if they both have no letters after the digit 
            // or if the letters after the digit are identical
            if (letters1 !== letters2) {
                result.recallErrors.push({
                    person1Id: match.person1Id,
                    person2Id: match.person2Id,
                    person1Name: match.person1Name,
                    person2Name: match.person2Name,
                    relationship1: relationship1,
                    relationship2: relationship2,
                    letters1: letters1,
                    letters2: letters2,
                    matchType: match.matchType
                });
            }
        }

        return result;
    }

    /**
     * Compare events between people in the two PageModels
     * First matches people using the same algorithm as comparePeople, then checks if their events match
     * @returns {Object} Object containing event comparison results
     */
    compareEvents() {
        const results = {
            entriesCompared: 0,
            totalMatches: 0,
            eventRecallErrors: 0,
            eventPrecisionErrors: 0,
            recallErrorRate: 0.0,
            precisionErrorRate: 0.0,
            details: []
        };

        // Get common entries using shared method
        const commonEntries = this._getCommonEntries();
        results.entriesCompared = commonEntries.length;

        // Compare events in each common entry
        for (const entryId of commonEntries) {
            const entry1 = this.pageModel1.entries[entryId];
            const entry2 = this.pageModel2.entries[entryId];

            const entryResult = this._compareEventsInEntry(entry1, entry2, entryId);
            results.details.push(entryResult);

            // Aggregate statistics
            results.totalMatches += entryResult.matches.length;
            results.eventRecallErrors += entryResult.recallErrors.length;
            results.eventPrecisionErrors += entryResult.precisionErrors.length;
        }

        // Calculate error rates using shared method
        results.recallErrorRate = this._calculateErrorRate(results.eventRecallErrors, results.totalMatches);
        results.precisionErrorRate = this._calculateErrorRate(results.eventPrecisionErrors, results.totalMatches);

        return results;
    }

    /**
     * Compare events within a single entry between the two models
     * @param {EntryModel} entry1 - Entry from first PageModel
     * @param {EntryModel} entry2 - Entry from second PageModel
     * @param {string} entryId - The entry ID being compared
     * @returns {Object} Detailed event comparison results for this entry
     * @private
     */
    _compareEventsInEntry(entry1, entry2, entryId) {
        const result = {
            entryId: entryId,
            matches: [],
            recallErrors: [],
            precisionErrors: []
        };

        // Prepare people arrays and match tracking using shared method
        const { people1, people2, matched1, matched2 } = this._preparePeopleForComparison(entry1, entry2);

        // Execute complete matching algorithm using shared method
        this._executeCompleteMatchingAlgorithm(people1, people2, entry1, entry2, result, matched1, matched2);

        // Now compare events for matched people
        for (const match of result.matches) {
            const person1 = this.pageModel1.people[match.person1Id];
            const person2 = this.pageModel2.people[match.person2Id];

            if (person1 && person2) {
                const eventComparison = this._comparePersonEvents(person1, person2, match);
                
                if (eventComparison.recallErrors.length > 0) {
                    result.recallErrors.push(...eventComparison.recallErrors);
                }
                if (eventComparison.precisionErrors.length > 0) {
                    result.precisionErrors.push(...eventComparison.precisionErrors);
                }
            }
        }

        return result;
    }

    /**
     * Compare events between two matched people
     * @param {PersonModel} person1 - Person from first PageModel
     * @param {PersonModel} person2 - Person from second PageModel
     * @param {Object} match - The match object containing person IDs and names
     * @returns {Object} Event comparison result with recall and precision errors
     * @private
     */
    _comparePersonEvents(person1, person2, match) {
        const result = {
            recallErrors: [],
            precisionErrors: []
        };

        // Compare basic life events: birth, death, christening, burial
        const eventTypes = ['birth', 'death', 'christening', 'burial'];
        
        for (const eventType of eventTypes) {
            const event1 = person1[eventType];
            const event2 = person2[eventType];
            
            const eventComparison = this._compareEventPair(event1, event2, eventType, match);
            
            if (eventComparison && eventComparison.type === 'recall') {
                result.recallErrors.push(eventComparison);
            } else if (eventComparison && eventComparison.type === 'precision') {
                result.precisionErrors.push(eventComparison);
            }
        }

        // Compare marriage events through family relationships
        const marriageComparison = this._compareMarriageEvents(person1, person2, match);
        
        if (marriageComparison.recallErrors.length > 0) {
            result.recallErrors.push(...marriageComparison.recallErrors);
        }
        if (marriageComparison.precisionErrors.length > 0) {
            result.precisionErrors.push(...marriageComparison.precisionErrors);
        }

        return result;
    }

    /**
     * Compare a specific event between two people
     * @param {EventModel} event1 - Event from first person
     * @param {EventModel} event2 - Event from second person
     * @param {string} eventType - Type of event (birth, death, etc.)
     * @param {Object} match - The match object containing person IDs and names
     * @returns {Object|null} Event comparison result or null if events match
     * @private
     */
    _compareEventPair(event1, event2, eventType, match) {
        const isEmpty1 = !event1 || event1.isEmpty();
        const isEmpty2 = !event2 || event2.isEmpty();

        // If both events are empty, they match
        if (isEmpty1 && isEmpty2) {
            return null;
        }

        // If one event is missing, it's a recall error
        if (isEmpty1 !== isEmpty2) {
            return {
                type: 'recall',
                eventType: eventType,
                person1Id: match.person1Id,
                person2Id: match.person2Id,
                person1Name: match.person1Name,
                person2Name: match.person2Name,
                event1: isEmpty1 ? null : this._eventToString(event1),
                event2: isEmpty2 ? null : this._eventToString(event2),
                missingIn: isEmpty1 ? 'first' : 'second'
            };
        }

        // If both events exist, compare their content
        if (!isEmpty1 && !isEmpty2) {
            const date1Str = event1.date ? event1.date.toString() : '';
            const date2Str = event2.date ? event2.date.toString() : '';
            const place1 = event1.place || '';
            const place2 = event2.place || '';

            // Events are different if dates or places don't match
            const datesDiffer = (date1Str !== '' || date2Str !== '') && date1Str !== date2Str;
            const placesDiffer = (place1 !== '' || place2 !== '') && place1 !== place2;

            if (datesDiffer || placesDiffer) {
                return {
                    type: 'precision',
                    eventType: eventType,
                    person1Id: match.person1Id,
                    person2Id: match.person2Id,
                    person1Name: match.person1Name,
                    person2Name: match.person2Name,
                    event1: this._eventToString(event1),
                    event2: this._eventToString(event2),
                    datesDiffer: datesDiffer,
                    placesDiffer: placesDiffer
                };
            }
        }

        return null; // Events match
    }

    /**
     * Compare marriage events through family relationships
     * @param {PersonModel} person1 - Person from first PageModel
     * @param {PersonModel} person2 - Person from second PageModel
     * @param {Object} match - The match object containing person IDs and names
     * @returns {Object} Marriage comparison result with recall and precision errors
     * @private
     */
    _compareMarriageEvents(person1, person2, match) {
        const result = {
            recallErrors: [],
            precisionErrors: []
        };

        // Get families where this person is a spouse
        const families1 = this._getSpouseFamilies(person1, this.pageModel1);
        const families2 = this._getSpouseFamilies(person2, this.pageModel2);

        // If both have no marriage families, they match
        if (families1.length === 0 && families2.length === 0) {
            return result;
        }

        // If one has marriages and the other doesn't, it's a recall error
        if (families1.length !== families2.length) {
            result.recallErrors.push({
                type: 'recall',
                eventType: 'marriage',
                person1Id: match.person1Id,
                person2Id: match.person2Id,
                person1Name: match.person1Name,
                person2Name: match.person2Name,
                families1Count: families1.length,
                families2Count: families2.length,
                missingIn: families1.length < families2.length ? 'first' : 'second'
            });
            return result; // Don't proceed to precision comparison if counts differ
        }

        // Compare marriage events in each family (assuming same order/correspondence)
        for (let i = 0; i < Math.min(families1.length, families2.length); i++) {
            const family1 = families1[i];
            const family2 = families2[i];
            
            const marriage1 = family1.marriage;
            const marriage2 = family2.marriage;
            
            const marriageComparison = this._compareEventPair(marriage1, marriage2, 'marriage', match);
            
            if (marriageComparison && marriageComparison.type === 'recall') {
                marriageComparison.familyIndex = i;
                result.recallErrors.push(marriageComparison);
            } else if (marriageComparison && marriageComparison.type === 'precision') {
                marriageComparison.familyIndex = i;
                result.precisionErrors.push(marriageComparison);
            }
        }

        return result;
    }

    /**
     * Get families where a person appears as husband or wife
     * @param {PersonModel} person - The person to check
     * @param {PageModel} pageModel - The PageModel containing the families
     * @returns {Array} Array of FamilyModel objects where person is a spouse
     * @private
     */
    _getSpouseFamilies(person, pageModel) {
        const spouseFamilies = [];
        
        // Check families listed in person's families array
        if (person.families && person.families.length > 0) {
            for (const familyId of person.families) {
                const family = pageModel.families[familyId];
                if (family) {
                    // Find the person ID for this person in the PageModel
                    const personId = Object.keys(pageModel.people).find(id => 
                        pageModel.people[id] === person || 
                        JSON.stringify(pageModel.people[id]) === JSON.stringify(person)
                    );
                    
                    if (personId && (family.husband === parseInt(personId) || family.wife === parseInt(personId))) {
                        spouseFamilies.push(family);
                    }
                }
            }
        }
        
        return spouseFamilies;
    }

    /**
     * Convert an event to a readable string representation
     * @param {EventModel} event - The event to convert
     * @returns {string} String representation of the event
     * @private
     */
    _eventToString(event) {
        if (!event || event.isEmpty()) {
            return 'Empty event';
        }
        
        const dateStr = event.date ? event.date.toString() : '';
        const place = event.place || '';
        
        // Filter out "<Empty>" strings from date
        const validDateStr = dateStr && dateStr !== '<Empty>' ? dateStr : '';
        
        if (validDateStr && place) {
            return `${validDateStr} at ${place}`;
        } else if (validDateStr) {
            return validDateStr;
        } else if (place) {
            return `at ${place}`;
        }
        
        return 'Event recorded (no date/place)';
    }

    /**
     * Extract the letter portion from a relationship string
     * Relationship format: digit followed by 0 or more letters
     * @param {string} relationshipString - The relationship string to parse
     * @returns {string} The letters portion after the digit, or empty string if no letters
     * @private
     */
    _extractRelationshipLetters(relationshipString) {
        if (!relationshipString || typeof relationshipString !== 'string') {
            return '';
        }

        // Match pattern: digit followed by 0 or more letters
        const match = relationshipString.match(/^\d+([a-zA-Z]*)$/);
        
        if (match) {
            // Return the letters portion (group 1), or empty string if no letters
            return match[1] || '';
        }
        
        // If the string doesn't match the expected format, return empty string
        // This handles edge cases where relationship string might be malformed
        return '';
    }
}

module.exports = CompareModels;

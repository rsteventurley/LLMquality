/**
 * Regression tests for cross-reference normalization in CompareModels.
 *
 * An LLM may return a cross-reference as "1414.7" (entry 1414, 7th person)
 * while the GEDCOM file stores only the household entry number "1414".
 * These tests ensure the two forms compare as equal.
 */

const assert = require('assert');
const CompareModels = require('../DataModel/CompareModels');
const PageModel = require('../DataModel/PageModel');
const EntryModel = require('../DataModel/EntryModel');
const PersonModel = require('../DataModel/PersonModel');
const NameModel = require('../DataModel/NameModel');

function makePageModelWithPerson(entryId, personRef) {
    const page = new PageModel();
    const entry = new EntryModel(entryId);
    const person = new PersonModel(new NameModel('Hans', 'Müller'));
    person.references = [personRef];
    entry.addPerson(1, 'uid-1', person);
    page.addEntry(entry);
    return page;
}

describe('Cross-reference normalization', function () {

    describe('_normalizeReference', function () {
        let comparer;

        before(function () {
            const p = new PageModel();
            comparer = new CompareModels(p, p);
        });

        it('strips the person-number suffix from "digits.digits" references', function () {
            assert.strictEqual(comparer._normalizeReference('1414.7'), '1414');
        });

        it('strips suffix when person index is multi-digit', function () {
            assert.strictEqual(comparer._normalizeReference('1414.12'), '1414');
        });

        it('leaves plain entry numbers unchanged', function () {
            assert.strictEqual(comparer._normalizeReference('1414'), '1414');
        });

        it('leaves non-numeric references (like "F001") unchanged', function () {
            assert.strictEqual(comparer._normalizeReference('F001'), 'F001');
        });

        it('leaves alphanumeric references unchanged', function () {
            assert.strictEqual(comparer._normalizeReference('REF123'), 'REF123');
        });

        it('leaves references with only a leading decimal unchanged', function () {
            assert.strictEqual(comparer._normalizeReference('.7'), '.7');
        });
    });

    describe('compareReferences — entry.person format', function () {
        it('treats "1414.7" (XML) as matching "1414" (GEDCOM) — no errors reported', function () {
            const gedPage = makePageModelWithPerson('1414', '1414');
            const xmlPage = makePageModelWithPerson('1414', '1414.7');
            const comparer = new CompareModels(gedPage, xmlPage);

            const result = comparer.compareReferences();

            assert.strictEqual(result.crossReferenceRecallErrors, 0,
                'should report no recall errors when entry numbers match');
            assert.strictEqual(result.crossReferencePrecisionErrors, 0,
                'should report no precision errors when entry numbers match');
        });

        it('still detects a genuine mismatch between two different entry numbers', function () {
            const gedPage = makePageModelWithPerson('1414', '1414');
            const xmlPage = makePageModelWithPerson('1414', '9999');
            const comparer = new CompareModels(gedPage, xmlPage);

            const result = comparer.compareReferences();

            assert.strictEqual(result.crossReferencePrecisionErrors, 1,
                'should report a precision error for genuinely different references');
        });

        it('treats "1414.7" in GEDCOM as matching "1414" in XML (reversed direction)', function () {
            const gedPage = makePageModelWithPerson('1414', '1414.7');
            const xmlPage = makePageModelWithPerson('1414', '1414');
            const comparer = new CompareModels(gedPage, xmlPage);

            const result = comparer.compareReferences();

            assert.strictEqual(result.crossReferenceRecallErrors, 0);
            assert.strictEqual(result.crossReferencePrecisionErrors, 0);
        });
    });

    describe('_hasMatchingEventsOrReferences — entry.person format', function () {
        it('matches a person whose only shared data is "1414" vs "1414.7"', function () {
            // Build two pages where persons share only a cross-reference (no events).
            // The matching algorithm uses _hasMatchingEventsOrReferences, so if references
            // are NOT normalized the persons will fail to match and show up as unmatched.
            const gedPage = makePageModelWithPerson('1414', '1414');
            const xmlPage = makePageModelWithPerson('1414', '1414.7');
            const comparer = new CompareModels(gedPage, xmlPage);

            const result = comparer.comparePeople();
            const entryDetail = result.details.find(d => d.entryId === '1414');

            assert.ok(entryDetail, 'entry 1414 should appear in comparison details');
            assert.strictEqual(entryDetail.matches.length, 1,
                'the single person should be matched via normalized cross-reference');
            assert.strictEqual(entryDetail.unmatchedInFirst.length, 0,
                'no unmatched people expected in model 1');
            assert.strictEqual(entryDetail.unmatchedInSecond.length, 0,
                'no unmatched people expected in model 2');
        });
    });
});

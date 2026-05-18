/**
 * Regression tests for XML std date strings that include a GEDCOM-style qualifier.
 *
 * An LLM may write <std>ABT 18160000</std> instead of the bare <std>18160000</std>.
 * The parser must strip the "ABT "/"BEF "/"AFT " prefix, convert the remaining
 * YYYYMMDD digits to YYYY-MM-DD, and forward the full "ABT YYYY-MM-DD" string to
 * parseDateString so that the qualifier is honoured in the resulting DateModel.
 *
 * Regression: entry 1434 child Magdalena, birth "ABT 1816" in GEDCOM vs
 * <std>ABT 18160000</std> in XML — previously parsed as empty, now matches.
 */

const assert = require('assert');
const XmlDate = require('../XML/XmlDate');
const XmlEvent = require('../XML/XmlEvent');
const DateModel = require('../DataModel/DateModel');

describe('XML std date with qualifier prefix', function () {

    describe('ABT YYYYMMDD', function () {
        it('parses "ABT 18160000" to About 00.00.1816', function () {
            const xmlDate = new XmlDate('um 1816', 'ABT 18160000');
            const event = new XmlEvent('birth', xmlDate, '');
            const em = event.toEventModel();

            assert.strictEqual(em.date.isAbout, true, 'isAbout should be true');
            assert.strictEqual(em.date.year, 1816, 'year should be 1816');
            assert.strictEqual(em.date.month, 0, 'month should be 0 (unknown)');
            assert.strictEqual(em.date.day, 0, 'day should be 0 (unknown)');
            assert.strictEqual(em.date.toString(), 'About 00.00.1816');
        });

        it('matches the GEDCOM "ABT 1816" date string — no event mismatch', function () {
            const gedDate = new DateModel();
            gedDate.parseGedcomDate('ABT 1816');

            const xmlDate = new XmlDate('um 1816', 'ABT 18160000');
            const event = new XmlEvent('birth', xmlDate, '');
            const xmlDateModel = event.toEventModel().date;

            assert.strictEqual(gedDate.toString(), xmlDateModel.toString(),
                'GEDCOM and XML date strings should be equal');
        });

        it('parses "ABT 18560312" with full date components', function () {
            const xmlDate = new XmlDate('', 'ABT 18560312');
            const event = new XmlEvent('birth', xmlDate, '');
            const em = event.toEventModel();

            assert.strictEqual(em.date.isAbout, true);
            assert.strictEqual(em.date.year, 1856);
            assert.strictEqual(em.date.month, 3);
            assert.strictEqual(em.date.day, 12);
        });
    });

    describe('BEF YYYYMMDD', function () {
        it('parses "BEF 18500000" to Before 00.00.1850', function () {
            const xmlDate = new XmlDate('', 'BEF 18500000');
            const event = new XmlEvent('death', xmlDate, '');
            const em = event.toEventModel();

            assert.strictEqual(em.date.isBefore, true, 'isBefore should be true');
            assert.strictEqual(em.date.year, 1850);
            assert.strictEqual(em.date.toString(), 'Before 00.00.1850');
        });
    });

    describe('AFT YYYYMMDD', function () {
        it('parses "AFT 18000101" to After 01.01.1800', function () {
            const xmlDate = new XmlDate('', 'AFT 18000101');
            const event = new XmlEvent('birth', xmlDate, '');
            const em = event.toEventModel();

            assert.strictEqual(em.date.isAfter, true, 'isAfter should be true');
            assert.strictEqual(em.date.year, 1800);
            assert.strictEqual(em.date.month, 1);
            assert.strictEqual(em.date.day, 1);
            assert.strictEqual(em.date.toString(), 'After 01.01.1800');
        });
    });

    describe('plain YYYYMMDD (no qualifier) still works', function () {
        it('parses "18020910" correctly', function () {
            const xmlDate = new XmlDate('10.9.1802', '18020910');
            const event = new XmlEvent('birth', xmlDate, '');
            const em = event.toEventModel();

            assert.strictEqual(em.date.isAbout, false);
            assert.strictEqual(em.date.year, 1802);
            assert.strictEqual(em.date.month, 9);
            assert.strictEqual(em.date.day, 10);
            assert.strictEqual(em.date.toString(), 'Normal 10.09.1802');
        });
    });
});

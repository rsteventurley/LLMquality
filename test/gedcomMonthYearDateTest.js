/**
 * Regression tests for GEDCOM dates in "MMM YYYY" format (month known, day unknown).
 *
 * GEDCOM allows dates like "SEP 1872" or "ABT SEP 1872" where only the month and
 * year are known.  Previously _parseSingleGedcomDate threw an error for this pattern
 * because it only recognised "DD MMM YYYY" and "YYYY", leaving month=null and
 * year=null after the exception was caught, which formatted as "About 00.00.0000".
 *
 * Regression: Bükkösd.174.ged child with birth "ABT SEP 1872" — must parse to
 * "About 00.09.1872".
 */

const assert = require('assert');
const DateModel = require('../DataModel/DateModel');

describe('GEDCOM MMM YYYY date format', function () {

    describe('bare MMM YYYY (no qualifier)', function () {
        it('parses "SEP 1872" to year=1872 month=9 day=null', function () {
            const d = new DateModel();
            d.parseGedcomDate('SEP 1872');
            assert.strictEqual(d.year, 1872);
            assert.strictEqual(d.month, 9);
            assert.strictEqual(d.day, null);
            assert.strictEqual(d.isAbout, false);
        });

        it('toString() shows "Normal 00.09.1872"', function () {
            const d = new DateModel();
            d.parseGedcomDate('SEP 1872');
            assert.strictEqual(d.toString(), 'Normal 00.09.1872');
        });
    });

    describe('ABT MMM YYYY', function () {
        it('parses "ABT SEP 1872" to About 00.09.1872 — regression for Bükkösd.174', function () {
            const d = new DateModel();
            d.parseGedcomDate('ABT SEP 1872');
            assert.strictEqual(d.isAbout, true, 'isAbout should be true');
            assert.strictEqual(d.year, 1872, 'year should be 1872');
            assert.strictEqual(d.month, 9, 'month should be 9 (September)');
            assert.strictEqual(d.day, null, 'day should be null (unknown)');
            assert.strictEqual(d.toString(), 'About 00.09.1872');
        });

        it('parses "ABT MAR 1900"', function () {
            const d = new DateModel();
            d.parseGedcomDate('ABT MAR 1900');
            assert.strictEqual(d.isAbout, true);
            assert.strictEqual(d.year, 1900);
            assert.strictEqual(d.month, 3);
            assert.strictEqual(d.toString(), 'About 00.03.1900');
        });
    });

    describe('BEF MMM YYYY', function () {
        it('parses "BEF MAR 1900" correctly', function () {
            const d = new DateModel();
            d.parseGedcomDate('BEF MAR 1900');
            assert.strictEqual(d.isBefore, true);
            assert.strictEqual(d.year, 1900);
            assert.strictEqual(d.month, 3);
            assert.strictEqual(d.day, null);
            assert.strictEqual(d.toString(), 'Before 00.03.1900');
        });
    });

    describe('AFT MMM YYYY', function () {
        it('parses "AFT JAN 1850" correctly', function () {
            const d = new DateModel();
            d.parseGedcomDate('AFT JAN 1850');
            assert.strictEqual(d.isAfter, true);
            assert.strictEqual(d.year, 1850);
            assert.strictEqual(d.month, 1);
            assert.strictEqual(d.day, null);
            assert.strictEqual(d.toString(), 'After 00.01.1850');
        });
    });

    describe('existing formats still work', function () {
        it('DD MMM YYYY: "10 SEP 1802"', function () {
            const d = new DateModel();
            d.parseGedcomDate('10 SEP 1802');
            assert.strictEqual(d.year, 1802);
            assert.strictEqual(d.month, 9);
            assert.strictEqual(d.day, 10);
            assert.strictEqual(d.toString(), 'Normal 10.09.1802');
        });

        it('YYYY: "1850"', function () {
            const d = new DateModel();
            d.parseGedcomDate('1850');
            assert.strictEqual(d.year, 1850);
            assert.strictEqual(d.month, null);
            assert.strictEqual(d.day, null);
        });

        it('ABT YYYY: "ABT 1816"', function () {
            const d = new DateModel();
            d.parseGedcomDate('ABT 1816');
            assert.strictEqual(d.isAbout, true);
            assert.strictEqual(d.year, 1816);
            assert.strictEqual(d.month, null);
            assert.strictEqual(d.toString(), 'About 00.00.1816');
        });
    });
});

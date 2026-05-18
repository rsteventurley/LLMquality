/**
 * DateModel - A class for handling genealogical dates
 * Supports various date formats commonly found in GEDCOM and XML genealogical data
 * 
 * @author Steve Turley
 * @version 1.0.0
 */

class DateModel {
    constructor() {
        // Core date properties
        this.originalString = null;
        this.day = null;
        this.month = null;
        this.year = null;
        
        // Date range properties
        this.isRange = false;
        this.startDate = null;
        this.endDate = null;
        
        // Date quality indicators
        this.isApproximate = false;
        this.isEstimated = false;
        this.isCalculated = false;
        this.isBefore = false;
        this.isAfter = false;
        this.isAbout = false;
        
        // Calendar type (Gregorian, Julian, etc.)
        this.calendar = 'GREGORIAN';
    }

    /**
     * Parse ISO 8601 date format (YYYY-MM-DD) with optional ABT modifier and range support
     * @param {string} dateString - The date string to parse in ISO 8601 format
     * @throws {Error} If the date format is invalid or date values are out of range
     */
    parseDateString(dateString) {
        if (!dateString || typeof dateString !== 'string') {
            throw new Error('Date string is required and must be a string');
        }

        this.originalString = dateString.trim();
        const normalizedDate = this.originalString.toUpperCase().trim();

        // Reset all properties
        this.day = null;
        this.month = null;
        this.year = null;
        this.isRange = false;
        this.startDate = null;
        this.endDate = null;
        this.isAbout = false;
        this.isApproximate = false;
        this.isBefore = false;
        this.isAfter = false;

        // Check for ABT modifier
        if (normalizedDate.startsWith('ABT ')) {
            this.isAbout = true;
            this.isApproximate = true;
            const cleanDate = normalizedDate.substring(4).trim();
            this._parseSingleISODate(cleanDate);
        }
        // Check for BEF modifier
        else if (normalizedDate.startsWith('BEF ')) {
            this.isBefore = true;
            const cleanDate = normalizedDate.substring(4).trim();
            this._parseSingleISODate(cleanDate);
        }
        // Check for AFT modifier
        else if (normalizedDate.startsWith('AFT ')) {
            this.isAfter = true;
            const cleanDate = normalizedDate.substring(4).trim();
            this._parseSingleISODate(cleanDate);
        }
        // Check for BET range
        else if (normalizedDate.startsWith('BET ')) {
            this.isRange = true;
            const rangeContent = normalizedDate.substring(4).trim();
            const andIndex = rangeContent.indexOf(' AND ');
            
            if (andIndex === -1) {
                throw new Error('Range format must be "BET YYYY-MM-DD AND YYYY-MM-DD"');
            }
            
            const startDateStr = rangeContent.substring(0, andIndex).trim();
            const endDateStr = rangeContent.substring(andIndex + 5).trim();
            
            this.startDate = new DateModel();
            this.startDate.parseDateString(startDateStr);
            
            this.endDate = new DateModel();
            this.endDate.parseDateString(endDateStr);
        }
        // Single date
        else {
            this._parseSingleISODate(normalizedDate);
        }
    }

    /**
     * Parse a single ISO 8601 date (YYYY-MM-DD)
     * @private
     * @param {string} dateString - The clean date string in YYYY-MM-DD format
     * @throws {Error} If the date format is invalid or values are out of range
     */
    _parseSingleISODate(dateString) {
        // Match YYYY-MM-DD format
        const isoMatch = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        
        if (!isoMatch) {
            throw new Error('Date must be in ISO 8601 format (YYYY-MM-DD)');
        }
        
        const year = parseInt(isoMatch[1], 10);
        const month = parseInt(isoMatch[2], 10);
        const day = parseInt(isoMatch[3], 10);
        
        // Validate year range (allow 0 for unknown)
        if (year !== 0 && (year < 1400 || year > 2000)) {
            throw new Error(`Year must be between 1400 and 2000 or 0 for unknown, got ${year}`);
        }
        
        // Validate month range (allow 0 for unknown)
        if (month < 0 || month > 12) {
            throw new Error(`Month must be between 0 and 12 (0 for unknown), got ${month}`);
        }
        
        // Validate day based on month and year (allow 0 for unknown)
        if (month > 0 && year > 0) {
            // Only validate day against month/year if both month and year are known
            const daysInMonth = this._getDaysInMonth(month, year);
            if (day < 0 || day > daysInMonth) {
                throw new Error(`Day must be between 0 and ${daysInMonth} for month ${month} (0 for unknown), got ${day}`);
            }
        } else {
            // If month or year is unknown, just check day is not negative
            if (day < 0 || day > 31) {
                throw new Error(`Day must be between 0 and 31 (0 for unknown), got ${day}`);
            }
        }
        
        this.year = year;
        this.month = month;
        this.day = day;
        
        // Flag dates with zero values as approximate and about
        if (year === 0 || month === 0 || day === 0) {
            this.isApproximate = true;
            this.isAbout = true;
        }
    }

    /**
     * Parse GEDCOM date format (DD MMM YYYY) with optional modifiers
     * Supports formats like "10 SEP 1802", "ABT 1850", "BEF 1900", etc.
     * @param {string} dateString - The date string to parse in GEDCOM format
     * @throws {Error} If the date format is invalid or date values are out of range
     */
    parseGedcomDate(dateString) {
        if (!dateString || typeof dateString !== 'string') {
            throw new Error('Date string is required and must be a string');
        }

        this.originalString = dateString.trim();
        const normalizedDate = this.originalString.toUpperCase().trim();

        // Reset all properties
        this.day = null;
        this.month = null;
        this.year = null;
        this.isRange = false;
        this.startDate = null;
        this.endDate = null;
        this.isAbout = false;
        this.isApproximate = false;
        this.isBefore = false;
        this.isAfter = false;

        // Check for ABT modifier
        if (normalizedDate.startsWith('ABT ')) {
            this.isAbout = true;
            this.isApproximate = true;
            const cleanDate = normalizedDate.substring(4).trim();
            this._parseSingleGedcomDate(cleanDate);
        }
        // Check for BEF modifier
        else if (normalizedDate.startsWith('BEF ')) {
            this.isBefore = true;
            const cleanDate = normalizedDate.substring(4).trim();
            this._parseSingleGedcomDate(cleanDate);
        }
        // Check for AFT modifier
        else if (normalizedDate.startsWith('AFT ')) {
            this.isAfter = true;
            const cleanDate = normalizedDate.substring(4).trim();
            this._parseSingleGedcomDate(cleanDate);
        }
        // Check for BET range
        else if (normalizedDate.startsWith('BET ')) {
            this.isRange = true;
            const rangeContent = normalizedDate.substring(4).trim();
            const andIndex = rangeContent.indexOf(' AND ');
            
            if (andIndex === -1) {
                throw new Error('Range format must be "BET DD MMM YYYY AND DD MMM YYYY"');
            }
            
            const startDateStr = rangeContent.substring(0, andIndex).trim();
            const endDateStr = rangeContent.substring(andIndex + 5).trim();
            
            this.startDate = new DateModel();
            this.startDate.parseGedcomDate(startDateStr);
            
            this.endDate = new DateModel();
            this.endDate.parseGedcomDate(endDateStr);
        }
        // Single date
        else {
            this._parseSingleGedcomDate(normalizedDate);
        }
    }

    /**
     * Parse a single GEDCOM date (DD MMM YYYY)
     * @private
     * @param {string} dateString - The clean date string in GEDCOM format
     * @throws {Error} If the date format is invalid or values are out of range
     */
    _parseSingleGedcomDate(dateString) {
        // Month name mapping
        const monthNames = {
            'JAN': 1, 'FEB': 2, 'MAR': 3, 'APR': 4, 'MAY': 5, 'JUN': 6,
            'JUL': 7, 'AUG': 8, 'SEP': 9, 'OCT': 10, 'NOV': 11, 'DEC': 12
        };

        // Match DD MMM YYYY format (e.g., "10 SEP 1802")
        const gedcomMatch = dateString.match(/^(\d{1,2})\s+([A-Z]{3})\s+(\d{4})$/);
        
        if (gedcomMatch) {
            const day = parseInt(gedcomMatch[1], 10);
            const monthName = gedcomMatch[2];
            const year = parseInt(gedcomMatch[3], 10);
            
            const month = monthNames[monthName];
            if (!month) {
                throw new Error(`Invalid month name: ${monthName}`);
            }
            
            // Validate year range
            if (year < 1400 || year > 2100) {
                throw new Error(`Year must be between 1400 and 2100, got ${year}`);
            }
            
            // Validate month range
            if (month < 1 || month > 12) {
                throw new Error(`Month must be between 1 and 12, got ${month}`);
            }
            
            // Validate day based on month and year
            const daysInMonth = this._getDaysInMonth(month, year);
            if (day < 1 || day > daysInMonth) {
                throw new Error(`Day must be between 1 and ${daysInMonth} for month ${month}, got ${day}`);
            }
            
            this.year = year;
            this.month = month;
            this.day = day;
        }
        // Match MMM YYYY format (e.g., "SEP 1872") — month known, day unknown
        else if (dateString.match(/^([A-Z]{3})\s+(\d{4})$/)) {
            const monthYearMatch = dateString.match(/^([A-Z]{3})\s+(\d{4})$/);
            const monthName = monthYearMatch[1];
            const year = parseInt(monthYearMatch[2], 10);

            const month = monthNames[monthName];
            if (!month) {
                throw new Error(`Invalid month name: ${monthName}`);
            }

            if (year < 1400 || year > 2100) {
                throw new Error(`Year must be between 1400 and 2100, got ${year}`);
            }

            this.year = year;
            this.month = month;
            this.day = null;
        }
        // Match YYYY only format (e.g., "1850")
        else {
            const yearMatch = dateString.match(/^(\d{4})$/);
            if (yearMatch) {
                const year = parseInt(yearMatch[1], 10);

                // Validate year range
                if (year < 1400 || year > 2100) {
                    throw new Error(`Year must be between 1400 and 2100, got ${year}`);
                }

                this.year = year;
                this.month = null;
                this.day = null;
            } else {
                throw new Error(`Invalid GEDCOM date format: ${dateString}. Expected DD MMM YYYY, MMM YYYY, or YYYY.`);
            }
        }
    }

    /**
     * Get the number of days in a given month and year
     * @private
     * @param {number} month - Month (1-12)
     * @param {number} year - Year
     * @returns {number} Number of days in the month
     */
    _getDaysInMonth(month, year) {
        const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        
        // Check for leap year in February
        if (month === 2 && this._isLeapYear(year)) {
            return 29;
        }
        
        return daysInMonth[month - 1];
    }

    /**
     * Check if a year is a leap year
     * @private
     * @param {number} year - Year to check
     * @returns {boolean} True if leap year
     */
    _isLeapYear(year) {
        return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    }

    /**
     * Convert to JavaScript Date object (if possible)
     * @returns {Date|null} JavaScript Date object or null if conversion not possible
     */
    toDate() {
        if (this.isRange || !this.year) {
            return null;
        }
        
        const month = this.month ? this.month - 1 : 0; // JavaScript months are 0-based
        const day = this.day || 1;
        
        try {
            return new Date(this.year, month, day);
        } catch (error) {
            return null;
        }
    }

    /**
     * Format the date as a GEDCOM-compatible string
     * @returns {string} GEDCOM formatted date string
     */
    toGEDCOM() {
        if (this.isRange && this.startDate && this.endDate) {
            return `BET ${this.startDate.toGEDCOM()} AND ${this.endDate.toGEDCOM()}`;
        }

        let result = '';
        
        // Add qualifiers
        if (this.isBefore) result += 'BEF ';
        else if (this.isAfter) result += 'AFT ';
        else if (this.isAbout) result += 'ABT ';

        // Add date components in GEDCOM format (DD MMM YYYY)
        if (this.day && this.month && this.year) {
            const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                              'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
            result += `${this.day} ${monthNames[this.month - 1]} ${this.year}`;
        } else if (this.month && this.year) {
            const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                              'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
            result += `${monthNames[this.month - 1]} ${this.year}`;
        } else if (this.year) {
            result += `${this.year}`;
        }

        return result.trim();
    }

    /**
     * Format the date as an ISO string (YYYY-MM-DD)
     * @returns {string} ISO formatted date string
     */
    toISO() {
        if (this.isRange || !this.year) {
            return '';
        }

        const year = this.year.toString().padStart(4, '0');
        const month = this.month ? this.month.toString().padStart(2, '0') : '01';
        const day = this.day ? this.day.toString().padStart(2, '0') : '01';

        return `${year}-${month}-${day}`;
    }

    /**
     * Get a human-readable string representation
     * @returns {string} Human-readable date string in DD.MM.YYYY format
     */
    toString() {
        // Check if this is an empty DateModel (all default properties)
        if (this.isEmpty()) {
            return '<Empty>';
        }

        // Handle date ranges
        if (this.isRange && this.startDate && this.endDate) {
            const startStr = this._formatDateString(this.startDate);
            const endStr = this._formatDateString(this.endDate);
            return `Between ${startStr} and ${endStr}`;
        }

        // Handle single dates
        const dateStr = this._formatDateString(this);
        
        if (this.isBefore) {
            return `Before ${dateStr}`;
        } else if (this.isAfter) {
            return `After ${dateStr}`;
        } else if (this.isAbout || this.isApproximate) {
            return `About ${dateStr}`;
        } else {
            return `Normal ${dateStr}`;
        }
    }

    /**
     * Format a DateModel as DD.MM.YYYY string
     * @private
     * @param {DateModel} dateModel - The DateModel to format
     * @returns {string} Formatted date string
     */
    _formatDateString(dateModel) {
        const day = dateModel.day !== null ? dateModel.day.toString().padStart(2, '0') : '00';
        const month = dateModel.month !== null ? dateModel.month.toString().padStart(2, '0') : '00';
        const year = dateModel.year !== null ? dateModel.year.toString().padStart(4, '0') : '0000';
        
        return `${day}.${month}.${year}`;
    }

    /**
     * Check if this DateModel is empty (has default initialization values)
     * @returns {boolean} True if the DateModel has all default values
     */
    isEmpty() {
        return this.originalString === null &&
               this.day === null &&
               this.month === null &&
               this.year === null &&
               this.isRange === false &&
               this.startDate === null &&
               this.endDate === null &&
               this.isApproximate === false &&
               this.isEstimated === false &&
               this.isCalculated === false &&
               this.isBefore === false &&
               this.isAfter === false &&
               this.isAbout === false &&
               this.calendar === 'GREGORIAN';
    }

    /**
     * Check if this is an exact date (single date with known day, month, year and not approximate)
     * @returns {boolean} True if this is an exact single date
     */
    isExact() {
        return this.day !== null &&
               this.month !== null &&
               this.year !== null &&
               !this.isRange &&
               !this.isApproximate &&
               !this.isAbout &&
               !this.isBefore &&
               !this.isAfter;
    }

    /**
     * Check if this date is valid
     * @returns {boolean} True if the date has at least a year
     */
    isValid() {
        return this.year !== null && this.year > 0;
    }

    /**
     * Compare this date with another DateModel
     * @param {DateModel} other - The other DateModel to compare
     * @returns {number} -1 if this date is earlier, 1 if later, 0 if equal
     */
    compare(other) {
        if (!this.isValid() || !other.isValid()) {
            return 0;
        }

        // For ranges, compare start dates
        const thisDate = this.isRange ? this.startDate : this;
        const otherDate = other.isRange ? other.startDate : other;

        if (thisDate.year !== otherDate.year) {
            return thisDate.year < otherDate.year ? -1 : 1;
        }

        const thisMonth = thisDate.month || 1;
        const otherMonth = otherDate.month || 1;
        if (thisMonth !== otherMonth) {
            return thisMonth < otherMonth ? -1 : 1;
        }

        const thisDay = thisDate.day || 1;
        const otherDay = otherDate.day || 1;
        if (thisDay !== otherDay) {
            return thisDay < otherDay ? -1 : 1;
        }

        return 0;
    }

    /**
     * Create a copy of this DateModel
     * @returns {DateModel} A new DateModel instance with the same data
     */
    clone() {
        const clone = new DateModel();
        clone.originalString = this.originalString;
        clone.day = this.day;
        clone.month = this.month;
        clone.year = this.year;
        clone.isRange = this.isRange;
        clone.startDate = this.startDate ? this.startDate.clone() : null;
        clone.endDate = this.endDate ? this.endDate.clone() : null;
        clone.isApproximate = this.isApproximate;
        clone.isAbout = this.isAbout;
        clone.isBefore = this.isBefore;
        clone.isAfter = this.isAfter;
        clone.calendar = this.calendar;
        return clone;
    }
}

module.exports = DateModel;

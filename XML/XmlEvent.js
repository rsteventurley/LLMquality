/**
 * XmlEvent - A class for representing XML event information
 * Contains date and place information for genealogical events
 * 
 * @author Steve Turley
 * @version 1.0.0
 */

const XmlDate = require('./XmlDate');

class XmlEvent {
    /**
     * Create a new XmlEvent
     * @param {string} [type] - The event type (birth, death, marriage, etc.)
     * @param {XmlDate} [date] - The event date
     * @param {string} [place] - The event place
     */
    constructor(type = '', date = null, place = '') {
        this.type = type;
        this.date = date ? date.clone() : new XmlDate();
        this.place = place;
    }

    /**
     * Get the event type
     * @returns {string} The event type
     */
    getType() {
        return this.type;
    }

    /**
     * Get the event date
     * @returns {XmlDate} The event date
     */
    getDate() {
        return this.date;
    }

    /**
     * Get the event place
     * @returns {string} The event place
     */
    getPlace() {
        return this.place;
    }

    /**
     * Set the event type
     * @param {string} type - The event type
     */
    setType(type) {
        this.type = type || '';
    }

    /**
     * Set the event date
     * @param {XmlDate} date - The event date
     */
    setDate(date) {
        this.date = date ? date.clone() : new XmlDate();
    }

    /**
     * Set the event place
     * @param {string} place - The event place
     */
    setPlace(place) {
        this.place = place || '';
    }

    /**
     * Check if this event is empty
     * @returns {boolean} True if all fields are empty
     */
    isEmpty() {
        return !this.type && this.date.isEmpty() && !this.place;
    }

    /**
     * Convert to string representation
     * @returns {string} String representation of the event
     */
    toString() {
        if (this.isEmpty()) {
            return '<Empty Event>';
        }

        const parts = [];
        if (this.type) {
            parts.push(this.type);
        }
        if (!this.date.isEmpty()) {
            parts.push(this.date.toString());
        }
        if (this.place) {
            parts.push(this.place);
        }

        return parts.length > 0 ? parts.join(' ') : '<Empty Event>';
    }

    /**
     * Convert this XmlEvent to an EventModel from the DataModel directory
     * @returns {EventModel} A new EventModel instance with converted data
     */
    toEventModel() {
        const EventModel = require('../DataModel/EventModel');
        const DateModel = require('../DataModel/DateModel');

        // Convert XmlDate to DateModel
        let dateModel = new DateModel();
        if (!this.date.isEmpty()) {
            try {
                // Try to parse the standardized date first (YYYYMMDD or QUALIFIER YYYYMMDD format)
                if (this.date.std) {
                    const std = this.date.std;
                    // Handle qualified std: "ABT 18160000", "BEF 18160000", "AFT 18160000"
                    const qualifiedMatch = std.match(/^(ABT|BEF|AFT) (\d{8})$/);
                    if (qualifiedMatch) {
                        const qualifier = qualifiedMatch[1];
                        const digits = qualifiedMatch[2];
                        const year = digits.substring(0, 4);
                        const month = digits.substring(4, 6);
                        const day = digits.substring(6, 8);
                        dateModel.parseDateString(`${qualifier} ${year}-${month}-${day}`);
                    } else if (std.length === 8 && /^\d{8}$/.test(std)) {
                        const year = std.substring(0, 4);
                        const month = std.substring(4, 6);
                        const day = std.substring(6, 8);
                        dateModel.parseDateString(`${year}-${month}-${day}`);
                    }
                } else if (this.date.orig) {
                    // Fall back to original date - try to convert DD.MM.YYYY to YYYY-MM-DD
                    const orig = this.date.orig;
                    const match = orig.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
                    if (match) {
                        const day = match[1].padStart(2, '0');
                        const month = match[2].padStart(2, '0');
                        const year = match[3];
                        dateModel.parseDateString(`${year}-${month}-${day}`);
                    }
                }
            } catch (error) {
                // If parsing fails, store as original string
                dateModel.originalString = this.date.orig || this.date.std;
            }
        }

        return new EventModel(dateModel, this.place);
    }

    /**
     * Create a copy of this XmlEvent
     * @returns {XmlEvent} A new XmlEvent instance with the same data
     */
    clone() {
        return new XmlEvent(this.type, this.date, this.place);
    }
}

module.exports = XmlEvent;

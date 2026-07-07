# LLMquality

Compare a GEDCOM file from RootsMagic and an XML file from Claude for data extracted from German Ortssippenbücher. The RootsMagic GEDCOM file serves as a ground truth and the XML file is an LLM-generated transcription of the same genealogical records.

## Author

Steve Turley — rsturley@churchofjesuschrist.org · rsteventurley@gmail.com

---

## Overview

LLMquality is an Express web application. You upload a GEDCOM file (`.ged`) and an XML file (`.xml`) that cover the same page of a German Ortssippenbuch, then click **Compare**. The server processes both files in a single atomic request and returns precision/recall/F1 scores across five categories: entries, people, cross-references, relationships, and events.

Both files must follow the naming convention `basename.###.ext` (e.g. `Tannenkirch.000.ged` / `Tannenkirch.000.xml`). The page number must match between the two files.

---

## Running Locally

```bash
# Install dependencies
npm install

# Start the server (default port 3000)
npm start

# Development mode with auto-restart on file changes
npm run dev
```

Open `http://localhost:3000` in a browser.

To use a different port:

```bash
PORT=4000 npm start
```

---

## Deploying with pm2

pm2 manages the server process and restarts it automatically on crash or reboot. If pm2 is already running other processes on your server, add LLMquality as a new named process — existing processes are not affected.

### First deploy

```bash
# On the server, from the project directory
pm2 start LLMquality.js --name "llmquality"

# Persist the updated process list (so llmquality survives reboots alongside existing pm2 apps)
pm2 save
```

### Updating after a code change

```bash
git pull
npm install          # only needed if package.json changed
pm2 restart llmquality
```

### Common pm2 commands

```bash
pm2 list                    # show all running processes (including existing ones)
pm2 logs llmquality         # tail the LLMquality logs
pm2 logs llmquality --lines 200   # last 200 log lines
pm2 stop llmquality         # stop without removing
pm2 delete llmquality       # remove from pm2 process list
pm2 restart llmquality      # restart after a code change
pm2 reload llmquality       # zero-downtime reload
```

### Environment variables

Set the port for production if 3000 conflicts with another process:

```bash
pm2 start LLMquality.js --name "llmquality" --env production \
  -- --port 3001
```

Or create an `ecosystem.config.js` in the project root:

```javascript
module.exports = {
  apps: [{
    name: 'llmquality',
    script: 'LLMquality.js',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
```

Then deploy with:

```bash
pm2 start ecosystem.config.js
pm2 save
```

---

## Web Application Firewall (WAF) — deferred, not currently enabled

In production (us-east-1), this app sits behind an ALB shared with GEDquality
(`llmquality.researchllm.org` / `gedquality.researchllm.org`, host-routed to separate
target groups). AWS WAF is a request-inspection layer that can attach directly to that
ALB — it's currently **not** attached, since nothing observed so far justifies its cost
(a Web ACL plus per-rule/per-request charges).

**Why it might matter later:** WAF blocks malicious *request content* (SQL injection
patterns, known bad IPs, high-volume single-source abuse) at the edge, before it reaches
the app. This app accepts file uploads (`POST /api/rate`), which is a common target for
abuse — a flood of upload requests would currently be absorbed by the app itself (and its
rate limiting), costing CPU/bandwidth on the instance rather than being rejected upfront.

**How to tell if it's become necessary — check these signals:**
- ALB CloudWatch metrics: sustained spikes in `RequestCountPerTarget`,
  `HTTPCode_Target_4XX_Count`, or `HTTPCode_ELB_5XX_Count`.
- App-level rate-limit rejections (via `express-rate-limit`) showing up repeatedly in
  `pm2 logs llmquality` from the same IP or IP range.
- Enable ALB access logs (to S3) if not already on, and review for repeated requests
  with attack-like patterns (SQLi/XSS strings in query params, credential-stuffing-style
  paths, etc.) or a small number of source IPs generating a disproportionate share of
  traffic.

**How to add it if needed:** attach an AWS WAF Web ACL to the existing ALB with the
managed rule groups `AWSManagedRulesCommonRuleSet` and
`AWSManagedRulesAmazonIpReputationList` (and a rate-based rule if the issue is
volumetric). This is purely additive — no change to the ALB, target groups, or app code
required.

---

## API

All processing happens through a single endpoint. The two separate pre-upload endpoints were removed to prevent cross-user data leakage.

### `POST /api/rate`

Accepts `multipart/form-data` with two required fields:

| Field | Type | Description |
|---|---|---|
| `gedcom` | file | GEDCOM file (`.ged`) — ground truth |
| `xml` | file | XML file (`.xml`) — LLM output to evaluate |

**Success response (200):**
```json
{
  "success": true,
  "results": "=== LLM Quality Rating Results ===\n..."
}
```

**Error responses:**
- `400` — missing file(s)
- `500` — parse or processing failure

---

## Running Tests

Tests require the server to be running on port 3000:

```bash
# Terminal 1
npm start

# Terminal 2
npm test
```

---

## Project Structure

```
LLMquality.js          Express server — single entry point
public/
  app.js               Browser client (vanilla JS)
  index.html           Single-page UI
GEDCOM/
  GedReader.js         Parses .ged files into a PageModel
XML/
  XmlReader.js         Parses .xml files into a PageModel
DataModel/             Genealogical data model library (see below)
test/
  serverIntegrationTest.js   Integration tests (require running server)
  readerMethodTest.js        Unit tests for GedReader / XmlReader
```

---

## DataModel Library

A library for handling genealogical data models, including date parsing and event modeling for GEDCOM and XML files.

### Features

- **DateModel**: ISO 8601 date parsing with genealogical qualifiers
- **EventModel**: Genealogical event modeling with dates and places
- **NameModel**: Personal name handling with given name and surname
- **PersonModel**: Complete person modeling with name and birth information
- **Place Translation**: German country names translated to English (Deutschland→Germany, Schweiz→Switzerland, etc.)
- Validation for dates between 1400–2000
- Support for approximate dates (ABT), before/after dates (BEF/AFT), and date ranges (BET…AND)
- Multiple output formats: GEDCOM, ISO 8601, and custom DD.MM.YYYY format

### Available Classes

- **DateModel**: Core date handling with validation and multiple format support
- **EventModel**: Event modeling combining DateModel with place information
- **NameModel**: Personal name handling with given name and surname components
- **PersonModel**: Complete person modeling with name, birth, death, christening, burial, families, references, and source information
  - `eventMatch(otherPerson)`: Returns true if at least one non-empty event matches between two PersonModel instances
  - `eventsMatch(otherPerson)`: Returns true if all events are either empty or match exactly
  - `fillEvents(place)`: Sets the place for events that have exact dates but no place information
- **FamilyModel**: Family modeling with husband, wife, children, and marriage information
  - `fillMarriage(place)`: Sets the place for marriage event if it has an exact date but no place
- **EntryModel**: Complete genealogical entry management with people, families, and relationship calculations
  - `addPerson(personId, uid, person)`: Adds a person with unique ID and UID checking
  - `addFamily(familyId, family)`: Adds a family and updates related people's family lists
  - `crossReference(uid)`: Returns person ID for a given UID, or -1 if not found
  - `getRelationship(personId)`: Returns relationship string with automatic tree calculation

### Usage

```javascript
const { DateModel, EventModel, NameModel, PersonModel, FamilyModel, EntryModel } = require('./DataModel');

const date = new DateModel();
date.setDate('1995-12-25');
console.log(date.toGEDCOM()); // "25 DEC 1995"

const name = new NameModel('Hans', 'Mueller');
const birth = new EventModel(date, 'Stuttgart, Deutschland');
const person = new PersonModel(name, birth);
console.log(person.getBirthPlaceTranslated()); // "Stuttgart, Germany"
```

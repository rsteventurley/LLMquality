/**
 * Integration tests for the LLMquality server endpoints
 * Tests the file upload and processing functionality
 * 
 * @author Steve Turley
 * @version 1.0.0
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');

describe('LLMquality Server Integration Tests', function() {
    const serverHost = 'localhost';
    const serverPort = 3000;
    const baseUrl = `http://${serverHost}:${serverPort}`;

    before(function(done) {
        // Give the server time to start up
        setTimeout(done, 1000);
    });

    describe('Server Health Check', function() {
        it('should respond to GET /', function(done) {
            http.get(baseUrl, (res) => {
                assert.strictEqual(res.statusCode, 200, 'Server should respond with 200');
                done();
            }).on('error', (err) => {
                done(err);
            });
        });
    });

    describe('API Endpoints', function() {
        it('should have upload endpoints available', function(done) {
            // Test a simple POST to ensure the endpoint exists (even though it will fail without files)
            const postData = JSON.stringify({});
            const options = {
                hostname: serverHost,
                port: serverPort,
                path: '/api/rate',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const req = http.request(options, (res) => {
                // We expect a 400 error since we're not sending proper data
                // but this confirms the endpoint exists and is responding
                assert(res.statusCode === 400 || res.statusCode === 500, 
                       'Rate endpoint should exist and respond (even with error for invalid data)');
                done();
            });

            req.on('error', (err) => {
                done(err);
            });

            req.write(postData);
            req.end();
        });
    });

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
                res.resume();
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
                res.resume();
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
                    try {
                        assert.strictEqual(res.statusCode, 400);
                        const json = JSON.parse(data);
                        assert.strictEqual(json.success, false);
                        assert.ok(json.error.includes('GEDCOM'),
                            'Error message should mention GEDCOM');
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
            });
            req.on('error', done);
            req.write(body);
            req.end();
        });
    });

    describe('Method Name Verification', function() {
        it('should confirm server uses correct reader methods', function() {
            // This test verifies the fix is in place
            const serverPath = path.join(__dirname, '../LLMquality.js');
            const serverContent = fs.readFileSync(serverPath, 'utf8');
            
            // Ensure the old incorrect method calls are not present
            assert(!serverContent.includes('gedReader.readFile('), 
                   'Server should not contain gedReader.readFile calls');
            assert(!serverContent.includes('xmlReader.readFile('), 
                   'Server should not contain xmlReader.readFile calls');
            
            // Ensure the correct method calls are present
            assert(serverContent.includes('gedReader.read('), 
                   'Server should contain gedReader.read calls');
            assert(serverContent.includes('xmlReader.readXml('), 
                   'Server should contain xmlReader.readXml calls');
        });
    });
});

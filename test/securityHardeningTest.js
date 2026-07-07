/**
 * Security hardening integration tests for the LLMquality server
 * Requires the server to be running on port 3000 (see README "Running Tests")
 */

const assert = require('assert');
const http = require('http');

describe('LLMquality Security Hardening', function() {
    const serverHost = 'localhost';
    const serverPort = 3000;

    describe('Helmet security headers', function() {
        it('should set X-Content-Type-Options on the root route', function(done) {
            http.get(`http://${serverHost}:${serverPort}/`, (res) => {
                assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
                done();
            }).on('error', done);
        });

        it('should set X-Frame-Options on the root route', function(done) {
            http.get(`http://${serverHost}:${serverPort}/`, (res) => {
                assert.ok(res.headers['x-frame-options'], 'expected X-Frame-Options header to be present');
                done();
            }).on('error', done);
        });
    });

    describe('Rate limiting on /api/rate', function() {
        it('should attach RateLimit headers to /api/rate responses', function(done) {
            const req = http.request({
                host: serverHost,
                port: serverPort,
                path: '/api/rate',
                method: 'POST'
            }, (res) => {
                assert.ok(
                    res.headers['ratelimit-limit'] !== undefined,
                    'expected a RateLimit-Limit header on /api/rate'
                );
                done();
            });
            req.on('error', done);
            req.end();
        });
    });
});

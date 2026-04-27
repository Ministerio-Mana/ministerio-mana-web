#!/usr/bin/env node

const fs = require('fs');

const filePath = process.argv[2];
let content = fs.readFileSync(filePath, 'utf8');

// Replace all fetch calls to /api/portal/* or /api/cuenta/* that don't already have credentials
// Pattern: fetch('/api/(portal|cuenta)/...', { ... })
// Add credentials: 'include' before the closing }

const lines = content.split('\n');
const modifiedLines = lines.map(line => {
    // Skip if already has credentials
    if (line.includes('credentials:')) {
        return line;
    }

    // Match fetch('/api/portal/... or fetch('/api/cuenta/...
    if (line.match(/fetch\('\/(api\/(portal|cuenta)[^']+)',\s*\{/)) {
        // Find the closing } for this fetch call
        // Simple case: single-line fetch
        if (line.includes('})')) {
            return line.replace(/}\)/, ", credentials: 'include' })");
        }
        // Multi-line: just add credentials after {
        return line + " /* NEEDS_CRED */";
    }

    // If previous line was marked, add credentials here
    if (lines[lines.indexOf(line) - 1] && lines[lines.indexOf(line) - 1].includes('/* NEEDS_CRED */')) {
        // Remove the marker from previous line
        const prevIdx = lines.indexOf(line);
        lines[prevIdx - 1] = lines[prevIdx - 1].replace(' /* NEEDS_CRED */', '');

        // This line might have headers or method
        // We need to add credentials after the last property
        if (line.trim() === '})' || line.trim() === '});') {
            return line.replace(/^(\s*)}\)/, "$1  credentials: 'include'\n$1})");
        }
    }

    return line;
});

fs.writeFileSync(filePath, modifiedLines.join('\n'), 'utf8');
console.log('Fixed:', filePath);

const fs = require('fs');
const path = require('path');
const appData = process.env.APPDATA;
const wsDir = path.join(appData, 'Code', 'User', 'workspaceStorage');

let total = 0;
for (const ws of fs.readdirSync(wsDir, { withFileTypes: true }).filter(e => e.isDirectory())) {
    const ccDir = path.join(wsDir, ws.name, 'github.copilot-chat');
    const txDir = path.join(ccDir, 'transcripts');
    if (!fs.existsSync(txDir)) continue;

    const files = fs.readdirSync(txDir).filter(f => f.endsWith('.jsonl'));
    total += files.length;
    if (files.length > 0) {
        console.log(ws.name.slice(0, 12), '|', files.length, 'transcripts');
        for (const f of files) {
            const p = path.join(txDir, f);
            const s = fs.statSync(p);
            const lines = fs.readFileSync(p, 'utf-8').split('\n').filter(l => l.trim());
            const start = lines.find(l => l.includes('session.start'));
            const producer = start ? (() => { try { return JSON.parse(start).data?.producer; } catch { return '?'; } })() : '?';
            const firstUser = lines.find(l => l.includes('user.message'));
            let topic = '';
            if (firstUser) {
                try {
                    topic = JSON.parse(firstUser).data?.content?.slice(0, 80)?.replace(/\n/g, ' ') || '';
                } catch { }
            }
            console.log(' ', f.slice(0, 8), '|',
                (s.size / 1024).toFixed(0) + 'KB', '|',
                new Date(s.mtime).toISOString().slice(0, 16).replace('T', ' '), '|',
                producer, '|',
                topic);
        }
    }
}
console.log('Total transcripts:', total);

// Also check if any are currently being written (mtime within last minute)
console.log('');
console.log('=== Actively writing (last 2 min) ===');
for (const ws of fs.readdirSync(wsDir, { withFileTypes: true }).filter(e => e.isDirectory())) {
    const txDir = path.join(wsDir, ws.name, 'github.copilot-chat', 'transcripts');
    if (!fs.existsSync(txDir)) continue;
    for (const f of fs.readdirSync(txDir).filter(f => f.endsWith('.jsonl'))) {
        const p = path.join(txDir, f);
        const s = fs.statSync(p);
        if (Date.now() - s.mtimeMs < 120000) {
            console.log('ACTIVE:', f, '-', (s.size / 1024).toFixed(0) + 'KB');
        }
    }
}

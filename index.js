const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { rimraf } = require('rimraf');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const activeSessions = {};

app.get('/pair', async (req, res) => {
    const phoneNumber = req.query.phone;
    const sessionId = 'session_' + Date.now();
    const sessionDir = path.join(__dirname, 'sessions', sessionId);

    if (!fs.existsSync(path.join(__dirname, 'sessions'))) {
        fs.mkdirSync(path.join(__dirname, 'sessions'));
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    try {
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: ["X Lord Hosting", "Chrome", "3.0.0"]
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'open') {
                await delay(5000);
                const credsFile = path.join(sessionDir, 'creds.json');
                if (fs.existsSync(credsFile)) {
                    const credsData = fs.readFileSync(credsFile, 'utf8');
                    activeSessions[sessionId] = { status: 'connected', creds: credsData };
                }
                await delay(3000);
                await rimraf(sessionDir);
            } else if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                if (reason !== DisconnectReason.loggedOut) {
                    // Handle reconnect logic if needed
                }
            }
        });

        let pairingCode = null;
        if (phoneNumber) {
            await delay(3000);
            let cleanedPhone = phoneNumber.replace(/[^0-9]/g, '');
            pairingCode = await sock.requestPairingCode(cleanedPhone);
            pairingCode = pairingCode?.match(/.{1,4}/g)?.join('-') || pairingCode;
        }

        res.json({ success: true, sessionId, pairingCode });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Failed to generate pairing code. Please try again.' });
    }
});

app.get('/check/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    if (activeSessions[sessionId]) {
        const data = activeSessions[sessionId];
        delete activeSessions[sessionId];
        res.json({ status: 'connected', creds: data.creds });
    } else {
        res.json({ status: 'pending' });
    }
});

app.listen(PORT, () => {
    console.log(`WhatsApp pairing server running on port ${PORT}`);
});

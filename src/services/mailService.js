const net = require('net');
const tls = require('tls');
const env = require('../config/env');

function smtpSend({ host, port, user, pass, from, to, data }) {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, host);
        let stage = 0;
        let tlsSocket = null;
        const send = (line) => (tlsSocket || socket).write(line + '\r\n');
        const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
        let buffer = '';
        const onData = (chunk) => {
            buffer += chunk.toString('utf8');
            if (!buffer.includes('\r\n')) return;
            const lines = buffer.split('\r\n');
            buffer = lines.pop();
            for (const line of lines) {
                const code = parseInt(line.slice(0, 3), 10);
                if (code >= 400) { cleanup(); return reject(new Error('SMTP error: ' + line)); }
                if (stage === 0 && code === 220) { send(`EHLO ${host}`); stage = 1; }
                else if (stage === 1 && code === 250) { send('STARTTLS'); stage = 2; }
                else if (stage === 2 && code === 220) {
                    tlsSocket = tls.connect({ socket, host, servername: host }, () => {
                        send(`EHLO ${host}`);
                        stage = 3;
                    });
                    tlsSocket.on('data', onData);
                    tlsSocket.on('error', (e) => { cleanup(); reject(e); });
                }
                else if (stage === 3 && code === 250) { send('AUTH LOGIN'); stage = 4; }
                else if (stage === 4 && code === 334) { send(b64(user)); stage = 5; }
                else if (stage === 5 && code === 334) { send(b64(pass)); stage = 6; }
                else if (stage === 6 && code === 235) { send(`MAIL FROM:<${user}>`); stage = 7; }
                else if (stage === 7 && code === 250) { send(`RCPT TO:<${to}>`); stage = 8; }
                else if (stage === 8 && code === 250) { send('DATA'); stage = 9; }
                else if (stage === 9 && code === 354) { (tlsSocket || socket).write(data + '\r\n.\r\n'); stage = 10; }
                else if (stage === 10 && code === 250) { send('QUIT'); cleanup(); resolve(); }
            }
        };
        const cleanup = () => { try { socket.destroy(); } catch {} };
        socket.on('data', onData);
        socket.on('error', (e) => { cleanup(); reject(e); });
        socket.setTimeout(15000, () => { cleanup(); reject(new Error('SMTP timeout')); });
    });
}

async function sendMail(to, subject, textBody) {
    if (!to || !to.includes('@')) throw new Error('Invalid recipient email.');
    // Read flag live: test sets process.env.OTP_DEV_LOG after require, so env
    // object (frozen at require time) alone would miss it.
    const devLog = process.env.OTP_DEV_LOG === 'true' || env.OTP_DEV_LOG;
    const nodeEnv = process.env.NODE_ENV || env.NODE_ENV;
    if (devLog) {
        if (nodeEnv === 'production') throw new Error('OTP_DEV_LOG is forbidden in production.');
        console.log(`[OTP-DEV] To: ${to} | ${subject} | ${textBody}`);
        return;
    }
    if (!env.SMTP_USER || !env.SMTP_PASS) throw new Error('SMTP credentials not configured.');
    const data = [
        `From: ${env.MAIL_FROM}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        textBody,
        ''
    ].join('\r\n');
    await smtpSend({ host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.MAIL_FROM, to, data });
}

module.exports = { sendMail };

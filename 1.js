import http2 from "http2"; 
import { WebSocket } from "ws";
import { readFileSync, watch } from "fs";


const token = "M";
const sunucu = "";
const istek = 999999999;
const kanal = "";
const guilds = new Map();
let heartbeatTimer;
let currentVanity = "";
let heartbeatAck = true;

const noop = () => { };
const PING_BUF = Buffer.alloc(8);
const payloadBuffer = Buffer.allocUnsafe(128);

const IDENTIFY_BUF = Buffer.from(`{"op":2,"d":{"token":"${token}","intents":1,"properties":{"os":"ayak","browser":"ayak","device":"ayak"}}}`);
const HEARTBEAT_BUF = Buffer.from('{"op":1,"d":{}}');

const GUILD_UPDATE_MARKER = '"GUILD_UPDATE"';
const GUILD_DELETE_MARKER = '"GUILD_DELETE"';
const READY_MARKER = '"READY"';
const VANITY_KEY = '"vanity_url_code":"';
const GUILD_ID_KEY = '"guild_id":"';

const PRIO = { weight: 256, exclusive: true, parent: 0 };

const DOMAINS = [
    "https://canary.discord.com",
    "https://discord.com",
    "https://ptb.discord.com",
    "https://canary.discord.com",
];

const headers = {
    ":method": "PATCH",
    ":path": `/api/v7/guilds/${sunucu}/vanity-url`,
    "authorization": token,
    "x-discord-mfa-authorization": "",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "x-super-properties": "eyJicm93c2VyIjoiQ2hyb21lIiwiYnJvd3Nlcl91c2VyX2FnZW50IjoiQ2hyb21lIiwiY2xpZW50X2J1aWxkX251bWJlciI6MzU1NjI0LCJkZXZpY2UiOiJhbnRoZWwifQ==",
    "content-type": "application/json",
};

const H2_OPTS = {
    settings: {
        enablePush: false,
        initialWindowSize: 16777215,
        maxFrameSize: 16777215,
        maxConcurrentStreams: 4294967295,
        maxHeaderListSize: 262144,
        enableConnectProtocol: false
    },
    maxSessionMemory: 1000,
    peerMaxConcurrentStreams: 4294967295,
};

const sessions = new Array(3).fill(null);
const socks = new Array(3).fill(null);
const pingTimers = new Array(3).fill(null);

const counts = new Array(3);
{
    let rem = istek;
    for (let i = 0; i < 3; i++) {
        counts[i] = Math.ceil(rem / (3 - i));
        rem -= counts[i];
    }
}

const createSession = (idx) => {
    if (sessions[idx] && !sessions[idx].destroyed) {
        try { sessions[idx].close(); } catch { }
    }
    if (pingTimers[idx]) { clearInterval(pingTimers[idx]); pingTimers[idx] = null; }

    const session = http2.connect(DOMAINS[idx], H2_OPTS);
    sessions[idx] = session;

    session.on("error", noop);
    session.on("goaway", () => {
        setTimeout(() => createSession(idx), 1000);
    });
    session.on("close", () => {
        socks[idx] = null;
        setTimeout(() => createSession(idx), 1000);
    });

    session.on("connect", (_, socket) => {
        if (socket) {
            socket.setNoDelay(true);
            socket.setKeepAlive(true, 60);
            socket.setTimeout(0);
            try {
                socket.setRecvBufferSize(4194304);
                socket.setSendBufferSize(4194304);
            } catch { }
            socks[idx] = socket;
        }
        pingTimers[idx] = setInterval(() => {
            if (!session.destroyed) {
                session.ping(PING_BUF, noop);
            }
        }, 30000);
    });
};

for (let i = 0; i < 3; i++) createSession(i);

const onData = (chunk) => {
    const idx = chunk.indexOf(123);
    if (idx !== -1) log(chunk.subarray(idx).toString());
};

const log = (data) => {
    if (!data.includes('"code"') && !data.includes('"message"')) return;
    let parsed;
    try { parsed = JSON.parse(data); } catch { return; }

    const body = JSON.stringify({
        content: `@everyone ${currentVanity}\n\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``
    });

    const s = sessions[0];
    if (s && !s.destroyed) {
        const req = s.request({
            ":method": "POST",
            ":path": `/api/channels/${kanal}/messages`,
            "authorization": token,
            "content-type": "application/json",
        });
        req.end(body);
    }
};

const fire = (code) => {
    currentVanity = code;
    const len = payloadBuffer.write(`{"code":"${code}"}`, 0, "utf8");
    const buf = payloadBuffer.subarray(0, len);

    for (let s = 0; s < 3; s++) {
        const session = sessions[s];
        const sock = socks[s];
        const cnt = counts[s];

        if (!session || session.destroyed || !sock || cnt === 0) continue;

        sock.cork();
        const r0 = session.request(headers, PRIO);
        r0.on("data", onData);
        r0.resume();
        r0.end(buf);

        for (let i = 1; i < cnt; i++) {
            const req = session.request(headers, PRIO);
            req.resume();
            req.end(buf);
        }
        sock.uncork();
    }
};


const connect = () => {
    const ws = new WebSocket("wss://gateway.discord.gg/?v=9&encoding=json", {
        perMessageDeflate: false,
        skipUTF8Validation: true,
        maxPayload: 0,
        handshakeTimeout: 2000
    });

    ws.onopen = noop;
    ws.onerror = noop;
    ws.onclose = () => {
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
        heartbeatAck = true;
        setTimeout(connect, 500);
    };

    ws.onmessage = ({ data }) => {
        if (data.charCodeAt(0) !== 123) return;

        if (data.includes(GUILD_UPDATE_MARKER)) {
            const gIdx = data.indexOf(GUILD_ID_KEY);
            if (gIdx === -1) return;
            const gStart = gIdx + GUILD_ID_KEY.length;
            const gEnd = data.indexOf('"', gStart);
            if (gEnd === -1) return;
            const guildId = data.substring(gStart, gEnd);

            const oldCode = guilds.get(guildId);
            if (!oldCode) return;

            const vIdx = data.indexOf(VANITY_KEY);
            if (vIdx !== -1) {
                const vStart = vIdx + VANITY_KEY.length;
                const vEnd = data.indexOf('"', vStart);
                const newCode = vEnd !== -1 ? data.substring(vStart, vEnd) : null;
                if (oldCode !== newCode) fire(oldCode);
            } else if (data.includes('"vanity_url_code":null')) {
                fire(oldCode);
            }
            return;
        }

        if (data.includes(GUILD_DELETE_MARKER)) {
            const gIdx = data.indexOf(GUILD_ID_KEY);
            let guildId;
            if (gIdx !== -1) {
                const gStart = gIdx + GUILD_ID_KEY.length;
                const gEnd = data.indexOf('"', gStart);
                if (gEnd !== -1) guildId = data.substring(gStart, gEnd);
            }
            if (!guildId) {
                const iIdx = data.indexOf('"id":"');
                if (iIdx !== -1) {
                    const iStart = iIdx + 6;
                    const iEnd = data.indexOf('"', iStart);
                    if (iEnd !== -1) guildId = data.substring(iStart, iEnd);
                }
            }
            if (guildId) {
                const oldCode = guilds.get(guildId);
                if (oldCode) {
                    const len = payloadBuffer.write(`{"code":"${oldCode}"}`, 0, "utf8");
                    const buf = payloadBuffer.subarray(0, len);
                    for (let s = 0; s < 3; s++) {
                        if (sessions[s] && !sessions[s].destroyed) {
                            const req = sessions[s].request(headers, PRIO);
                            req.on("data", onData);
                            req.resume();
                            req.end(buf);
                            break;
                        }
                    }
                    guilds.delete(guildId);
                }
            }
            return;
        }

        if (data.includes(READY_MARKER)) {
            try {
                const { d } = JSON.parse(data);
                guilds.clear();
                const g = d.guilds;
                for (let i = 0; i < g.length; i++) {
                    const { id, vanity_url_code } = g[i];
                    if (vanity_url_code) guilds.set(id, vanity_url_code);
                }
                console.log("ready");
            } catch { }
            return;
        }

        if (data.includes('"op":11')) {
            heartbeatAck = true;
            return;
        }

        if (data.includes('"op":10')) {
            ws.send(IDENTIFY_BUF);
            heartbeatAck = true;
            try {
                const { d } = JSON.parse(data);
                if (!heartbeatTimer) {
                    heartbeatTimer = setInterval(() => {
                        if (!heartbeatAck) {
                            ws.close();
                            return;
                        }
                        heartbeatAck = false;
                        if (ws.readyState === 1) ws.send(HEARTBEAT_BUF);
                    }, d.heartbeat_interval * 0.75);
                }
            } catch { }
            return;
        }

        if (data.includes('"op":7') || data.includes('"op":9')) {
            if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
            ws.close();
        }
    };
};

const updateMfa = () => {
    try {
        const t = readFileSync("mfa.txt", "utf8").trim();
        headers["x-discord-mfa-authorization"] = t;
    } catch { }
};

updateMfa();
watch("mfa.txt", (eventType) => {
    if (eventType === "change") updateMfa();
});

let readyCount = 0;
const onSessionReady = () => {
    if (++readyCount >= 3) connect();
};
for (let i = 0; i < 3; i++) sessions[i].once("connect", onSessionReady);

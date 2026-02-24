"use strict";
import http2 from "http2";
import WebSocket from "ws";
import fs from "fs";
import dns from "dns";
import os from "os";

dns.setDefaultResultOrder("ipv4first");
try {
    if (os.platform() !== "win32" && process.setPriority) {
        process.setPriority(process.pid, os.constants.priority.PRIORITY_HIGH);
    }
} catch (e) { }

const token = "";
const server = "";
const socket = 10000000000000000000000000000;
const kanal = "";
let currentVanity = "";

let mfatoken = "";
const guilds = {};
let ws;
let heartbeatTimer;


let cachedHeaders = null;
let cachedPayload = null;

const headercik = () => {
    cachedHeaders = {
        ":method": "PATCH",
        ":path": `/api/v7/guilds/${server}/vanity-url`,
        "authorization": token,
        "x-discord-mfa-authorization": mfatoken,
        "user-agent": "Mozilla/5.0",
        "x-super-properties": "eyJicm93c2VyIjoiQ2hyb21lIiwiYnJvd3Nlcl91c2VyX2FnZW50IjoiQ2hyb21lIiwiY2xpZW50X2J1aWxkX251bWJlciI6MzU1NjI0fQ==",
        "content-type": "application/json",
    };
    cachedPayload = null;
};

const clients = [];

const hetetepe2 = (i) => {
    const c = http2.connect("https://canary.discord.com", {
        settings: {
            enablePush: false,
            initialWindowSize: 2147483647,
            maxConcurrentStreams: 4294967295,
            maxHeaderListSize: 4294967295,
            maxFrameSize: 16777215
        },
        peerMaxConcurrentStreams: 4294967295,
        maxSessionMemory: 33554432
    });
    c.on("connect", (session, socket) => {
        if (socket) {
            socket.setNoDelay(true);
            socket.setKeepAlive(true, 0);
            try {
                socket.setRecvBufferSize?.(1048576);
                socket.setSendBufferSize?.(1048576);
            } catch (e) { }
        }
    });
    c.on("close", () => {
        setTimeout(() => hetetepe2(i), 100);
    });
    c.on("error", () => { });
    c.setMaxListeners(0);
    clients[i] = c;
};

for (let i = 0; i < socket; i++) {
    hetetepe2(i);
}


const response = (c) => {
    const s = c.toString();
    const idx = s.indexOf("{");
    if (idx === -1) return;

    const data = s.slice(idx);

    if (!data.includes('"code"') && !data.includes('"message"')) return;

    let parsed;
    try { parsed = JSON.parse(data); } catch { return; }

    const body = JSON.stringify({
        content: `@everyone ${currentVanity}\n\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``
    });

    for (let i = 0; i < socket; i++) {
        const client = clients[i];
        if (client && !client.destroyed) {
            const req = client.request({
                ":method": "POST",
                ":path": `/api/channels/${kanal}/messages`,
                "authorization": token,
                "content-type": "application/json",
            });
            req.end(body);
            break;
        }
    }
};

clients[0].once("connect", connectWebSocket);

function connectWebSocket() {
    ws = new WebSocket("wss://gateway.discord.gg/", {
        perMessageDeflate: false,
        maxPayload: 1024 * 1024
    });
    ws.on("open", () => {
        if (ws._socket) {
            ws._socket.setNoDelay(true);
            ws._socket.setKeepAlive(true, 0);
            try {
                ws._socket.setRecvBufferSize?.(256 * 1024);
                ws._socket.setSendBufferSize?.(256 * 1024);
            } catch (e) { }
        }
        console.log("ws ok");
    });
    ws.onclose = () => reconnect();
    ws.onerror = () => reconnect();

    ws.onmessage = (message) => {
        try {
            const { d, op, t } = JSON.parse(message.data);

            if (t === "GUILD_UPDATE") {
                const existing = guilds[d.guild_id];
                if (existing && existing !== d.vanity_url_code) {
                    currentVanity = existing;
                    if (cachedHeaders) {
                        if (!cachedPayload) {
                            cachedPayload = Buffer.from(`{"code":"${existing}"}`);
                        }
                        const h = cachedHeaders;
                        const p = cachedPayload;
                        for (let i = 0; i < socket; i++) {
                            if (clients[i] && !clients[i].destroyed) {
                                try {
                                    const r = clients[i].request(h);
                                    r.on("data", response);
                                    r.on("error", () => { });
                                    r.end(p);
                                } catch (e) { }
                            }
                        }
                        console.log(`fired: ${existing}`);
                    }
                }
            } else if (t === "READY") {
                const g = d.guilds;
                for (let i = 0, len = g.length; i < len; i++) {
                    const { id, vanity_url_code } = g[i];
                    if (vanity_url_code) {
                        guilds[id] = vanity_url_code;
                        if (id === server) {
                            cachedPayload = Buffer.from(`{"code":"${vanity_url_code}"}`);
                        }
                    }
                }
                console.log("ready", Object.values(guilds).join(", "));
            }

            if (op === 10) {
                ws.send('{\"op\":2,\"d\":{\"token\":\"' + token + '\",\"intents\":1,\"properties\":{\"os\":\"yagmurlar\",\"browser\":\"yagsin\",\"device\":\"uzerime\"}}}')
                if (!heartbeatTimer) {
                    heartbeatTimer = setInterval(() => ws.send('{\"op\":1,\"d\":{}}'), d.heartbeat_interval * 0.9);
                }
            }
            if (op === 7) reconnect();
        } catch (e) { }
    };
}

function reconnect() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    setTimeout(connectWebSocket, 3000);
}

const loadMfatoken = () => {
    fs.readFile("mfa.txt", "utf8", (err, data) => {
        if (!err) {
            mfatoken = data.trim();
            headercik();
        }
    });
};
loadMfatoken();
fs.watch("mfa.txt", (eventType) => {
    if (eventType === "change") loadMfatoken();
});

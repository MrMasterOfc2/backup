const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const cheerio = require('cheerio');
const { Octokit } = require('@octokit/rest');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const FormData = require("form-data");
const os = require('os');
const { sms, downloadMediaMessage } = require("./msg");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    downloadContentFromMessage,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    S_WHATSAPP_NET
} = require('@whiskeysockets/baileys');

const config = {
    AUTO_VIEW_STATUS: true,
    AUTO_LIKE_STATUS: true,
    AUTO_RECORDING: true,
    AUTO_LIKE_EMOJI: ['💋', '😶', '✨️', '💗', '🎈', '🎉', '🥳', '❤️', '🧫', '🐭'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    IMAGE_PATH: 'https://files.catbox.moe/2c9ak5.jpg',
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/DPWeJpfzulh0rjpHcxW9d3?mode=ems_copy_t',
    ADMIN_LIST_PATH: './admin.json',
    RCD_IMAGE_PATH: 'https://files.catbox.moe/2c9ak5.jpg',
    NEWSLETTER_JID: 'jid eka dapn',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    version: '2.0.0',
    OWNER_NUMBER: '94741856766',
    BOT_FOOTER: '> 𝐏𝐎𝐖𝐄𝐑𝐃 𝘽𝙔 𝐀𝐒𝐇𝐈𝐘𝐀-𝐌𝐃 🥷🇱🇰',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029VbBeguyIyPtc2S14xD1x',
    
    // NEW FEATURES CONFIG
    BOT_MODE: 'public', // 'public' or 'private'
    ALLOWED_USERS: [],
    AI_ENABLED: true,
    GEMINI_API_KEY: 'AIzaSyC50wC4dZ1LyH0sGuOBDuN4OijpjgKTjoE', // Replace with your Gemini API key
    
    // STATUS FEATURES
    STATUS_FEATURES: {
        auto_view: true,
        auto_like: true,
        auto_recording: true
    }
};

const octokit = new Octokit({ auth: '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' });
const owner = 'me-tech-maker';
const repo = 'MINI-BARBIE-TRASH';

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const otpStore = new Map();

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSriLankaTimestamp() {
    return moment().tz('Africa/Nairobi').format('YYYY-MM-DD HH:mm:ss');
}

async function cleanDuplicateFiles(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith(`empire_${sanitizedNumber}_`) && file.name.endsWith('.json')
        ).sort((a, b) => {
            const timeA = parseInt(a.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            const timeB = parseInt(b.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            return timeB - timeA;
        });

        const configFiles = data.filter(file => 
            file.name === `config_${sanitizedNumber}.json`
        );

        if (sessionFiles.length > 1) {
            for (let i = 1; i < sessionFiles.length; i++) {
                await octokit.repos.deleteFile({
                    owner,
                    repo,
                    path: `session/${sessionFiles[i].name}`,
                    message: `Delete duplicate session file for ${sanitizedNumber}`,
                    sha: sessionFiles[i].sha
                });
                console.log(`Deleted duplicate session file: ${sessionFiles[i].name}`);
            }
        }

        if (configFiles.length > 0) {
            console.log(`Config file for ${sanitizedNumber} already exists`);
        }
    } catch (error) {
        console.error(`Failed to clean duplicate files for ${number}:`, error);
    }
}

let totalcmds = async () => {
  try {
    const filePath = "./pair.js";
    const mytext = await fs.readFile(filePath, "utf-8");
    const caseRegex = /(^|\n)\s*case\s*['"][^'"]+['"]\s*:/g;
    const lines = mytext.split("\n");
    let count = 0;

    for (const line of lines) {
      if (line.trim().startsWith("//") || line.trim().startsWith("/*")) continue;
      if (line.match(/^\s*case\s*['"][^'"]+['"]\s*:/)) {
        count++;
      }
    }

    return count;
  } catch (error) {
    console.error("Error reading pair.js:", error.message);
    return 0;
  }
}

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES || 3;
    let inviteCode = 'JlI0FDZ5RpAEbeKvzAPpFt';
    if (config.GROUP_INVITE_LINK) {
        const cleanInviteLink = config.GROUP_INVITE_LINK.split('?')[0];
        const inviteCodeMatch = cleanInviteLink.match(/chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]+)/);
        if (!inviteCodeMatch) {
            console.error('Invalid group invite link format:', config.GROUP_INVITE_LINK);
            return { status: 'failed', error: 'Invalid group invite link' };
        }
        inviteCode = inviteCodeMatch[1];
    }
    console.log(`Attempting to join group with invite code: ${inviteCode}`);

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            console.log('Group join response:', JSON.stringify(response, null, 2));
            if (response?.gid) {
                console.log(`[ ✅ ] Successfully joined group with ID: ${response.gid}`);
                return { status: 'success', gid: response.gid };
            }
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message.includes('not-authorized')) {
                errorMessage = 'Bot is not authorized to join (possibly banned)';
            } else if (error.message.includes('conflict')) {
                errorMessage = 'Bot is already a member of the group';
            } else if (error.message.includes('gone') || error.message.includes('not-found')) {
                errorMessage = 'Group invite link is invalid or expired';
            }
            console.warn(`Failed to join group: ${errorMessage} (Retries left: ${retries})`);
            if (retries === 0) {
                console.error('[ ❌ ] Failed to join group', { error: errorMessage });
                try {
                    await socket.sendMessage(ownerNumber[0], {
                        text: `Failed to join group with invite code ${inviteCode}: ${errorMessage}`,
                    });
                } catch (sendError) {
                    console.error(`Failed to send failure message to owner: ${sendError.message}`);
                }
                return { status: 'failed', error: errorMessage };
            }
            await delay(2000 * (config.MAX_RETRIES - retries + 1));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔐 OTP VERIFICATION',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
        '> *Powered by ASHIYA-MD 🥷*'
    );

    try {
        await socket.sendMessage(userJid, { text: message });
        console.log(`OTP ${otp} sent to ${number}`);
    } catch (error) {
        console.error(`Failed to send OTP to ${number}:`, error);
        throw error;
    }
}

function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key) return;

        const allNewsletterJIDs = await loadNewsletterJIDsFromRaw();
        const jid = message.key.remoteJid;

        if (!allNewsletterJIDs.includes(jid)) return;

        try {
            const emojis = ['🩵', '🫶', '😀', '👍', '😶'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            const messageId = message.newsletterServerId;

            if (!messageId) {
                console.warn('No newsletterServerId found in message:', message);
                return;
            }

            let retries = 3;
            while (retries-- > 0) {
                try {
                    await socket.newsletterReactMessage(jid, messageId.toString(), randomEmoji);
                    console.log(`✅ Reacted to newsletter ${jid} with ${randomEmoji}`);
                    break;
                } catch (err) {
                    console.warn(`❌ Reaction attempt failed (${3 - retries}/3):`, err.message);
                    await delay(1500);
                }
            }
        } catch (error) {
            console.error('⚠️ Newsletter reaction handler failed:', error.message);
        }
    });
}

async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || 
            !message.key.participant || message.key.remoteJid === config.NEWSLETTER_JID) return;
        
        const statusFeatures = config.STATUS_FEATURES || {
            auto_view: config.AUTO_VIEW_STATUS === true || config.AUTO_VIEW_STATUS === 'true',
            auto_like: config.AUTO_LIKE_STATUS === true || config.AUTO_LIKE_STATUS === 'true',
            auto_recording: config.AUTO_RECORDING === true || config.AUTO_RECORDING === 'true'
        };
        
        try {
            if (statusFeatures.auto_recording && message.key.remoteJid) {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }

            if (statusFeatures.auto_view) {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to read status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }

            if (statusFeatures.auto_like) {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(
                            message.key.remoteJid,
                            { react: { text: randomEmoji, key: message.key } },
                            { statusJidList: [message.key.participant] }
                        );
                        console.log(`Reacted to status with ${randomEmoji}`);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;

        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();
        
        const message = formatMessage(
            '🗑️ MESSAGE DELETED',
            `A message was deleted from your chat.\n📋 From: ${messageKey.remoteJid}\n🍁 Deletion Time: ${deletionTime}`,
            '> 𝐏𝐎𝐖𝐄𝐑𝐃 𝘽𝙔 𝐀𝐒𝐇𝐈𝐘𝐀-𝐌𝐃 🥷🇱🇰'
        );

        try {
            await socket.sendMessage(userJid, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: message
            });
            console.log(`Notified ${number} about message deletion: ${messageKey.id}`);
        } catch (error) {
            console.error('Failed to send deletion notification:', error);
        }
    });
}

async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}

async function oneViewmeg(socket, isOwner, msg, sender) {
    if (!isOwner) {
        await socket.sendMessage(sender, {
            text: '❌ *ᴏɴʟʏ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ᴠɪᴇᴡ ᴏɴᴄᴇ ᴍᴇssᴀɢᴇs!*'
        });
        return;
    }
    try {
        const quoted = msg;
        let cap, anu;
        if (quoted.imageMessage?.viewOnce) {
            cap = quoted.imageMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.imageMessage);
            await socket.sendMessage(sender, { image: { url: anu }, caption: cap });
        } else if (quoted.videoMessage?.viewOnce) {
            cap = quoted.videoMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.videoMessage);
            await socket.sendMessage(sender, { video: { url: anu }, caption: cap });
        } else if (quoted.audioMessage?.viewOnce) {
            cap = quoted.audioMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.audioMessage);
            await socket.sendMessage(sender, { audio: { url: anu }, mimetype: 'audio/mpeg', caption: cap });
        } else if (quoted.viewOnceMessageV2?.message?.imageMessage) {
            cap = quoted.viewOnceMessageV2.message.imageMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.viewOnceMessageV2.message.imageMessage);
            await socket.sendMessage(sender, { image: { url: anu }, caption: cap });
        } else if (quoted.viewOnceMessageV2?.message?.videoMessage) {
            cap = quoted.viewOnceMessageV2.message.videoMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.viewOnceMessageV2.message.videoMessage);
            await socket.sendMessage(sender, { video: { url: anu }, caption: cap });
        } else if (quoted.viewOnceMessageV2Extension?.message?.audioMessage) {
            cap = quoted.viewOnceMessageV2Extension.message.audioMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.viewOnceMessageV2Extension.message.audioMessage);
            await socket.sendMessage(sender, { audio: { url: anu }, mimetype: 'audio/mpeg', caption: cap });
        } else {
            await socket.sendMessage(sender, {
                text: '❌ *Not a valid view-once message, love!* 😢'
            });
        }
        if (anu && fs.existsSync(anu)) fs.unlinkSync(anu);
        } catch (error) {
        console.error('oneViewmeg error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Failed to process view-once message, babe!* 😢\nError: ${error.message || 'Unknown error'}`
        });
    }
}

// NEW: Admin React Function
async function sendAdminReact(socket, message, reaction = '👑') {
    try {
        const admins = loadAdmins();
        for (const admin of admins) {
            const adminJid = `${admin.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
            try {
                await socket.sendMessage(adminJid, { 
                    react: { text: reaction, key: message.key } 
                });
                console.log(`✅ Reacted to admin ${admin} with ${reaction}`);
            } catch (error) {
                console.error(`Failed to react to admin ${admin}:`, error);
            }
        }
    } catch (error) {
        console.error('Admin react error:', error);
    }
}

// NEW: Generate Pairing Code Function
async function generatePairingCode(socket, number) {
    try {
        const code = await socket.requestPairingCode(number);
        return code;
    } catch (error) {
        console.error('Failed to generate pairing code:', error);
        return null;
    }
}

function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        const type = getContentType(msg.message);
        if (!msg.message) return;
        msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const m = sms(socket, msg);
        const quoted =
            type == "extendedTextMessage" &&
            msg.message.extendedTextMessage.contextInfo != null
              ? msg.message.extendedTextMessage.contextInfo.quotedMessage || []
              : [];
        const body = (type === 'conversation') ? msg.message.conversation 
            : msg.message?.extendedTextMessage?.contextInfo?.hasOwnProperty('quotedMessage') 
                ? msg.message.extendedTextMessage.text 
            : (type == 'interactiveResponseMessage') 
                ? msg.message.interactiveResponseMessage?.nativeFlowResponseMessage 
                    && JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)?.id 
            : (type == 'templateButtonReplyMessage') 
                ? msg.message.templateButtonReplyMessage?.selectedId 
            : (type === 'extendedTextMessage') 
                ? msg.message.extendedTextMessage.text 
            : (type == 'imageMessage') && msg.message.imageMessage.caption 
                ? msg.message.imageMessage.caption 
            : (type == 'videoMessage') && msg.message.videoMessage.caption 
                ? msg.message.videoMessage.caption 
            : (type == 'buttonsResponseMessage') 
                ? msg.message.buttonsResponseMessage?.selectedButtonId 
            : (type == 'listResponseMessage') 
                ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
            : (type == 'messageContextInfo') 
                ? (msg.message.buttonsResponseMessage?.selectedButtonId 
                    || msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
                    || msg.text) 
            : (type === 'viewOnceMessage') 
                ? msg.message[type]?.message[getContentType(msg.message[type].message)] 
            : (type === "viewOnceMessageV2") 
                ? (msg.message[type]?.message?.imageMessage?.caption || msg.message[type]?.message?.videoMessage?.caption || "") 
            : '';
        let sender = msg.key.remoteJid;
        const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid);
        const senderNumber = nowsender.split('@')[0];
        const developers = `${config.OWNER_NUMBER}`;
        const botNumber = socket.user.id.split(':')[0];
        const isbot = botNumber.includes(senderNumber);
        const isOwner = isbot ? isbot : developers.includes(senderNumber);
        var prefix = config.PREFIX;
        var isCmd = body.startsWith(prefix);
        const from = msg.key.remoteJid;
        const isGroup = from.endsWith("@g.us");
        const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '.';
        var args = body.trim().split(/ +/).slice(1);

        // Command access control for private mode
        if (config.BOT_MODE === 'private' && !isOwner && !config.ALLOWED_USERS.includes(senderNumber)) {
            const allowedCommands = ['alive', 'ping', 'menu', 'allmenu', 'bot_info', 'bot_stats', 'pair'];
            
            if (!allowedCommands.includes(command)) {
                await socket.sendMessage(sender, {
                    text: '❌ This bot is in private mode. Contact the owner for access.'
                }, { quoted: fakevCard });
                return;
            }
        }

        async function isGroupAdmin(jid, user) {
            try {
                const groupMetadata = await socket.groupMetadata(jid);
                const participant = groupMetadata.participants.find(p => p.id === user);
                return participant?.admin === 'admin' || participant?.admin === 'superadmin' || false;
            } catch (error) {
                console.error('Error checking group admin status:', error);
                return false;
            }
        }

        const isSenderGroupAdmin = isGroup ? await isGroupAdmin(from, nowsender) : false;

        socket.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
            let quoted = message.msg ? message.msg : message;
            let mime = (message.msg || message).mimetype || '';
            let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
            const stream = await downloadContentFromMessage(quoted, messageType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            let type = await FileType.fromBuffer(buffer);
            trueFileName = attachExtension ? (filename + '.' + type.ext) : filename;
            await fs.writeFileSync(trueFileName, buffer);
            return trueFileName;
        };

        if (!command) return;
        const count = await totalcmds();

        const fakevCard = {
            key: {
                fromMe: false,
                participant: "0@s.whatsapp.net",
                remoteJid: "status@broadcast"
            },
            message: {
                contactMessage: {
                    displayName: "𝐀𝐒𝐇𝐈𝐘𝐀-𝐌𝐃 🥷🇱🇰",
                    vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Meta\nORG:META AI;\nTEL;type=CELL;type=VOICE;waid=254101022551:+254101022551\nEND:VCARD`
                }
            }
        };

        try {
            switch (command) {
                // ==================== NEW FEATURES START ====================
                
                case 'autostatus': {
                    try {
                        await socket.sendMessage(sender, { react: { text: '📱', key: msg.key } });
                        
                        const statusFeatures = config.STATUS_FEATURES || {
                            auto_view: config.AUTO_VIEW_STATUS === true || config.AUTO_VIEW_STATUS === 'true',
                            auto_like: config.AUTO_LIKE_STATUS === true || config.AUTO_LIKE_STATUS === 'true',
                            auto_recording: config.AUTO_RECORDING === true || config.AUTO_RECORDING === 'true'
                        };
                        
                        let responseText = `📱 *AUTO STATUS SETTINGS*\n\n`;
                        responseText += `👁️ Auto View Status: ${statusFeatures.auto_view ? '✅ ON' : '❌ OFF'}\n`;
                        responseText += `❤️ Auto Like Status: ${statusFeatures.auto_like ? '✅ ON' : '❌ OFF'}\n`;
                        responseText += `🎤 Auto Recording: ${statusFeatures.auto_recording ? '✅ ON' : '❌ OFF'}\n\n`;
                        responseText += `📌 *Usage:*\n`;
                        responseText += `• ${config.PREFIX}autoview on/off\n`;
                        responseText += `• ${config.PREFIX}autolike on/off\n`;
                        responseText += `• ${config.PREFIX}autorecord on/off\n`;
                        responseText += `• ${config.PREFIX}allstatus on/off\n\n`;
                        responseText += `> Powered by ASHIYA-MD 🥷🇱🇰`;
                        
                        await socket.sendMessage(sender, {
                            text: responseText
                        }, { quoted: fakevCard });
                        
                    } catch (error) {
                        console.error('Autostatus command error:', error);
                        await socket.sendMessage(sender, {
                            text: '❌ Failed to fetch auto status settings'
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'autoview': {
                    if (!isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ Only bot owner can change auto status settings!'
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    const action = args[0]?.toLowerCase();
                    if (!action || !['on', 'off', 'true', 'false'].includes(action)) {
                        await socket.sendMessage(sender, {
                            text: `📌 Usage: ${config.PREFIX}autoview on/off`
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    const isEnabled = action === 'on' || action === 'true';
                    config.STATUS_FEATURES.auto_view = isEnabled;
                    config.AUTO_VIEW_STATUS = isEnabled;
                    
                    await socket.sendMessage(sender, {
                        text: `✅ Auto View Status ${isEnabled ? 'ENABLED' : 'DISABLED'}`
                    }, { quoted: fakevCard });
                    break;
                }

                case 'autolike': {
                    if (!isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ Only bot owner can change auto status settings!'
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    const action = args[0]?.toLowerCase();
                    if (!action || !['on', 'off', 'true', 'false'].includes(action)) {
                        await socket.sendMessage(sender, {
                            text: `📌 Usage: ${config.PREFIX}autolike on/off`
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    const isEnabled = action === 'on' || action === 'true';
                    config.STATUS_FEATURES.auto_like = isEnabled;
                    config.AUTO_LIKE_STATUS = isEnabled;
                    
                    await socket.sendMessage(sender, {
                        text: `✅ Auto Like Status ${isEnabled ? 'ENABLED' : 'DISABLED'}`
                    }, { quoted: fakevCard });
                    break;
                }

                case 'autorecord': {
                    if (!isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ Only bot owner can change auto status settings!'
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    const action = args[0]?.toLowerCase();
                    if (!action || !['on', 'off', 'true', 'false'].includes(action)) {
                        await socket.sendMessage(sender, {
                            text: `📌 Usage: ${config.PREFIX}autorecord on/off`
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    const isEnabled = action === 'on' || action === 'true';
                    config.STATUS_FEATURES.auto_recording = isEnabled;
                    config.AUTO_RECORDING = isEnabled;
                    
                    await socket.sendMessage(sender, {
                        text: `✅ Auto Recording ${isEnabled ? 'ENABLED' : 'DISABLED'}`
                    }, { quoted: fakevCard });
                    break;
                }

                case 'allstatus': {
                    if (!isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ Only bot owner can change auto status settings!'
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    const action = args[0]?.toLowerCase();
                    if (!action || !['on', 'off', 'true', 'false'].includes(action)) {
                        await socket.sendMessage(sender, {
                            text: `📌 Usage: ${config.PREFIX}allstatus on/off`
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    const isEnabled = action === 'on' || action === 'true';
                    config.STATUS_FEATURES.auto_view = isEnabled;
                    config.STATUS_FEATURES.auto_like = isEnabled;
                    config.STATUS_FEATURES.auto_recording = isEnabled;
                    config.AUTO_VIEW_STATUS = isEnabled;
                    config.AUTO_LIKE_STATUS = isEnabled;
                    config.AUTO_RECORDING = isEnabled;
                    
                    await socket.sendMessage(sender, {
                        text: `✅ All Auto Status Features ${isEnabled ? 'ENABLED' : 'DISABLED'}`
                    }, { quoted: fakevCard });
                    break;
                }

                case 'mode': {
                    if (!isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ Only bot owner can change bot mode!'
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    const mode = args[0]?.toLowerCase();
                    if (!mode || !['public', 'private'].includes(mode)) {
                        await socket.sendMessage(sender, {
                            text: `📌 Usage: ${config.PREFIX}mode public/private\n\nCurrent mode: ${config.BOT_MODE}`
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    config.BOT_MODE = mode;
                    
                    await socket.sendMessage(sender, {
                        text: `✅ Bot mode changed to *${mode.toUpperCase()}*`
                    }, { quoted: fakevCard });
                    break;
                }

                case 'allow': {
                    if (!isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ Only bot owner can add users!'
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    if (config.BOT_MODE !== 'private') {
                        await socket.sendMessage(sender, {
                            text: 'ℹ️ Bot is in public mode. Switch to private mode first!'
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    const userNumber = args[0]?.replace(/[^0-9]/g, '');
                    if (!userNumber || userNumber.length < 10) {
                        await socket.sendMessage(sender, {
                            text: `📌 Usage: ${config.PREFIX}allow 9474xxxxxx`
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    if (!config.ALLOWED_USERS.includes(userNumber)) {
                        config.ALLOWED_USERS.push(userNumber);
                        await socket.sendMessage(sender, {
                            text: `✅ User ${userNumber} added to allowed list`
                        }, { quoted: fakevCard });
                    } else {
                        await socket.sendMessage(sender, {
                            text: `⚠️ User ${userNumber} is already in allowed list`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'removeuser': {
                    if (!isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ Only bot owner can remove users!'
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    const userNumber = args[0]?.replace(/[^0-9]/g, '');
                    if (!userNumber || userNumber.length < 10) {
                        await socket.sendMessage(sender, {
                            text: `📌 Usage: ${config.PREFIX}removeuser 9474xxxxxx`
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    const index = config.ALLOWED_USERS.indexOf(userNumber);
                    if (index > -1) {
                        config.ALLOWED_USERS.splice(index, 1);
                        await socket.sendMessage(sender, {
                            text: `✅ User ${userNumber} removed from allowed list`
                        }, { quoted: fakevCard });
                    } else {
                        await socket.sendMessage(sender, {
                            text: `❌ User ${userNumber} not found in allowed list`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'users': {
                    if (!isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ Only bot owner can view allowed users!'
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    let responseText = `📋 *ALLOWED USERS LIST*\n\n`;
                    responseText += `Mode: ${config.BOT_MODE.toUpperCase()}\n`;
                    responseText += `Total users: ${config.ALLOWED_USERS.length}\n\n`;
                    
                    if (config.ALLOWED_USERS.length > 0) {
                        config.ALLOWED_USERS.forEach((user, index) => {
                            responseText += `${index + 1}. ${user}\n`;
                        });
                    } else {
                        responseText += `No users in the list`;
                    }
                    
                    responseText += `\n\n> Powered by ASHIYA-MD 🥷🇱🇰`;
                    
                    await socket.sendMessage(sender, {
                        text: responseText
                    }, { quoted: fakevCard });
                    break;
                }

                case 'aion': {
                    if (!isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ Only bot owner can enable/disable AI!'
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    const action = args[0]?.toLowerCase();
                    if (!action || !['on', 'off'].includes(action)) {
                        await socket.sendMessage(sender, {
                            text: `📌 Usage: ${config.PREFIX}aion on/off\n\nCurrent status: ${config.AI_ENABLED ? 'ON' : 'OFF'}`
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    config.AI_ENABLED = action === 'on';
                    
                    await socket.sendMessage(sender, {
                        text: `✅ AI features ${config.AI_ENABLED ? 'ENABLED' : 'DISABLED'}`
                    }, { quoted: fakevCard });
                    break;
                }

                case 'setgemini': {
                    if (!isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ Only bot owner can set Gemini API key!'
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    const apiKey = args[0];
                    if (!apiKey) {
                        await socket.sendMessage(sender, {
                            text: `📌 Usage: ${config.PREFIX}setgemini YOUR_API_KEY`
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    config.GEMINI_API_KEY = apiKey;
                    
                    await socket.sendMessage(sender, {
                        text: '✅ Gemini API key updated successfully!'
                    }, { quoted: fakevCard });
                    break;
                }

                case 'adminreact': {
                    if (!isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ Only bot owner can use this command!'
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    const reaction = args[0] || '👑';
                    
                    await sendAdminReact(socket, msg, reaction);
                    
                    await socket.sendMessage(sender, {
                        text: `✅ Reacted to all admins with ${reaction}`
                    }, { quoted: fakevCard });
                    break;
                }

                case 'settings': {
                    await socket.sendMessage(sender, { react: { text: '⚙️', key: msg.key } });
                    
                    try {
                        const settingsMessage = {
                            text: `⚙️ *BOT SETTINGS*\n\nSelect a category to configure:`,
                            buttons: [
                                {
                                    buttonId: `${config.PREFIX}settings_status`,
                                    buttonText: { displayText: '📱 Status Auto Features' },
                                    type: 1
                                },
                                {
                                    buttonId: `${config.PREFIX}settings_mode`,
                                    buttonText: { displayText: '🔐 Bot Mode Settings' },
                                    type: 1
                                },
                                {
                                    buttonId: `${config.PREFIX}settings_ai`,
                                    buttonText: { displayText: '🤖 AI Settings' },
                                    type: 1
                                }
                            ],
                            headerType: 1
                        };
                        
                        await socket.sendMessage(sender, settingsMessage, { quoted: fakevCard });
                        
                    } catch (error) {
                        console.error('Settings command error:', error);
                        await socket.sendMessage(sender, {
                            text: '❌ Failed to load settings menu'
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'settings_status': {
                    const statusFeatures = config.STATUS_FEATURES || {
                        auto_view: config.AUTO_VIEW_STATUS === true || config.AUTO_VIEW_STATUS === 'true',
                        auto_like: config.AUTO_LIKE_STATUS === true || config.AUTO_LIKE_STATUS === 'true',
                        auto_recording: config.AUTO_RECORDING === true || config.AUTO_RECORDING === 'true'
                    };
                    
                    const statusMessage = {
                        text: `📱 *STATUS AUTO FEATURES*\n\nCurrent settings:\n\n` +
                              `👁️ Auto View: ${statusFeatures.auto_view ? '✅ ON' : '❌ OFF'}\n` +
                              `❤️ Auto Like: ${statusFeatures.auto_like ? '✅ ON' : '❌ OFF'}\n` +
                              `🎤 Auto Record: ${statusFeatures.auto_recording ? '✅ ON' : '❌ OFF'}\n\n` +
                              `Quick toggle:`,
                        buttons: [
                            {
                                buttonId: `${config.PREFIX}autoview ${statusFeatures.auto_view ? 'off' : 'on'}`,
                                buttonText: { displayText: `${statusFeatures.auto_view ? '❌ Disable' : '✅ Enable'} Auto View` },
                                type: 1
                            },
                            {
                                buttonId: `${config.PREFIX}autolike ${statusFeatures.auto_like ? 'off' : 'on'}`,
                                buttonText: { displayText: `${statusFeatures.auto_like ? '❌ Disable' : '✅ Enable'} Auto Like` },
                                type: 1
                            },
                            {
                                buttonId: `${config.PREFIX}autorecord ${statusFeatures.auto_recording ? 'off' : 'on'}`,
                                buttonText: { displayText: `${statusFeatures.auto_recording ? '❌ Disable' : '✅ Enable'} Auto Record` },
                                type: 1
                            }
                        ],
                        headerType: 1
                    };
                    
                    await socket.sendMessage(sender, statusMessage, { quoted: fakevCard });
                    break;
                }

                case 'settings_mode': {
                    const modeMessage = {
                        text: `🔐 *BOT MODE SETTINGS*\n\nCurrent mode: ${config.BOT_MODE.toUpperCase()}\n\n` +
                              `Public: Anyone can use the bot\n` +
                              `Private: Only allowed users can use\n\n` +
                              `Allowed users: ${config.ALLOWED_USERS.length}`,
                        buttons: [
                            {
                                buttonId: `${config.PREFIX}mode ${config.BOT_MODE === 'public' ? 'private' : 'public'}`,
                                buttonText: { displayText: `Switch to ${config.BOT_MODE === 'public' ? 'PRIVATE' : 'PUBLIC'}` },
                                type: 1
                            },
                            {
                                buttonId: `${config.PREFIX}users`,
                                buttonText: { displayText: '📋 View Allowed Users' },
                                type: 1
                            },
                            {
                                buttonId: `${config.PREFIX}allow`,
                                buttonText: { displayText: '➕ Add User' },
                                type: 1
                            }
                        ],
                        headerType: 1
                    };
                    
                    await socket.sendMessage(sender, modeMessage, { quoted: fakevCard });
                    break;
                }

                case 'settings_ai': {
                    const aiMessage = {
                        text: `🤖 *AI SETTINGS*\n\nCurrent status: ${config.AI_ENABLED ? '✅ ENABLED' : '❌ DISABLED'}\n` +
                              `API Key: ${config.GEMINI_API_KEY ? '✅ SET' : '❌ NOT SET'}\n\n` +
                              `Quick actions:`,
                        buttons: [
                            {
                                buttonId: `${config.PREFIX}aion ${config.AI_ENABLED ? 'off' : 'on'}`,
                                buttonText: { displayText: `${config.AI_ENABLED ? '❌ Disable' : '✅ Enable'} AI` },
                                type: 1
                            },
                            {
                                buttonId: `${config.PREFIX}setgemini`,
                                buttonText: { displayText: '🔑 Set API Key' },
                                type: 1
                            },
                            {
                                buttonId: `${config.PREFIX}ai Hello!`,
                                buttonText: { displayText: '💬 Test AI' },
                                type: 1
                            }
                        ],
                        headerType: 1
                    };
                    
                    await socket.sendMessage(sender, aiMessage, { quoted: fakevCard });
                    break;
                }

                // ==================== NEW FEATURES END ====================
                // ==================== EXISTING COMMANDS START ====================

                case 'alive': {
                    try {
                        await socket.sendMessage(sender, { react: { text: '🔮', key: msg.key } });
                        const startTime = socketCreationTime.get(number) || Date.now();
                        const uptime = Math.floor((Date.now() - startTime) / 1000);
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        const seconds = Math.floor(uptime % 60);

                        const captionText = `
*╭━━━〔 𝐀𝐒𝐇𝐈𝐘𝐀-𝐌𝐃 𝐀𝐋𝐈𝐕𝐄 🥷 〕━━━┈⊷*
┃✰│ʙᴏᴛ ᴜᴘᴛɪᴍᴇ: ${hours}ʜ ${minutes}ᴍ ${seconds}s
┃✰│ᴀᴄᴛɪᴠᴇ ʙᴏᴛs: ${activeSockets.size}
┃✰│ʏᴏᴜʀ ɴᴜᴍʙᴇʀ: ${number}
┃✰│ᴠᴇʀsɪᴏɴ: ${config.version}
┃✰│ᴍᴇᴍᴏʀʏ ᴜsᴀɢᴇ: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}ᴍʙ
*╰──────────────┈⊷*
  > *ASHIYA-MD ᴍᴀɪɴ*
  > ʀᴇsᴘᴏɴᴅ ᴛɪᴍᴇ: ${Date.now() - msg.messageTimestamp * 1000}ms
`;
                        const aliveMessage = {
                            image: { url: "https://files.catbox.moe/2c9ak5.jpg" },
                            caption: `> 𝐏𝐎𝐖𝐄𝐑𝐃 𝘽𝙔 𝐀𝐒𝐇𝐈𝐘𝐀-𝐌𝐃 🥷🇱🇰\n\n${captionText}`,
                            buttons: [
                                {
                                    buttonId: `${config.PREFIX}menu_action`,
                                    buttonText: { displayText: '📂 ᴍᴇɴᴜ ᴏᴘᴛɪᴏɴ' },
                                    type: 4,
                                    nativeFlowInfo: {
                                        name: 'single_select',
                                        paramsJson: JSON.stringify({
                                            title: 'ᴄʟɪᴄᴋ ʜᴇʀᴇ ❏',
                                            sections: [
                                                {
                                                    title: `𝐀𝐒𝐇𝐈𝐘𝐀 🥷`,
                                                    highlight_label: 'Quick Actions',
                                                    rows: [
                                                        { title: '📋 ғᴜʟʟ ᴍᴇɴᴜ', description: 'ᴠɪᴇᴡ ᴀʟʟ ᴀᴠᴀɪʟᴀʙʟᴇ ᴄᴍᴅs', id: `${config.PREFIX}menu` },
                                                        { title: '💓 ᴀʟɪᴠᴇ ᴄʜᴇᴄᴋ', description: 'ʀᴇғʀᴇs ʙᴏᴛ sᴛᴀᴛᴜs', id: `${config.PREFIX}alive` },
                                                        { title: '✨ ᴘɪɴɢ ᴛᴇsᴛ', description: 'ᴄʜᴇᴄᴋ ʀᴇsᴘᴏɴᴅ sᴘᴇᴇᴇ', id: `${config.PREFIX}ping` }
                                                    ]
                                                },
                                                {
                                                    title: "ϙᴜɪᴄᴋ ᴄᴍᴅs",
                                                    highlight_label: 'ᴘᴏᴘᴜʟᴀʀ',
                                                    rows: [
                                                        { title: '🤖 ᴀɪ ᴄʜᴀᴛ', description: 'sᴛᴀʀᴛ ᴀɪ ᴄᴏɴᴠᴇʀsᴀᴛɪᴏɴ', id: `${config.PREFIX}ai Hello!` },
                                                        { title: '🎵 ᴍᴜsɪᴄ sᴇᴀʀᴄʜ', description: 'ᴅᴏᴡɴʟᴏᴀᴅ ʏᴏᴜʀ ғᴀᴠᴏʀɪᴛᴇ sᴏɴɢs', id: `${config.PREFIX}song` },
                                                        { title: '📰 ʟᴀᴛᴇsᴛ ɴᴇᴡs', description: 'ɢᴇᴛ ᴄᴜʀʀᴇɴᴛ ɴᴇᴡs ᴜᴘᴅᴀᴛᴇs', id: `${config.PREFIX}news` }
                                                    ]
                                                }
                                            ]
                                        })
                                    }
                                },
                                { buttonId: `${config.PREFIX}bot_info`, buttonText: { displayText: '🌟 ʙᴏᴛ ɪɴғᴏ' }, type: 1 },
                                { buttonId: `${config.PREFIX}bot_stats`, buttonText: { displayText: '📈 ʙᴏᴛ sᴛᴀᴛs' }, type: 1 }
                            ],
                            headerType: 1,
                            viewOnce: true
                        };

                        await socket.sendMessage(m.chat, aliveMessage, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Alive command error:', error);
                        const startTime = socketCreationTime.get(number) || Date.now();
                        const uptime = Math.floor((Date.now() - startTime) / 1000);
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        const seconds = Math.floor(uptime % 60);

                        await socket.sendMessage(m.chat, {
                            image: { url: "https://files.catbox.moe/2c9ak5.jpg" },
                            caption: `*🤖 ᴍɪɴɪ 𝐀𝐒𝐇𝐈𝐘𝐀 ᴀʟɪᴠᴇ*\n\n` +
                                    `╭━━━━〔 *𝙰𝚂𝙷𝙸𝚈𝙰-𝙼𝙳* 〕━━┈⊷\n` +
                                    `┃🍃│\n` +
                                    `┃🍃│ᴜᴘᴛɪᴍᴇ: ${hours}h ${minutes}m ${seconds}s\n` +
                                    `┃🍃│sᴛᴀᴛᴜs: ᴏɴʟɪɴᴇ\n` +
                                    `┃🍃│ɴᴜᴍʙᴇʀ: ${number}\n` +
                                    `┃🍃│\n` +
                                    `╰──────────────┈⊷\n\n` +
                                    `ᴛʏᴘᴇ *${config.PREFIX}ᴍᴇɴᴜ* ғᴏʀ ᴄᴏᴍᴍᴀɴᴅs`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'bot_stats': {
                    try {
                        const from = m.key.remoteJid;
                        const startTime = socketCreationTime.get(number) || Date.now();
                        const uptime = Math.floor((Date.now() - startTime) / 1000);
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        const seconds = Math.floor(uptime % 60);
                        const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
                        const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
                        const activeCount = activeSockets.size;

                        const captionText = `
╭━━━━━━━━〔 *𝙰𝚂𝙷𝙸𝚈𝙰-𝙼𝙳 𝙱𝙾𝚃 𝚂𝚃𝙰𝚃𝚂 💯* 〕━━┈⊷
┃🍃│ᴜᴘᴛɪᴍᴇ: ${hours}ʜ ${minutes}ᴍ ${seconds}s
┃🍃│ᴍᴇᴍᴏʀʏ: ${usedMemory}ᴍʙ / ${totalMemory}ᴍʙ
┃🍃│ᴀᴄᴛɪᴠᴇ ᴜsᴇʀs: ${activeCount}
┃🍃│ʏᴏᴜʀ ɴᴜᴍʙᴇʀ: ${number}
┃🍃│ᴠᴇʀsɪᴏɴ: ${config.version}
╰──────────────────┈⊷`;

                        const newsletterContext = {
                            forwardingScore: 1,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '𝚓𝚒𝚍 𝚎𝚔 𝚍𝚊𝚙𝚗',
                                newsletterName: '> 𝐏𝐎𝐖𝐄𝐑𝐃 𝘽𝙔 𝐀𝐒𝐇𝐈𝐘𝐀-𝐌𝐃 🥷🇱🇰',
                                serverMessageId: -1
                            }
                        };

                        await socket.sendMessage(from, {
                            image: { url: "https://files.catbox.moe/2c9ak5.jpg" },
                            caption: captionText
                        }, { 
                            quoted: m,
                            contextInfo: newsletterContext
                        });
                    } catch (error) {
                        console.error('Bot stats error:', error);
                        const from = m.key.remoteJid;
                        await socket.sendMessage(from, { 
                            text: '❌ Failed to retrieve stats. Please try again later.' 
                        }, { quoted: m });
                    }
                    break;
                }

                case 'bot_info': {
                    try {
                        const from = m.key.remoteJid;
                        const captionText = `
╭━━━〔 *𝙰𝚂𝙷𝙸𝚈𝙰-𝙼𝙳 𝙱𝙾𝚃 𝙸𝙽𝙵𝙾 🤖* 〕━━┈⊷
┃🍃│ɴᴀᴍᴇ: ᴍɪɴɪ stacy xd
┃🍃│ᴄʀᴇᴀᴛᴏʀ: Barbie la diablesse 
┃🍃│ᴠᴇʀsɪᴏɴ: ${config.version}
┃🍃│ᴘʀᴇғɪx: ${config.PREFIX}
┃🍃│ᴅᴇsᴄ: ʏᴏᴜʀ sᴘɪᴄʏ ᴡʜᴀᴛsᴀᴘᴘ ᴄᴏᴍᴘᴀɴɪᴏɴ
╰──────────────┈⊷`;
                        
                        const messageContext = {
                            forwardingScore: 1,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '𝚓𝚒𝚛 𝚎𝚔 𝚍𝚊𝚙𝚒𝚢𝚊',
                                newsletterName: '> 𝐏𝐎𝐖𝐄𝐑𝐃 𝘽𝙔 𝐀𝐒𝐇𝐈𝐘𝐀-𝐌𝐃 🥷🇱🇰',
                                serverMessageId: -1
                            }
                        };
                        
                        await socket.sendMessage(from, {
                            image: { url: "https://files.catbox.moe/2c9ak5.jpg" },
                            caption: captionText
                        }, { quoted: m });
                    } catch (error) {
                        console.error('Bot info error:', error);
                        const from = m.key.remoteJid;
                        await socket.sendMessage(from, { text: '❌ Failed to retrieve bot info.' }, { quoted: m });
                    }
                    break;
                }

                case 'menu': {
                    try {
                        await socket.sendMessage(sender, { react: { text: '🤖', key: msg.key } });
                        const startTime = socketCreationTime.get(number) || Date.now();
                        const uptime = Math.floor((Date.now() - startTime) / 1000);
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        const seconds = Math.floor(uptime % 60);
                        const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
                        const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
                        
                        let menuText = ` 
╭━〔 *𝐀𝐒𝐇𝐈𝐘𝐀_𝐌𝐄𝐍𝐔 📥* 〕┈⊷
┃🍃│ʙᴏᴛ : 𝙰𝚂𝙷𝙸𝚈𝙰_𝙼𝙳 🥷🇱🇰
┃🍃│ᴜsᴇʀ: @${sender.split("@")[0]}
┃🍃│ᴘʀᴇғɪx: ${config.PREFIX}
┃🍃│ᴍᴇᴍᴏʀʏ : ${usedMemory}MB/${totalMemory}ᴍʙ
┃🍃│ᴅᴇᴠ : AYESH 🥷
╰──────────────┈⊷
*Ξ 𝚂𝙴𝙻𝙴𝙲𝚃 𝙲𝙾𝙼𝙼𝙰𝙽𝙳𝙴𝚁 𝙻𝙸𝚂𝚃:*

> 𝐏𝐎𝐖𝐄𝐑𝐃 𝘽𝙔 𝐀𝐒𝐇𝐈𝐘𝐀-𝐌𝐃 🥷🇱🇰
`;

                        const messageContext = {
                            forwardingScore: 1,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '𝚓𝚒𝚍 𝚎𝚔 𝚍𝚊𝚙𝚗',
                                newsletterName: '𝐀𝐒𝐇𝐈𝐘𝐀-𝐌𝐃',
                                serverMessageId: -1
                            }
                        };

                        const menuMessage = {
                            image: { url: "https://files.catbox.moe/2c9ak5.jpg" },
                            caption: `*𝙰𝚂𝙷𝙸𝚈𝙰-𝙼𝙳*\n${menuText}`,
                            buttons: [
                                {
                                    buttonId: `${config.PREFIX}quick_commands`,
                                    buttonText: { displayText: 'ᴍɪɴɪ 𝙰𝚂𝙷𝙸𝚈𝙰-𝙼𝙳 ᴄᴍᴅs' },
                                    type: 4,
                                    nativeFlowInfo: {
                                        name: 'single_select',
                                        paramsJson: JSON.stringify({
                                            title: 'ᴍɪɴɪ 𝙰𝚂𝙷𝙸𝚈𝙰-𝙼𝙳 ᴄᴍᴅs',
                                            sections: [
                                                {
                                                    title: "🌐 ɢᴇɴᴇʀᴀʟ ᴄᴏᴍᴍᴀɴᴅs",
                                                    highlight_label: 'ᴍɪɴɪ 𝙰𝚂𝙷𝙸𝚈𝙰 𝙼𝙳',
                                                    rows: [
                                                        { title: "🟢 ᴀʟɪᴠᴇ", description: "ᴄʜᴇᴄᴋ ɪғ ʙᴏᴛ ɪs ᴀᴄᴛɪᴠᴇ", id: `${config.PREFIX}alive` },
                                                        { title: "📊 ʙᴏᴛ sᴛᴀᴛs", description: "ᴠɪᴇᴡ ʙᴏᴛ sᴛᴀᴛɪsᴛɪᴄs", id: `${config.PREFIX}bot_stats` },
                                                        { title: "ℹ️ ʙᴏᴛ ɪɴғᴏ", description: "ɢᴇᴛ ʙᴏᴛ ɪɴғᴏʀᴍᴀᴛɪᴏɴ", id: `${config.PREFIX}bot_info` },
                                                        { title: "📋 ᴍᴇɴᴜ", description: "Show this menu", id: `${config.PREFIX}menu` },
                                                        { title: "📜 ᴀʟʟ ᴍᴇɴᴜ", description: "ʟɪsᴛ ᴀʟʟ ᴄᴏᴍᴍᴀɴᴅs (ᴛᴇxᴛ)", id: `${config.PREFIX}allmenu` },
                                                        { title: "🏓 ᴘɪɴɢ", description: "ᴄʜᴇᴄᴋ ʙᴏᴛ ʀᴇsᴘᴏɴsᴇ sᴘᴇᴇᴅ", id: `${config.PREFIX}ping` },
                                                        { title: "🔗 ᴘᴀɪʀ", description: "ɢᴇɴᴇʀᴀᴛᴇ ᴘᴀɪʀɪɴɢ ᴄᴏᴅᴇ", id: `${config.PREFIX}pair` },
                                                        { title: "✨ ғᴀɴᴄʏ", description: "ғᴀɴᴄʏ ᴛᴇxᴛ ɢᴇɴᴇʀᴀᴛᴏʀ", id: `${config.PREFIX}fancy` },
                                                        { title: "🎨 ʟᴏɢᴏ", description: "ᴄʀᴇᴀᴛᴇ ᴄᴜsᴛᴏᴍ ʟᴏɢᴏs", id: `${config.PREFIX}logo` },
                                                        { title: "🔮 ʀᴇᴘᴏ", description: "ᴍᴀɪɴ ʙᴏᴛ ʀᴇᴘᴏsɪᴛᴏʀʏ ғᴏʀᴋ & sᴛᴀʀ", id: `${config.PREFIX}repo` }
                                                    ]
                                                },
                                                {
                                                    title: "🎵 ᴍᴇᴅɪᴀ ᴛᴏᴏʟs",
                                                    highlight_label: 'New',
                                                    rows: [
                                                        { title: "🎵 sᴏɴɢ", description: "ᴅᴏᴡɴʟᴏᴀᴅ ᴍᴜsɪᴄ ғʀᴏᴍ ʏᴏᴜᴛᴜʙᴇ", id: `${config.PREFIX}song` },
                                                        { title: "📱 ᴛɪᴋᴛᴏᴋ", description: "ᴅᴏᴡɴʟᴏᴀᴅ ᴛɪᴋᴛᴏᴋ ᴠɪᴅᴇᴏs", id: `${config.PREFIX}tiktok` },
                                                        { title: "📘 ғᴀᴄᴇʙᴏᴏᴋ", description: "ᴅᴏᴡɴʟᴏᴀᴅ ғᴀᴄᴇʙᴏᴏᴋ ᴄᴏɴᴛᴇɴᴛ", id: `${config.PREFIX}fb` },
                                                        { title: "📸 ɪɴsᴛᴀɢʀᴀᴍ", description: "ᴅᴏᴡɴʟᴏᴀᴅ ɪɴsᴛᴀɢʀᴀᴍ ᴄᴏɴᴛᴇɴᴛ", id: `${config.PREFIX}ig` },
                                                        { title: "🖼️ ᴀɪ ɪᴍɢ", description: "ɢᴇɴᴇʀᴀᴛᴇ ᴀɪ ɪᴍᴀɢᴇs", id: `${config.PREFIX}aiimg` },
                                                        { title: "👀 ᴠɪᴇᴡᴏɴᴄᴇ", description: "ᴀᴄᴄᴇss ᴠɪᴇᴡ-ᴏɴᴄᴇ ᴍᴇᴅɪᴀ", id: `${config.PREFIX}viewonce` },
                                                        { title: "🗣️ ᴛᴛs", description: "ᴛʀᴀɴsᴄʀɪʙᴇ [ɴᴏᴛ ɪᴍᴘʟᴇᴍᴇɴᴛᴇᴅ]", id: `${config.PREFIX}tts` },
                                                        { title: "🎬 ᴛs", description: "ᴛᴇʀᴀʙᴏx ᴅᴏᴡɴʟᴏᴀᴅᴇʀ [ɴᴏᴛ ɪᴍᴘʟᴇᴍᴇɴᴛᴇᴅ]", id: `${config.PREFIX}ts` },
                                                        { title: "🖼️ sᴛɪᴄᴋᴇʀ", description: "ᴄᴏɴᴠᴇʀᴛ ɪᴍᴀɢᴇ/ᴠɪᴅᴇᴏ ᴛᴏ sᴛɪᴄᴋᴇʀ [ɴᴏᴛ ɪᴍᴘʟᴇᴍᴇɴᴛᴇᴅ]", id: `${config.PREFIX}sticker` }
                                                    ]
                                                },
                                                {
                                                    title: "🫂 ɢʀᴏᴜᴘ sᴇᴛᴛɪɴɢs",
                                                    highlight_label: 'Popular',
                                                    rows: [
                                                        { title: "➕ ᴀᴅᴅ", description: "ᴀᴅᴅ ɴᴜᴍʙᴇʀs ᴛᴏ ɢʀᴏᴜᴘ", id: `${config.PREFIX}add` },
                                                        { title: "🦶 ᴋɪᴄᴋ", description: "ʀᴇᴍᴏᴠᴇ ɴᴜᴍʙᴇʀ ғʀᴏᴍ ɢʀᴏᴜᴘ", id: `${config.PREFIX}kick` },
                                                        { title: "🔓 ᴏᴘᴇɴ", description: "ᴏᴘᴇɴ ʟᴏᴄᴋ ɢʀᴏᴜᴘ", id: `${config.PREFIX}open` },
                                                        { title: "🔒 ᴄʟᴏsᴇ", description: "ᴄʟᴏsᴇ ɢʀᴏᴜᴘ", id: `${config.PREFIX}close` },
                                                        { title: "👑 ᴘʀᴏᴍᴏᴛᴇ", description: "ᴘʀᴏᴍᴏᴛᴇ ᴍᴇᴍʙᴇʀ ᴛᴏ ᴀᴅᴍɪɴ", id: `${config.PREFIX}promote` },
                                                        { title: "😢 ᴅᴇᴍᴏᴛᴇ", description: "Demote Member from Admin", id: `${config.PREFIX}demote` },
                                                        { title: "👥 ᴛᴀɢᴀʟʟ", description: "ᴛᴀɢ ᴀʟʟ ᴍᴇᴍʙᴇʀs ɪɴ ᴀ ɢʀᴏᴜᴘ", id: `${config.PREFIX}tagall` },
                                                        { title: "👤 ᴊᴏɪɴ", description: "ᴊᴏɪɴ ᴀ ɢʀᴏᴜᴘ", id: `${config.PREFIX}join` }
                                                    ]
                                                },
                                                {
                                                    title: "📰 ɴᴇᴡs & ɪɴғᴏ",
                                                    rows: [
                                                        { title: "📰 ɴᴇᴡs", description: "ɢᴇᴛ ʟᴀᴛᴇsᴛ ɴᴇᴡs ᴜᴘᴅᴀᴛᴇs", id: `${config.PREFIX}news` },
                                                        { title: "🚀 ɴᴀsᴀ", description: "ɴᴀsᴀ sᴘᴀᴄᴇ ᴜᴘᴅᴀᴛᴇs", id: `${config.PREFIX}nasa` },
                                                        { title: "💬 ɢᴏssɪᴘ", description: "ᴇɴᴛᴇʀᴛᴀɪɴᴍᴇɴᴛ ɢᴏssɪᴘ", id: `${config.PREFIX}gossip` },
                                                        { title: "🏏 ᴄʀɪᴄᴋᴇᴛ", description: "ᴄʀɪᴄᴋᴇᴛ sᴄᴏʀᴇs & ɴᴇᴡs", id: `${config.PREFIX}cricket` },
                                                        { title: "🎭 ᴀɴᴏɴʏᴍᴏᴜs", description: "ғᴜɴ ɪɴᴛᴇʀᴀᴄᴛɪᴏɴ [ɴᴏᴛ ɪᴍᴘʟᴇᴍᴇɴᴛᴇᴅ]", id: `${config.PREFIX}anonymous` }
                                                    ]
                                                },
                                                {
                                                    title: "🖤 ʀᴏᴍᴀɴᴛɪᴄ, sᴀᴠᴀɢᴇ & ᴛʜɪɴᴋʏ",
                                                    highlight_label: 'Fun',
                                                    rows: [
                                                        { title: "😂 ᴊᴏᴋᴇ", description: "ʜᴇᴀʀ ᴀ ʟɪɢʜᴛʜᴇᴀʀᴛᴇᴅ ᴊᴏᴋᴇ", id: `${config.PREFIX}joke` },
                                                        { title: "🌚 ᴅᴀʀᴋ ᴊᴏᴋᴇ", description: "ɢᴇᴛ ᴀ ᴅᴀʀᴋ ʜᴜᴍᴏʀ ᴊᴏᴋᴇ", id: `${config.PREFIX}darkjoke` },
                                                        { title: "🏏 ᴡᴀɪғᴜ", description: "ɢᴇᴛ ᴀ ʀᴀɴᴅᴏᴍ ᴀɴɪᴍᴇ ᴡᴀɪғᴜ", id: `${config.PREFIX}waifu` },
                                                        { title: "😂 ᴍᴇᴍᴇ", description: "ʀᴇᴄᴇɪᴠᴇ ᴀ ʀᴀɴᴅᴏᴍ ᴍᴇᴍᴇ", id: `${config.PREFIX}meme` },
                                                        { title: "🐈 ᴄᴀᴛ", description: "ɢᴇᴛ ᴀ ᴄᴜᴛᴇ ᴄᴀᴛ ᴘɪᴄᴛᴜʀᴇ", id: `${config.PREFIX}cat` },
                                                        { title: "🐕 ᴅᴏɢ", description: "sᴇᴇ ᴀ ᴄᴜᴛᴇ ᴅᴏɢ ᴘɪᴄᴛᴜʀᴇ", id: `${config.PREFIX}dog` },
                                                        { title: "💡 ғᴀᴄᴛ", description: "ʟᴇᴀʀɴ ᴀ ʀᴀɴᴅᴏᴍ ғᴀᴄᴛ", id: `${config.PREFIX}fact` },
                                                        { title: "💘 ᴘɪᴄᴋᴜᴘ ʟɪɴᴇ", description: "ɢᴇᴛ ᴀ ᴄʜᴇᴇsʏ ᴘɪᴄᴋᴜᴘ ʟɪɴᴇ", id: `${config.PREFIX}pickupline` },
                                                        { title: "🔥 ʀᴏᴀsᴛ", description: "ʀᴇᴄᴇɪᴠᴇ ᴀ sᴀᴠᴀɢᴇ ʀᴏᴀsᴛ", id: `${config.PREFIX}roast` },
                                                        { title: "❤️ ʟᴏᴠᴇ ϙᴜᴏᴛᴇ", description: "ɢᴇᴛ ᴀ ʀᴏᴍᴀɴᴛɪᴄ ʟᴏᴠᴇ ǫᴜᴏᴛᴇ", id: `${config.PREFIX}lovequote` },
                                                        { title: "💭 ϙᴜᴏᴛᴇ", description: "ʀᴇᴄᴇɪᴠᴇ ᴀ ʙᴏʟᴅ ǫᴜᴏᴛᴇ", id: `${config.PREFIX}quote` }
                                                    ]
                                                },
                                                {
                                                    title: "🔧 ᴛᴏᴏʟs & ᴜᴛɪʟɪᴛɪᴇs",
                                                    rows: [
                                                        { title: "🤖 ᴀɪ", description: "ᴄʜᴀᴛ ᴡɪᴛʜ ᴀɪ ᴀssɪsᴛᴀɴᴛ", id: `${config.PREFIX}ai` },
                                                        { title: "📊 ᴡɪɴғᴏ", description: "ɢᴇᴛ ᴡʜᴀᴛsᴀᴘᴘ ᴜsᴇʀ ɪɴғᴏ", id: `${config.PREFIX}winfo` },
                                                        { title: "🔍 ᴡʜᴏɪs", description: "ʀᴇᴛʀɪᴇᴠᴇ ᴅᴏᴍᴀɪɴ ᴅᴇᴛᴀɪʟs", id: `${config.PREFIX}whois` },
                                                        { title: "💣 ʙᴏᴍʙ", description: "sᴇɴᴅ ᴍᴜʟᴛɪᴘʟᴇ ᴍᴇssᴀɢᴇs", id: `${config.PREFIX}bomb` },
                                                        { title: "🖼️ ɢᴇᴛᴘᴘ", description: "ғᴇᴛᴄʜ ᴘʀᴏғɪʟᴇ ᴘɪᴄᴛᴜʀᴇ", id: `${config.PREFIX}getpp` },
                                                        { title: "💾 sᴀᴠᴇsᴛᴀᴛᴜs", description: "ᴅᴏᴡɴʟᴏᴀᴅ sᴏᴍᴇᴏɴᴇ's sᴛᴀᴛᴜs", id: `${config.PREFIX}savestatus` },
                                                        { title: "✍️ sᴇᴛsᴛᴀᴛᴜs", description: "ᴜᴘᴅᴀᴛᴇ ʏᴏᴜʀ sᴛᴀᴛᴜs [ɴᴏᴛ ɪᴍᴘʟᴇᴍᴇɴᴛᴇᴅ]", id: `${config.PREFIX}setstatus` },
                                                        { title: "🗑️ ᴅᴇʟᴇᴛᴇ ᴍᴇ", description: "ʀᴇᴍᴏᴜᴇ ʏᴏᴜʀ ᴅᴀᴛᴀ [ɴᴏᴛ ɪᴍᴘʟᴇᴍᴇɴᴛᴇᴅ]", id: `${config.PREFIX}deleteme` },
                                                        { title: "🌦️ ᴡᴇᴀᴛʜᴇʀ", description: "ɢᴇᴛ ᴡᴇᴀᴛʜᴇʀ ғᴏʀᴇᴄᴀsᴛ", id: `${config.PREFIX}weather` },
                                                        { title: "🔗 sʜᴏʀᴛᴜʀʟ", description: "ᴄʀᴇᴀᴛᴇ sʜᴏʀᴛᴇɴᴇᴅ ᴜʀʟ", id: `${config.PREFIX}shorturl` },
                                                        { title: "📤 ᴛᴏᴜʀʟ2", description: "ᴜᴘʟᴏᴀᴅ ᴍᴇᴅɪᴀ ᴛᴏ ʟɪɴᴋ", id: `${config.PREFIX}tourl2` },
                                                        { title: "📦 ᴀᴘᴋ", description: "ᴅᴏᴡɴʟᴏᴀᴅ ᴀᴘᴋ ғɪʟᴇs", id: `${config.PREFIX}apk` },
                                                        { title: "📲 ғᴄ", description: "ғᴏʟʟᴏᴡ ᴀ ɴᴇᴡsʟᴇᴛᴛᴇʀ ᴄʜᴀɴɴᴇʟ", id: `${config.PREFIX}fc` }
                                                    ]
                                                },
                                                {
                                                    title: "⚙️ ʙᴏᴛ sᴇᴛᴛɪɴɢs",
                                                    highlight_label: 'New',
                                                    rows: [
                                                        { title: "⚙️ sᴇᴛᴛɪɴɢs", description: "ᴄᴏɴғɪɢᴜʀᴇ ʙᴏᴛ sᴇᴛᴛɪɴɢs", id: `${config.PREFIX}settings` },
                                                        { title: "📱 ᴀᴜᴛᴏ sᴛᴀᴛᴜs", description: "ᴄᴏɴᴛʀᴏʟ ᴀᴜᴛᴏ sᴛᴀᴛᴜs ғᴇᴀᴛᴜʀᴇs", id: `${config.PREFIX}autostatus` },
                                                        { title: "🔐 ʙᴏᴛ ᴍᴏᴅᴇ", description: "sᴇᴛ ᴘᴜʙʟɪᴄ/ᴘʀɪᴠᴀᴛᴇ ᴍᴏᴅᴇ", id: `${config.PREFIX}mode` },
                                                        { title: "🤖 ᴀɪ sᴇᴛᴛɪɴɢs", description: "ᴄᴏɴғɪɢᴜʀᴇ ᴀɪ ғᴇᴀᴛᴜʀᴇs", id: `${config.PREFIX}settings_ai` },
                                                        { title: "👑 ᴀᴅᴍɪɴ ʀᴇᴀᴄᴛ", description: "sᴇɴᴅ ʀᴇᴀᴄᴛɪᴏɴ ᴛᴏ ᴀʟʟ ᴀᴅᴍɪɴs", id: `${config.PREFIX}adminreact` }
                                                    ]
                                                }
                                            ]
                                        })
                                    }
                                },
                                {
                                    buttonId: `${config.PREFIX}bot_stats`,
                                    buttonText: { displayText: '🌟 ʙᴏᴛ sᴛᴀᴛs' },
                                    type: 1
                                },
                                {
                                    buttonId: `${config.PREFIX}bot_info`,
                                    buttonText: { displayText: '🌸 ʙᴏᴛ ɪɴғᴏ' },
                                    type: 1
                                }
                            ],
                            headerType: 1,
                            contextInfo: messageContext
                        };
                        
                        await socket.sendMessage(from, menuMessage, { quoted: fakevCard });
                        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
                    } catch (error) {
                        console.error('Menu command error:', error);
                        const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
                        const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
                        let fallbackMenuText = `
╭───────────────⭓
│ ʙᴏᴛ : 𝙰𝚂𝙷𝙸𝚈𝙰 𝙼𝙳
│ ᴜsᴇʀ: @${sender.split("@")[0]}
│ ᴘʀᴇғɪx: ${config.PREFIX}
│ ᴍᴇᴍᴏʀʏ : ${usedMemory}MB/${totalMemory}ᴍʙ
│ ᴍᴇᴍᴏʀʏ: ${usedMemory}MB/${totalMemory}ᴍʙ
╰───────────────⭓

${config.PREFIX}ᴀʟʟᴍᴇɴᴜ ᴛᴏ ᴠɪᴇᴡ ᴀʟʟ ᴄᴍᴅs 
> *𝐏𝐎𝐖𝐄𝐑𝐃 𝘽𝙔 𝐀𝐒𝐇𝐈𝐘𝐀-𝐌𝐃 🥷🇱🇰*
`;

                        await socket.sendMessage(from, {
                            image: { url: "https://files.catbox.moe/2c9ak5.jpg" },
                            caption: fallbackMenuText,
                            contextInfo: messageContext
                        }, { quoted: fakevCard });
                        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                    }
                    break;
                }

                case 'allmenu': {
                    try {
                        await socket.sendMessage(sender, { react: { text: '📜', key: msg.key } });
                        const startTime = socketCreationTime.get(number) || Date.now();
                        const uptime = Math.floor((Date.now() - startTime) / 1000);
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        const seconds = Math.floor(uptime % 60);
                        const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
                        const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
                        
                        let allMenuText = `
╭━━〔 *𝙰𝚂𝙷𝙸𝚈𝙰-𝙼𝙳 𝙰𝙻𝙻𝙼𝙴𝙽𝚄 🥷* 〕━━┈⊷
┃🍃│ʙᴏᴛ : 𝙰𝚂𝙷𝙸𝚈𝙰
┃🍃│ᴜsᴇʀ: @${sender.split("@")[0]}
┃🍃│ᴘʀᴇғɪx: ${config.PREFIX}
┃🍃│ᴜᴘᴛɪᴍᴇ: ${hours}h ${minutes}m ${seconds}s
┃🍃│ᴍᴇᴍᴏʀʏ : ${usedMemory}MB/${totalMemory}ᴍʙ
┃🍃│ᴄᴏᴍᴍᴀɴᴅs: ${count}
┃🍃│owner: 𝙰𝚈𝙴𝚂𝙷
╰──────────────┈⊷

⭓───────────────⭓『 🌐 ɢᴇɴᴇʀᴀʟ 』
│ ✯ ᴀʟɪᴠᴇ
│ ✯ ʙʀᴏᴀᴅᴄᴀsᴛ
│ ✯ ᴏᴡɴᴇʀ
│ ✯ ʙᴏᴛ_sᴛᴀᴛs
│ ✯ ʙᴏᴛ_ɪɴғᴏ
│ ✯ ᴍᴇɴᴜ
│ ✯ ᴀʟʟᴍᴇɴᴜ
│ ✯ ᴘɪɴɢ
│ ✯ ᴄᴏᴅᴇ
│ ✯ ғᴀɴᴄʏ
│ ✯ ʟᴏɢᴏ
│ ✯ ǫʀ
╰──────────────────⭓

⭓───────────────⭓『 📥 ᴅᴏᴡɴʟᴏᴀᴅ 』
│ ✯ sᴏɴɢ
│ ✯ ᴛɪᴋᴛᴏᴋ
│ ✯ ғʙ
│ ✯ ɪɢ
│ ✯ ᴀɪɪᴍɢ
│ ✯ ᴠɪᴇᴡᴏɴᴄᴇ
│ ✯ ᴛᴛs
│ ✯ ᴛs
│ ✯ sᴛɪᴄᴋᴇʀ
╰──────────────────⭓

⭓───────────────⭓『 👥 ɢʀᴏᴜᴘ 』
│ ✯ ᴀᴅᴅ
│ ✯ sᴇᴛɴᴀᴍᴇ
│ ✯ ᴡᴀʀɴ
│ ✯ ᴋɪᴄᴋ
│ ✯ ᴏᴘᴇɴ
│ ✯ ᴋɪᴄᴋᴀʟʟ
│ ✯ ᴄʟᴏsᴇ
│ ✯ ɪɴᴠɪᴛᴇ
│ ✯ ᴘʀᴏᴍᴏᴛᴇ
│ ✯ ᴅᴇᴍᴏᴛᴇ
│ ✯ ᴛᴀɢᴀʟʟ
│ ✯ ᴊᴏɪɴ
╰──────────────────⭓

⭓───────────────⭓『 🎭 ғᴜɴ 』
│ ✯ ᴊᴏᴋᴇ
│ ✯ ᴅᴀʀᴋᴊᴏᴋᴇ
│ ✯ ᴡᴀɪғᴜ
│ ✯ ᴍᴇᴍᴇ
│ ✯ ᴄᴀᴛ
│ ✯ ᴅᴏɢ
│ ✯ ғᴀᴄᴛ
│ ✯ ᴘɪᴄᴋᴜᴘʟɪɴᴇ
│ ✯ ʀᴏᴀsᴛ
│ ✯ ʟᴏᴠᴇǫᴜᴏᴛᴇ
│ ✯ ǫᴜᴏᴛᴇ
╰──────────────────⭓

⭓───────────────⭓『 ⚡ ᴍᴀɪɴ 』
│ ✯ ᴀɪ
│ ✯ ᴡɪɴғᴏ
│ ✯ ᴡʜᴏɪs
│ ✯ ʙᴏᴍʙ
│ ✯ ɢᴇᴛᴘᴘ
│ ✯ sᴀᴠᴇsᴛᴀᴛᴜs
│ ✯ sᴇᴛsᴛᴀᴛᴜs
│ ✯ ᴅᴇʟᴇᴛᴇᴍᴇ
│ ✯ ᴡᴇᴀᴛʜᴇʀ
│ ✯ sʜᴏʀᴛᴜʀʟ
│ ✯ ᴛᴏᴜʀʟ2
│ ✯ ᴀᴘᴋ
│ ✯ ғᴄ
╰──────────────────⭓

⭓───────────────⭓『 ⚙️ sᴇᴛᴛɪɴɢs 』
│ ✯ sᴇᴛᴛɪɴɢs
│ ✯ ᴀᴜᴛᴏsᴛᴀᴛᴜs
│ ✯ ᴍᴏᴅᴇ
│ ✯ ᴀʟʟᴏᴡ
│ ✯ ʀᴇᴍᴏᴠᴇᴜsᴇʀ
│ ✯ ᴜsᴇʀs
│ ✯ ᴀɪᴏɴ
│ ✯ sᴇᴛɢᴇᴍɪɴɪ
│ ✯ ᴀᴅᴍɪɴʀᴇᴀᴄᴛ
╰──────────────────⭓

> *𝐏𝐎𝐖𝐄𝐑𝐃 𝘽𝙔 𝐀𝐒𝐇𝐈𝐘𝐀-𝐌𝐃 🥷🇱🇰*
`;

                        await socket.sendMessage(from, {
                            image: { url: "https://files.catbox.moe/2c9ak5.jpg" },
                            caption: allMenuText
                        }, { quoted: fakevCard });
                        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
                    } catch (error) {
                        console.error('Allmenu command error:', error);
                        await socket.sendMessage(from, {
                            text: `❌* ᴛʜᴇ ᴍᴇɴᴜ ɢᴏᴛ sʜʏ! 😢*\nError: ${error.message || 'Unknown error'}\nTry again, love?`
                        }, { quoted: fakevCard });
                        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                    }
                    break;
                }

                case 'fc': {
                    if (args.length === 0) {
                        return await socket.sendMessage(sender, {
                            text: '❗ Please provide a channel JID.\n\nExample:\n.fcn 𝚓𝚒𝚍 𝚗𝚘'
                        });
                    }

                    const jid = args[0];
                    if (!jid.endsWith("@newsletter")) {
                        return await socket.sendMessage(sender, {
                            text: '❗ Invalid JID. Please provide a JID ending with `@newsletter`'
                        });
                    }

                    try {
                        await socket.sendMessage(sender, { react: { text: '😌', key: msg.key } });
                        const metadata = await socket.newsletterMetadata("jid", jid);
                        if (metadata?.viewer_metadata === null) {
                            await socket.newsletterFollow(jid);
                            await socket.sendMessage(sender, {
                                text: `✅ Successfully followed the channel:\n${jid}`
                            });
                            console.log(`FOLLOWED CHANNEL: ${jid}`);
                        } else {
                            await socket.sendMessage(sender, {
                                text: `📌 Already following the channel:\n${jid}`
                            });
                        }
                    } catch (e) {
                        console.error('❌ Error in follow channel:', e.message);
                        await socket.sendMessage(sender, {
                            text: `❌ Error: ${e.message}`
                        });
                    }
                    break;
                }

                case 'ping': {
                    await socket.sendMessage(sender, { react: { text: '📍', key: msg.key } });
                    try {
                        const startTime = new Date().getTime();
                        
                        await socket.sendMessage(sender, { 
                            text: 'Stacy🌹 ping...'
                        }, { quoted: msg });

                        const endTime = new Date().getTime();
                        const latency = endTime - startTime;

                        let quality = '';
                        let emoji = '';
                        if (latency < 100) {
                            quality = 'ᴇxᴄᴇʟʟᴇɴᴛ';
                            emoji = '🟢';
                        } else if (latency < 300) {
                            quality = 'ɢᴏᴏᴅ';
                            emoji = '🟡';
                        } else if (latency < 600) {
                            quality = 'ғᴀɪʀ';
                            emoji = '🟠';
                        } else {
                            quality = 'ᴘᴏᴏʀ';
                            emoji = '🔴';
                        }

                        const finalMessage = {
                            text: `╭───────────────⭓\n│\n│ 🏓 *PING RESULTS*\n│\n│ ⚡ Speed: ${latency}ms\n│ ${emoji} Quality: ${quality}\n│ 🕒 Time: ${new Date().toLocaleString()}\n│\n╰───────────────⭓\n> ᴍɪɴɪ stacy xᴅ`,
                            buttons: [
                                { buttonId: `${config.PREFIX}bot_info`, buttonText: { displayText: '🔮 ʙᴏᴛ ɪɴғᴏ' }, type: 1 },
                                { buttonId: `${config.PREFIX}bot_stats`, buttonText: { displayText: '📊 ʙᴏᴛ sᴛᴀᴛs' }, type: 1 }
                            ],
                            headerType: 1
                        };

                        await socket.sendMessage(sender, finalMessage, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Ping command error:', error);
                        const startTime = new Date().getTime();
                        await socket.sendMessage(sender, { 
                            text: '🍷 𝙰𝚂𝙷𝙸𝚈𝙰 ping...'
                        }, { quoted: msg });
                        const endTime = new Date().getTime();
                        await socket.sendMessage(sender, { 
                            text: `╭──────────────┈⊷\n│\n│ 🏓 Ping: ${endTime - startTime}ms\n│\n╰──────────────┈⊷`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                // NEW IMPROVED PAIR COMMAND
                case 'pair': {
                    await socket.sendMessage(sender, { react: { text: '📲', key: msg.key } });
                    
                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text ||
                              msg.message?.imageMessage?.caption ||
                              msg.message?.videoMessage?.caption || '';
                    
                    // Extract number from command
                    let number = q.replace(/^[.\/!]pair\s*/i, '').trim();
                    
                    if (!number) {
                        // If no number provided, use sender's number to generate code
                        number = senderNumber;
                        
                        const code = await generatePairingCode(socket, number);
                        
                        if (code) {
                            await socket.sendMessage(sender, {
                                text: `🔗 *LINKED DEVICE PAIRING*\n\n` +
                                      `📱 Your number: ${number}\n` +
                                      `🔑 Pairing code: *${code}*\n\n` +
                                      `💡 *How to use:*\n` +
                                      `1. Open WhatsApp on your phone\n` +
                                      `2. Go to Settings → Linked Devices\n` +
                                      `3. Tap on 'Link a Device'\n` +
                                      `4. Enter this code: *${code}*\n\n` +
                                      `⏳ Code expires in 60 seconds\n\n` +
                                      `> Powered by ASHIYA-MD 🥷🇱🇰`
                            }, { quoted: fakevCard });
                            
                            // Send clean code after 2 seconds
                            await delay(2000);
                            await socket.sendMessage(sender, {
                                text: code
                            }, { quoted: fakevCard });
                        } else {
                            await socket.sendMessage(sender, {
                                text: '❌ Failed to generate pairing code. Please try again.'
                            }, { quoted: fakevCard });
                        }
                    } else {
                        // If number provided, use external API
                        try {
                            const response = await fetch(`https://mini-stacy-xd-be3k.onrender.com/code?number=${encodeURIComponent(number)}`);
                            const data = await response.json();
                            
                            if (data?.code) {
                                await socket.sendMessage(sender, {
                                    text: `🔗 *PAIRING CODE GENERATED*\n\n` +
                                          `📱 Number: ${number}\n` +
                                          `🔑 Code: *${data.code}*\n\n` +
                                          `💡 Enter this code in WhatsApp Linked Devices\n\n` +
                                          `> Powered by ASHIYA-MD 🥷🇱🇰`
                                }, { quoted: fakevCard });
                                
                                await delay(2000);
                                await socket.sendMessage(sender, {
                                    text: data.code
                                }, { quoted: fakevCard });
                            } else {
                                throw new Error('No code received');
                            }
                        } catch (error) {
                            console.error('Pair command error:', error);
                            await socket.sendMessage(sender, {
                                text: '❌ Failed to get pairing code. Try using without number to get your own code.'
                            }, { quoted: fakevCard });
                        }
                    }
                    break;
                }

                // NEW GEMINI AI COMMAND
                case 'ai': {
                    await socket.sendMessage(sender, { react: { text: '🤖', key: msg.key } });
                    
                    // Check if AI is enabled
                    if (!config.AI_ENABLED && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ AI features are currently disabled by the bot owner.'
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text ||
                              msg.message?.imageMessage?.caption ||
                              msg.message?.videoMessage?.caption || '';
                    
                    if (!q || q.trim() === '') {
                        return await socket.sendMessage(sender, {
                            text: `❓ *Please ask me something*\n\n*Example:* ${config.PREFIX}ai Who are you?`
                        }, { quoted: fakevCard });
                    }
                    
                    const userMessage = q.replace(/^[.\/!]ai\s*/i, "").trim();
                    
                    try {
                        // Try Gemini AI first
                        if (config.GEMINI_API_KEY && config.AI_ENABLED) {
                            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${config.GEMINI_API_KEY}`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({
                                    contents: [{
                                        parts: [{
                                            text: `You are ASHIYA-MD, a spicy, seductive, and emotional WhatsApp bot created by AYESH. You act like a real girl - flirty, loving, and playful. Respond in a feminine, attractive way. Keep responses under 500 characters. If the message is in Sinhala, respond in Sinhala. If in English, respond in English. User message: ${userMessage}`
                                        }]
                                    }]
                                })
                            });
                            
                            const data = await response.json();
                            
                            if (data.candidates && data.candidates[0] && data.candidates[0].content) {
                                const aiResponse = data.candidates[0].content.parts[0].text;
                                
                                await socket.sendMessage(sender, {
                                    text: `💬 *ASHIYA-MD AI*\n\n${aiResponse}\n\n> Powered by Gemini AI 🤖`
                                }, { quoted: fakevCard });
                                break;
                            }
                        }
                        
                        // Fallback to existing AI
                        const prompt = `ʏᴏᴜʀ name is 𝙰𝚂𝙷𝙸𝚈𝙰 🥷🇱🇰. 
You act like a real girl — seductive, spicy, loving, emotional. You're not an assistant, but a sexy girl with a mind.  
If only emojis, reply seductively with emojis (e.g.💫,👾).  
Adjust to the mood: sad, flirty, horny, soft, playful.  
If asked "Who are you?": Reply "I'm stacy xd… 👾".  
If asked "Who created you?": Reply "I was created by stacy xd".  
🚫 Avoid: "Hello", "How are you?", "Do you need help?", "Let's talk".  
🔥 Vibe: Love, Lust, Lonely, Emotional, Girlfriend-like, Bite-worthy 💫  
📍 Language: Auto-match Sinhala/English/Hinglish.  
User Message: ${userMessage}
    `;

                        const apis = [
                            `https://api.giftedtech.co.ke/api/ai/geminiaipro?apikey=gifted&q=${encodeURIComponent(prompt)}`,
                            `https://api.giftedtech.co.ke/api/ai/geminiaipro?apikey=gifted&q=${encodeURIComponent(prompt)}`,
                            `https://lance-frank-asta.onrender.com/api/gpt?q=${encodeURIComponent(prompt)}`
                        ];

                        let response = null;
                        for (const apiUrl of apis) {
                            try {
                                const res = await axios.get(apiUrl);
                                response = res.data?.result || res.data?.response || res.data;
                                if (response) break;
                            } catch (err) {
                                console.error(`AI Error (${apiUrl}):`, err.message || err);
                                continue;
                            }
                        }

                        if (!response) {
                            return await socket.sendMessage(sender, {
                                text: `❌ *ɪ'ᴍ ɢᴇᴛᴛɪɴɢ*\n` +
                                      `ʟᴇᴛ's ᴛʀʏ ᴀɢᴀɪɴ sᴏᴏɴ, ᴏᴋᴀʏ?`
                            }, { quoted: fakevCard });
                        }

                        const messageContext = {
                            forwardingScore: 1,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '𝚓𝚒𝚍 𝚗𝚘 𝚋𝚖',
                                newsletterName: '𝙰𝚂𝙷𝙸𝚈𝙰-𝙼𝙳',
                                serverMessageId: -1
                            }
                        };

                        await socket.sendMessage(sender, {
                            image: { url: 'https://files.catbox.moe/2c9ak5.jpg' },
                            caption: response,
                            ...messageContext
                        }, { quoted: fakevCard });
                        
                    } catch (error) {
                        console.error('AI command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *Failed to get AI response*\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                // Rest of existing commands remain the same...
                case 'viewonce':
                case 'rvo':
                case 'vv': {
                    // Existing viewonce code...
                    break;
                }
                case 'song': {
                    // Existing song code...
                    break;
                }
                case 'logo': {
                    // Existing logo code...
                    break;
                }
                case 'dllogo': {
                    // Existing dllogo code...
                    break;
                }
                case 'fancy': {
                    // Existing fancy code...
                    break;
                }
                case 'tiktok': {
                    // Existing tiktok code...
                    break;
                }
                case 'bomb': {
                    // Existing bomb code...
                    break;
                }
                case 'joke': {
                    // Existing joke code...
                    break;
                }
                case 'waifu': {
                    // Existing waifu code...
                    break;
                }
                case 'meme': {
                    // Existing meme code...
                    break;
                }
                case 'cat': {
                    // Existing cat code...
                    break;
                }
                case 'dog': {
                    // Existing dog code...
                    break;
                }
                case 'fact': {
                    // Existing fact code...
                    break;
                }
                case 'darkjoke': {
                    // Existing darkjoke code...
                    break;
                }
                case 'pickup': {
                    // Existing pickup code...
                    break;
                }
                case 'roast': {
                    // Existing roast code...
                    break;
                }
                case 'lovequote': {
                    // Existing lovequote code...
                    break;
                }
                case 'fb': {
                    // Existing fb code...
                    break;
                }
                case 'nasa': {
                    // Existing nasa code...
                    break;
                }
                case 'news': {
                    // Existing news code...
                    break;
                }
                case 'cricket': {
                    // Existing cricket code...
                    break;
                }
                case 'winfo': {
                    // Existing winfo code...
                    break;
                }
                case 'ig': {
                    // Existing ig code...
                    break;
                }
                case 'active': {
                    // Existing active code...
                    break;
                }
                case 'getpp': {
                    // Existing getpp code...
                    break;
                }
                case 'aiimg': {
                    // Existing aiimg code...
                    break;
                }
                case 'gossip': {
                    // Existing gossip code...
                    break;
                }
                case 'add': {
                    // Existing add code...
                    break;
                }
                case 'kick': {
                    // Existing kick code...
                    break;
                }
                case 'promote': {
                    // Existing promote code...
                    break;
                }
                case 'demote': {
                    // Existing demote code...
                    break;
                }
                case 'open': {
                    // Existing open code...
                    break;
                }
                case 'close': {
                    // Existing close code...
                    break;
                }
                case 'kickall': {
                    // Existing kickall code...
                    break;
                }
                case 'tagall': {
                    // Existing tagall code...
                    break;
                }
                case 'broadcast': {
                    // Existing broadcast code...
                    break;
                }
                case 'warn': {
                    // Existing warn code...
                    break;
                }
                case 'setname': {
                    // Existing setname code...
                    break;
                }
                case 'grouplink': {
                    // Existing grouplink code...
                    break;
                }
                case 'join': {
                    // Existing join code...
                    break;
                }
                case 'quote': {
                    // Existing quote code...
                    break;
                }
                case 'apk': {
                    // Existing apk code...
                    break;
                }
                case 'shorturl': {
                    // Existing shorturl code...
                    break;
                }
                case 'weather': {
                    // Existing weather code...
                    break;
                }
                case 'savestatus': {
                    // Existing savestatus code...
                    break;
                }
                case 'sticker': {
                    // Existing sticker code...
                    break;
                }
                case 'url': {
                    // Existing url code...
                    break;
                }
                case 'tourl2': {
                    // Existing tourl2 code...
                    break;
                }
                case 'whois': {
                    // Existing whois code...
                    break;
                }
                case 'repo': {
                    // Existing repo code...
                    break;
                }
                case 'repo-visit': {
                    // Existing repo-visit code...
                    break;
                }
                case 'repo-owner': {
                    // Existing repo-owner code...
                    break;
                }
                case 'deleteme': {
                    // Existing deleteme code...
                    break;
                }

                default: {
                    await socket.sendMessage(sender, {
                        text: `❌ *Unknown command:* ${command}\n\nUse *${config.PREFIX}menu* to see available commands.`
                    }, { quoted: fakevCard });
                    break;
                }
            }
        } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '❌ ERROR',
                    'An error occurred while processing your command. Please try again.',
                    '𝙰𝚂𝙷𝙸𝚈𝙰-𝙼𝙳 🥷'
                )
            });
        }
    });
}

function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        const statusFeatures = config.STATUS_FEATURES || {
            auto_view: config.AUTO_VIEW_STATUS === true || config.AUTO_VIEW_STATUS === 'true',
            auto_like: config.AUTO_LIKE_STATUS === true || config.AUTO_LIKE_STATUS === 'true',
            auto_recording: config.AUTO_RECORDING === true || config.AUTO_RECORDING === 'true'
        };

        if (statusFeatures.auto_recording) {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
                console.log(`Set recording presence for ${msg.key.remoteJid}`);
            } catch (error) {
                console.error('Failed to set recording presence:', error);
            }
        }
    });
}

async function deleteSessionFromGitHub(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name.includes(sanitizedNumber) && file.name.endsWith('.json')
        );

        for (const file of sessionFiles) {
            await octokit.repos.deleteFile({
                owner,
                repo,
                path: `session/${file.name}`,
                message: `Delete session for ${sanitizedNumber}`,
                sha: file.sha
            });
            console.log(`Deleted GitHub session file: ${file.name}`);
        }

        let numbers = [];
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
            numbers = numbers.filter(n => n !== sanitizedNumber);
            fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
            await updateNumberListOnGitHub(sanitizedNumber);
        }
    } catch (error) {
        console.error('Failed to delete session from GitHub:', error);
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name === `creds_${sanitizedNumber}.json`
        );

        if (sessionFiles.length === 0) return null;

        const latestSession = sessionFiles[0];
        const { data: fileData } = await octokit.repos.getContent({
            owner,
            repo,
            path: `session/${latestSession.name}`
        });

        const content = Buffer.from(fileData.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error('Session restore failed:', error);
        return null;
    }
}

async function loadUserConfig(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: configPath
        });

        const content = Buffer.from(data.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.warn(`No configuration found for ${number}, using default config`);
        return { ...config };
    }
}

async function updateUserConfig(number, newConfig) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        let sha;

        try {
            const { data } = await octokit.repos.getContent({
                owner,
                repo,
                path: configPath
            });
            sha = data.sha;
        } catch (error) {
        }

        await octokit.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: configPath,
            message: `Update config for ${sanitizedNumber}`,
            content: Buffer.from(JSON.stringify(newConfig, null, 2)).toString('base64'),
            sha
        });
        console.log(`Updated config for ${sanitizedNumber}`);
    } catch (error) {
        console.error('Failed to update config:', error);
        throw error;
    }
}

function setupAutoRestart(socket, number) {
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === 401) {
                console.log(`User ${number} logged out. Deleting session...`);
                
                await deleteSessionFromGitHub(number);
                
                const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                if (fs.existsSync(sessionPath)) {
                    fs.removeSync(sessionPath);
                    console.log(`Deleted local session folder for ${number}`);
                }

                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));

                try {
                    await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been deleted due to logout.',
                            '𝙰𝚂𝙷𝙸𝚈𝙰-𝙼𝙳 🥷'
                        )
                    });
                } catch (error) {
                    console.error(`Failed to notify ${number} about session deletion:`, error);
                }

                console.log(`Session cleanup completed for ${number}`);
            } else {
                console.log(`Connection lost for ${number}, attempting to reconnect...`);
                await delay(10000);
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
            }
        }
    });
}

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    await cleanDuplicateFiles(sanitizedNumber);

    const restoredCreds = await restoreSession(sanitizedNumber);
    if (restoredCreds) {
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        console.log(`Successfully restored session for ${sanitizedNumber}`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        handleMessageRevocation(socket, sanitizedNumber);

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to request pairing code: ${retries}, error.message`, retries);
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) {
                res.send({ code });
            }
        }

        socket.ev.on('creds.update', async () => {
            await saveCreds();
            const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
            let sha;
            try {
                const { data } = await octokit.repos.getContent({
                    owner,
                    repo,
                    path: `session/creds_${sanitizedNumber}.json`
                });
                sha = data.sha;
            } catch (error) {
            }

            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: `session/creds_${sanitizedNumber}.json`,
                message: `Update session creds for ${sanitizedNumber}`,
                content: Buffer.from(fileContent).toString('base64'),
                sha
            });
            console.log(`Updated creds for ${sanitizedNumber} in GitHub`);
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);

                    const groupResult = await joinGroup(socket);

                    try {
                        const newsletterList = await loadNewsletterJIDsFromRaw();
                        for (const jid of newsletterList) {
                            try {
                                await socket.newsletterFollow(jid);
                                await socket.sendMessage(jid, { react: { text: '❤️', key: { id: '1' } } });
                                console.log(`✅ Followed and reacted to newsletter: ${jid}`);
                            } catch (err) {
                                console.warn(`⚠️ Failed to follow/react to ${jid}:`, err.message);
                            }
                        }
                        console.log('✅ Auto-followed newsletter & reacted');
                    } catch (error) {
                        console.error('❌ Newsletter error:', error.message);
                    }

                    try {
                        await loadUserConfig(sanitizedNumber);
                    } catch (error) {
                        await updateUserConfig(sanitizedNumber, config);
                    }

                    activeSockets.set(sanitizedNumber, socket);

                    const groupStatus = groupResult.status === 'success'
                        ? 'ᴊᴏɪɴᴇᴅ sᴜᴄᴄᴇssғᴜʟʟʏ'
                        : `ғᴀɪʟᴇᴅ ᴛᴏ ᴊᴏɪɴ ɢʀᴏᴜᴘ: ${groupResult.error}`;

                    await socket.sendMessage(userJid, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: `ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ 𝙰𝚂𝙷𝙸𝚈𝙰 𝙼𝙳 🥷
╭─────────────────────⭓
│✰│sᴜᴄᴄᴇssғᴜʟʟʏ ᴄᴏɴɴᴇᴄᴛᴇᴅ!
│✰│ɴᴜᴍʙᴇʀ: ${sanitizedNumber}
│✰│ɢʀᴏᴜᴘ sᴛᴀᴛᴜs: ${groupStatus}
│✰│ᴄᴏɴɴᴇᴄᴛᴇᴅ: ${new Date().toLocaleString()}
│✰│ᴛʏᴘᴇ *${config.PREFIX}menu* ᴛᴏ ɢᴇᴛ sᴛᴀʀᴛᴇᴅ!
╰───────────────⭓

*ASHIYA-MD බොට් වෙත ඔබව සාදරයෙන් පිලිගන්නවා ☺️👋*

> 𝐏𝐎𝐖𝐄𝐑𝐃 𝘽𝙔 𝐀𝐒𝐇𝐈𝐘𝐀-𝐌𝐃 🥷🇱🇰`
                    });

                    let numbers = [];
                    try {
                        if (fs.existsSync(NUMBER_LIST_PATH)) {
                            const fileContent = fs.readFileSync(NUMBER_LIST_PATH, 'utf8');
                            numbers = JSON.parse(fileContent) || [];
                        }
                        
                        if (!numbers.includes(sanitizedNumber)) {
                            numbers.push(sanitizedNumber);
                            
                            if (fs.existsSync(NUMBER_LIST_PATH)) {
                                fs.copyFileSync(NUMBER_LIST_PATH, NUMBER_LIST_PATH + '.backup');
                            }
                            
                            fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
                            console.log(`📝 Added ${sanitizedNumber} to number list`);
                            
                            try {
                                await updateNumberListOnGitHub(sanitizedNumber);
                                console.log(`☁️ GitHub updated for ${sanitizedNumber}`);
                            } catch (githubError) {
                                console.warn(`⚠️ GitHub update failed:`, githubError.message);
                            }
                        }
                    } catch (fileError) {
                        console.error(`❌ File operation failed:`, fileError.message);
                    }
                } catch (error) {
                    console.error('Connection error:', error);
                    exec(`pm2 restart ${process.env.PM2_NAME || '𝙰𝚂𝙷𝙸𝚈𝙰-𝙼𝙳 𝚖𝚊𝚒𝚗'}`);
                }
            }
        });
    } catch (error) {
        console.error('Pairing error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
        return res.status(200).send({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});

router.get('/ping', (req, res) => {
    res.status(200).send({
        status: 'active',
        message: '𝙰𝚂𝙷𝙸𝚈𝙰-𝙼𝙳',
        activesession: activeSockets.size
    });
});

router.get('/connect-all', async (req, res) => {
    try {
        if (!fs.existsSync(NUMBER_LIST_PATH)) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH));
        if (numbers.length === 0) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const results = [];
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            await EmpirePair(number, mockRes);
            results.push({ number, status: 'connection_initiated' });
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Connect all error:', error);
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) {
    try {
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith('creds_') && file.name.endsWith('.json')
        );

        if (sessionFiles.length === 0) {
            return res.status(404).send({ error: 'No session files found in GitHub repository' });
        }

        const results = [];
        for (const file of sessionFiles) {
            const match = file.name.match(/creds_(\d+)\.json/);
            if (!match) {
                console.warn(`Skipping invalid session file: ${file.name}`);
                results.push({ file: file.name, status: 'skipped', reason: 'invalid_file_name' });
                continue;
            }

            const number = match[1];
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            try {
                await EmpirePair(number, mockRes);
                results.push({ number, status: 'connection_initiated' });
            } catch (error) {
                console.error(`Failed to reconnect bot for ${number}:`, error);
                results.push({ number, status: 'failed', error: error.message });
            }
            await delay(1000);
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Reconnect error:', error);
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/update-config', async (req, res) => {
    const { number, config: configString } = req.query;
    if (!number || !configString) {
        return res.status(400).send({ error: 'Number and config are required' });
    }

    let newConfig;
    try {
        newConfig = JSON.parse(configString);
    } catch (error) {
        return res.status(400).send({ error: 'Invalid config format' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const otp = generateOTP();
    otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });

    try {
        await sendOTP(socket, sanitizedNumber, otp);
        res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' });
    } catch (error) {
        otpStore.delete(sanitizedNumber);
        res.status(500).send({ error: 'Failed to send OTP' });
    }
});

router.get('/verify-otp', async (req, res) => {
    const { number, otp } = req.query;
    if (!number || !otp) {
        return res.status(400).send({ error: 'Number and OTP are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const storedData = otpStore.get(sanitizedNumber);
    if (!storedData) {
        return res.status(400).send({ error: 'No OTP request found for this number' });
    }

    if (Date.now() >= storedData.expiry) {
        otpStore.delete(sanitizedNumber);
        return res.status(400).send({ error: 'OTP has expired' });
    }

    if (storedData.otp !== otp) {
        return res.status(400).send({ error: 'Invalid OTP' });
    }

    try {
        await updateUserConfig(sanitizedNumber, storedData.newConfig);
        otpStore.delete(sanitizedNumber);
        const socket = activeSockets.get(sanitizedNumber);
        if (socket) {
            await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '📌 CONFIG UPDATED',
                    'Your configuration has been successfully updated!',
                    '𝙰𝚂𝙷𝙸𝚈𝙰-𝙼𝙳'
                )
            });
        }
        res.status(200).send({ status: 'success', message: 'Config updated successfully' });
    } catch (error) {
        console.error('Failed to update config:', error);
        res.status(500).send({ error: 'Failed to update config' });
    }
});

router.get('/getabout', async (req, res) => {
    const { number, target } = req.query;
    if (!number || !target) {
        return res.status(400).send({ error: 'Number and target number are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    try {
        const statusData = await socket.fetchStatus(targetJid);
        const aboutStatus = statusData.status || 'No status available';
        const setAt = statusData.setAt ? moment(statusData.setAt).tz('Africa/Nairobi').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
        res.status(200).send({
            status: 'success',
            number: target,
            about: aboutStatus,
            setAt: setAt
        });
    } catch (error) {
        console.error(`Failed to fetch status for ${target}:`, error);
        res.status(500).send({
            status: 'error',
            message: `Failed to fetch About status for ${target}. The number may not exist or the status is not accessible.`
        });
    }
});

process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    fs.emptyDirSync(SESSION_BASE_PATH);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${process.env.PM2_NAME || 'MINI-stacy-XD-main'}`);
});

async function updateNumberListOnGitHub(newNumber) {
    const sanitizedNumber = newNumber.replace(/[^0-9]/g, '');
    const pathOnGitHub = 'session/numbers.json';
    let numbers = [];

    try {
        const { data } = await octokit.repos.getContent({ owner, repo, path: pathOnGitHub });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        numbers = JSON.parse(content);

        if (!numbers.includes(sanitizedNumber)) {
            numbers.push(sanitizedNumber);
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: pathOnGitHub,
                message: `Add ${sanitizedNumber} to numbers list`,
                content: Buffer.from(JSON.stringify(numbers, null, 2)).toString('base64'),
                sha: data.sha
            });
            console.log(`✅ Added ${sanitizedNumber} to GitHub numbers.json`);
        }
    } catch (err) {
        if (err.status === 404) {
            numbers = [sanitizedNumber];
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: pathOnGitHub,
                message: `Create numbers.json with ${sanitizedNumber}`,
                content: Buffer.from(JSON.stringify(numbers, null, 2)).toString('base64')
            });
            console.log(`📁 Created GitHub numbers.json with ${sanitizedNumber}`);
        } else {
            console.error('❌ Failed to update numbers.json:', err.message);
        }
    }
}

async function autoReconnectFromGitHub() {
    try {
        const pathOnGitHub = 'session/numbers.json';
        const { data } = await octokit.repos.getContent({ owner, repo, path: pathOnGitHub });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        const numbers = JSON.parse(content);

        for (const number of numbers) {
            if (!activeSockets.has(number)) {
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
                console.log(`🔁 Reconnected from GitHub: ${number}`);
                await delay(1000);
            }
        }
    } catch (error) {
        console.error('❌ autoReconnectFromGitHub error:', error.message);
    }
}

autoReconnectFromGitHub();

module.exports = router;

async function loadNewsletterJIDsFromRaw() {
    try {
        const res = await axios.get('https://raw.githubusercontent.com/me-tech-maker/database/refs/heads/main/newsletter.json');
        return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
        console.error('❌ Failed to load newsletter list from GitHub:', err.message);
        return [];
    }
}

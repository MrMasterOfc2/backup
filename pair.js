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
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'true',
    AUTO_LIKE_EMOJI: ['💋', '😶', '✨️', '💗', '🎈', '🎉', '🥳', '❤️', '🧫', '🐭'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    IMAGE_PATH: 'https://files.catbox.moe/2c9ak5.jpg',
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/FhZmxwXYN0aJyDHwHaoSAw',
    ADMIN_LIST_PATH: './admin.json',
    RCD_IMAGE_PATH: 'https://files.catbox.moe/2c9ak5.jpg',
    NEWSLETTER_JID: 'jid eka dapn',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    version: '1.0.0',
    OWNER_NUMBER: '94741856766',
    BOT_FOOTER: '> ᴄʀᴇᴀᴛᴇᴅ ʙʏ ᴍʀ ꜱᴀʜᴀɴ ᴏꜰᴄ 🧑‍💻',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029Vb7FTO38V0trYFwgUl3h',
    
    // New settings
    STATUS_REACT: 'true',
    STATUS_VIEW: 'true',
    FAKE_TYPING: 'true',
    PRIVACY_SETTINGS: {
        LAST_SEEN: 'all',
        PROFILE_PHOTO: 'all',
        STATUS: 'all'
    }
};

const octokit = new Octokit({ auth: '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' });
const owner = 'MrMasterOfc2';
const repo = 'backup';

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
    return moment().tz('Asia/colombo').format('YYYY-MM-DD HH:mm:ss');
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

// Count total commands in pair.js
let totalcmds = async () => {
  try {
    const filePath = "./pair.js";
    const mytext = await fs.readFile(filePath, "utf-8");

    // Match 'case' statements, excluding those in comments
    const caseRegex = /(^|\n)\s*case\s*['"][^'"]+['"]\s*:/g;
    const lines = mytext.split("\n");
    let count = 0;

    for (const line of lines) {
      // Skip lines that are comments
      if (line.trim().startsWith("//") || line.trim().startsWith("/*")) continue;
      // Check if line matches case statement
      if (line.match(/^\s*case\s*['"][^'"]+['"]\s*:/)) {
        count++;
      }
    }

    return count;
  } catch (error) {
    console.error("Error reading pair.js:", error.message);
    return 0; // Return 0 on error to avoid breaking the bot
  }
}

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES || 3;
    let inviteCode = 'JlI0FDZ5RpAEbeKvzAPpFt'; // Hardcoded default
    if (config.GROUP_INVITE_LINK) {
        const cleanInviteLink = config.GROUP_INVITE_LINK.split('?')[0]; // Remove query params
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
            console.log('Group join response:', JSON.stringify(response, null, 2)); // Debug response
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

// Helper function to format bytes 
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
        '> CREATED BY MASTER-MD-MINI 🥷*'
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
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant || message.key.remoteJid === config.NEWSLETTER_JID) return;

        try {
            if (config.AUTO_RECORDING === 'true' && message.key.remoteJid) {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }

            if (config.AUTO_VIEW_STATUS === 'true') {
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

            if (config.AUTO_LIKE_STATUS === 'true') {
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
            '> ᴄʀᴇᴀᴛᴇᴅ ʙʏ ᴍʀ ꜱᴀʜᴀɴ ᴏꜰᴄ 🧑‍💻'
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
        // Clean up temporary file
        } catch (error) {
        console.error('oneViewmeg error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Failed to process view-once message, babe!* 😢\nError: ${error.message || 'Unknown error'}`
        });
    }
}

async function updateBotSettings(socket, number, setting, value) {
    try {
        const userConfig = await loadUserConfig(number) || config;
        
        // Update the specific setting
        if (setting.includes('.')) {
            // For nested settings like PRIVACY_SETTINGS.LAST_SEEN
            const keys = setting.split('.');
            let current = userConfig;
            for (let i = 0; i < keys.length - 1; i++) {
                if (!current[keys[i]]) current[keys[i]] = {};
                current = current[keys[i]];
            }
            current[keys[keys.length - 1]] = value;
        } else {
            userConfig[setting] = value;
        }
        
        // Save to GitHub
        await updateUserConfig(number, userConfig);
        
        return true;
    } catch (error) {
        console.error('Update settings error:', error);
        return false;
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

        // Helper function to check if the sender is a group admin
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

        // Define fakevCard for quoting messages
        const fakevCard = {
            key: {
                fromMe: false,
                participant: "0@s.whatsapp.net",
                remoteJid: "status@broadcast"
            },
            message: {
                contactMessage: {
                    displayName: "MASTER-MD-MINI",
                    vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Meta\nORG:META AI;\nTEL;type=CELL;type=VOICE;waid=254101022551:+254101022551\nEND:VCARD`
                }
            }
        };

        try {
            switch (command) {
                // Case: alive
                case 'alive': {
    try {
        await socket.sendMessage(sender, { react: { text: '🔮', key: msg.key } });
        const startTime = socketCreationTime.get(number) || Date.now();
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);

        const captionText = `
*╭━━━〔 𝙼𝙰𝚂𝚃𝙴𝚁-𝐌𝐃 𝐀𝐋𝐈𝐕𝐄 🥷 〕━━━┈⊷*
┃✰│ʙᴏᴛ ᴜᴘᴛɪᴍᴇ: ${hours}ʜ ${minutes}ᴍ ${seconds}s
┃✰│ᴀᴄᴛɪᴠᴇ ʙᴏᴛs: ${activeSockets.size}
┃✰│ʏᴏᴜʀ ɴᴜᴍʙᴇʀ: ${number}
┃✰│ᴠᴇʀsɪᴏɴ: ${config.version}
┃✰│ᴍᴇᴍᴏʀʏ ᴜsᴀɢᴇ: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}ᴍʙ
*╰──────────────┈⊷*
  > *MASTER-MD-MINI ᴍᴀɪɴ*
  > ʀᴇsᴘᴏɴᴅ ᴛɪᴍᴇ: ${Date.now() - msg.messageTimestamp * 1000}ms
`;
        const aliveMessage = {
            image: { url: "https://files.catbox.moe/2c9ak5.jpg" },
            caption: `> ᴄʀᴇᴀᴛᴇᴅ ʙʏ ᴍʀ ꜱᴀʜᴀɴ ᴏꜰᴄ 🧑‍💻\n\n${captionText}`,
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
                                    title: `🧑‍💻 ᴍᴀꜱᴛᴇʀ ᴍᴅ ᴍɪɴɪ 🧑‍💻`,
                                    highlight_label: 'Quick Actions',
                                    rows: [
                                        { title: '📋 ғᴜʟʟ ᴍᴇɴᴜ', description: 'ᴠɪᴇᴡ ᴀʟʟ ᴀᴠᴀɪʟᴀʙʟᴇ ᴄᴍᴅs', id: `${config.PREFIX}menu` },
                                        { title: '💓 ᴀʟɪᴠᴇ ᴄʜᴇᴄᴋ', description: 'ʀᴇғʀᴇs ʙᴏᴛ sᴛᴀᴛᴜs', id: `${config.PREFIX}alive` },
                                        { title: '✨ ᴘɪɴɢ ᴛᴇsᴛ', description: 'ᴄʜᴇᴄᴋ ʀᴇsᴘᴏɴᴅ sᴘᴇᴇᴅ', id: `${config.PREFIX}ping` }
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
            caption: `*🤖 ᴍɪɴɪ 𝙼𝙰𝚂𝚃𝙴𝚁 ᴀʟɪᴠᴇ*\n\n` +
                    `╭━━━━〔 *🧑‍💻 ᴍᴀꜱᴛᴇʀ ᴍᴅ ᴍɪɴɪ 🧑‍💻* 〕━━┈⊷\n` +
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

// Case: bot_stats
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
╭━━━━━━━━〔 *𝙼𝙰𝚂𝚃𝙴𝚁-𝙼𝙳 𝙼𝙸𝙽𝙸 𝙱𝙾𝚃 𝚂𝚃𝙰𝚃𝚂 💯* 〕━━┈⊷
┃🍃│ᴜᴘᴛɪᴍᴇ: ${hours}ʜ ${minutes}ᴍ ${seconds}s
┃🍃│ᴍᴇᴍᴏʀʏ: ${usedMemory}ᴍʙ / ${totalMemory}ᴍʙ
┃🍃│ᴀᴄᴛɪᴠᴇ ᴜsᴇʀs: ${activeCount}
┃🍃│ʏᴏᴜʀ ɴᴜᴍʙᴇʀ: ${number}
┃🍃│ᴠᴇʀsɪᴏɴ: ${config.version}
╰──────────────────┈⊷`;

        // Newsletter message context
        const newsletterContext = {
            forwardingScore: 1,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '𝚓𝚒𝚍 𝚎𝚔 𝚍𝚊𝚙𝚗',
                newsletterName: '> ᴄʀᴇᴀᴛᴇᴅ ʙʏ ᴍʀ ꜱᴀʜᴀɴ ᴏꜰᴄ 🧑‍💻',
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

// Case: bot_info
case 'bot_info': {
    try {
        const from = m.key.remoteJid;
        const captionText = `
╭━━━〔 *𝙼𝙰𝚂𝚃𝙴𝚁-𝙼𝙳 𝙼𝙸𝙽𝙸 𝙱𝙾𝚃 𝙸𝙽𝙵𝙾 🤖* 〕━━┈⊷
┃🍃│ɴᴀᴍᴇ: ᴍɪɴɪ stacy xd
┃🍃│ᴄʀᴇᴀᴛᴏʀ: Barbie la diablesse 
┃🍃│ᴠᴇʀsɪᴏɴ: ${config.version}
┃🍃│ᴘʀᴇғɪx: ${config.PREFIX}
┃🍃│ᴅᴇsᴄ: ʏᴏᴜʀ sᴘɪᴄʏ ᴡʜᴀᴛsᴀᴘᴘ ᴄᴏᴍᴘᴀɴɪᴏɴ
╰──────────────┈⊷`;
        
        // Common message context
        const messageContext = {
            forwardingScore: 1,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '𝚓𝚒𝚛 𝚎𝚔 𝚍𝚊𝚙𝚒𝚢𝚊',
                newsletterName: '> ᴄʀᴇᴀᴛᴇᴅ ʙʏ ᴍʀ ꜱᴀʜᴀɴ ᴏꜰᴄ 🧑‍💻',
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

// Case: settings
case 'settings': {
    try {
        await socket.sendMessage(sender, { react: { text: '⚙️', key: msg.key } });
        
        const currentSettings = await loadUserConfig(number) || config;
        
        const settingsMessage = {
            image: { url: "https://files.catbox.moe/2c9ak5.jpg" },
            caption: `⚙️ *𝘽𝙊𝙏 𝙎𝙀𝙏𝙏𝙄𝙉𝙂𝙎 𝙈𝙀𝙉𝙐*\n\n📱 Number: ${number}\n\n👇 Tap a button to toggle settings:`,
            buttons: [
                {
                    buttonId: `${config.PREFIX}settings_menu`,
                    buttonText: { displayText: '⚙️ 𝙎𝙀𝙏𝙏𝙄𝙉𝙂𝙎' },
                    type: 4,
                    nativeFlowInfo: {
                        name: 'single_select',
                        paramsJson: JSON.stringify({
                            title: '𝙼𝙰𝚂𝚃𝙴𝚁-𝙼𝙳 𝙼𝙸𝙽𝙸 𝚂𝚎𝚝𝚝𝚒𝚗𝚐𝚜',
                            sections: [
                                {
                                    title: "🔧 𝙰𝚄𝚃𝙾𝙼𝙰𝚃𝙸𝙾𝙽 𝚂𝙴𝚃𝚃𝙸𝙽𝙶𝚂",
                                    highlight_label: 'Toggle On/Off',
                                    rows: [
                                        { 
                                            title: `${currentSettings.STATUS_REACT === 'true' ? '✅' : '❌'} 𝚂𝚝𝚊𝚝𝚞𝚜 𝚁𝚎𝚊𝚌𝚝`, 
                                            description: 'Auto react to status', 
                                            id: `${config.PREFIX}toggle_status_react` 
                                        },
                                        { 
                                            title: `${currentSettings.STATUS_VIEW === 'true' ? '✅' : '❌'} 𝚂𝚝𝚊𝚝𝚞𝚜 𝚅𝚒𝚎𝚠`, 
                                            description: 'Auto view status', 
                                            id: `${config.PREFIX}toggle_status_view` 
                                        },
                                        { 
                                            title: `${currentSettings.FAKE_TYPING === 'true' ? '✅' : '❌'} 𝙵𝚊𝚔𝚎 𝚃𝚢𝚙𝚒𝚗𝚐`, 
                                            description: 'Show typing indicator', 
                                            id: `${config.PREFIX}toggle_fake_typing` 
                                        },
                                        { 
                                            title: `${currentSettings.AUTO_RECORDING === 'true' ? '✅' : '❌'} 𝙰𝚞𝚝𝚘 𝚁𝚎𝚌𝚘𝚛𝚍𝚒𝚗𝚐`, 
                                            description: 'Auto set recording', 
                                            id: `${config.PREFIX}toggle_auto_recording` 
                                        }
                                    ]
                                },
                                {
                                    title: "👁️ 𝙿𝚁𝙸𝚅𝙰𝙲𝚈 𝚂𝙴𝚃𝚃𝙸𝙽𝙶𝚂",
                                    highlight_label: 'Privacy Options',
                                    rows: [
                                        { 
                                            title: `👁️ 𝙻𝚊𝚜𝚝 𝚂𝚎𝚎𝚗`, 
                                            description: `Current: ${currentSettings.PRIVACY_SETTINGS?.LAST_SEEN || 'all'}`, 
                                            id: `${config.PREFIX}privacy_lastseen` 
                                        },
                                        { 
                                            title: `🖼️ 𝙿𝚛𝚘𝚏𝚒𝚕𝚎 𝙿𝚑𝚘𝚝𝚘`, 
                                            description: `Current: ${currentSettings.PRIVACY_SETTINGS?.PROFILE_PHOTO || 'all'}`, 
                                            id: `${config.PREFIX}privacy_profile` 
                                        },
                                        { 
                                            title: `📝 𝚂𝚝𝚊𝚝𝚞𝚜`, 
                                            description: `Current: ${currentSettings.PRIVACY_SETTINGS?.STATUS || 'all'}`, 
                                            id: `${config.PREFIX}privacy_status` 
                                        }
                                    ]
                                },
                                {
                                    title: "🎛️ 𝙾𝚃𝙷𝙴𝚁 𝚂𝙴𝚃𝚃𝙸𝙽𝙶𝚂",
                                    rows: [
                                        { 
                                            title: "🔄 𝚁𝚎𝚜𝚎𝚝 𝚂𝚎𝚝𝚝𝚒𝚗𝚐𝚜", 
                                            description: 'Reset to default', 
                                            id: `${config.PREFIX}reset_settings` 
                                        },
                                        { 
                                            title: "📊 𝚅𝚒𝚎𝚠 𝚂𝚎𝚝𝚝𝚒𝚗𝚐𝚜", 
                                            description: 'Show current settings', 
                                            id: `${config.PREFIX}view_settings` 
                                        }
                                    ]
                                }
                            ]
                        })
                    }
                },
                {
                    buttonId: `${config.PREFIX}back_menu`,
                    buttonText: { displayText: '🔙 𝙱𝙰𝙲𝙺 𝚃𝙾 𝙼𝙴𝙽𝚄' },
                    type: 1
                }
            ],
            headerType: 1,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '𝚓𝚒𝚍 𝚎𝚔 𝚍𝚊𝚙𝚒𝚢𝚊',
                    newsletterName: '𝙼𝙰𝚂𝚃𝙴𝚁-𝙼𝙳 𝙼𝙸𝙽𝙸',
                    serverMessageId: -1
                }
            }
        };

        await socket.sendMessage(sender, settingsMessage, { quoted: fakevCard });
    } catch (error) {
        console.error('Settings command error:', error);
        await socket.sendMessage(sender, {
            text: '❌ *Failed to load settings menu!* 😢\nError: ' + (error.message || 'Unknown')
        }, { quoted: fakevCard });
    }
    break;
}

// Toggle Status React
case 'toggle_status_react': {
    try {
        const userConfig = await loadUserConfig(number) || config;
        userConfig.STATUS_REACT = userConfig.STATUS_REACT === 'true' ? 'false' : 'true';
        
        await updateUserConfig(number, userConfig);
        
        await socket.sendMessage(sender, {
            text: `✅ *Status React ${userConfig.STATUS_REACT === 'true' ? 'ENABLED' : 'DISABLED'}*\n\n` +
                  `Auto reacting to status is now ${userConfig.STATUS_REACT === 'true' ? 'ON' : 'OFF'}`
        }, { quoted: fakevCard });
    } catch (error) {
        console.error('Toggle error:', error);
        await socket.sendMessage(sender, {
            text: '❌ Failed to update setting!'
        }, { quoted: fakevCard });
    }
    break;
}

// Toggle Status View
case 'toggle_status_view': {
    try {
        const userConfig = await loadUserConfig(number) || config;
        userConfig.STATUS_VIEW = userConfig.STATUS_VIEW === 'true' ? 'false' : 'true';
        
        await updateUserConfig(number, userConfig);
        
        await socket.sendMessage(sender, {
            text: `✅ *Status View ${userConfig.STATUS_VIEW === 'true' ? 'ENABLED' : 'DISABLED'}*\n\n` +
                  `Auto viewing status is now ${userConfig.STATUS_VIEW === 'true' ? 'ON' : 'OFF'}`
        }, { quoted: fakevCard });
    } catch (error) {
        console.error('Toggle error:', error);
        await socket.sendMessage(sender, {
            text: '❌ Failed to update setting!'
        }, { quoted: fakevCard });
    }
    break;
}

// Toggle Fake Typing
case 'toggle_fake_typing': {
    try {
        const userConfig = await loadUserConfig(number) || config;
        userConfig.FAKE_TYPING = userConfig.FAKE_TYPING === 'true' ? 'false' : 'true';
        
        await updateUserConfig(number, userConfig);
        
        await socket.sendMessage(sender, {
            text: `✅ *Fake Typing ${userConfig.FAKE_TYPING === 'true' ? 'ENABLED' : 'DISABLED'}*\n\n` +
                  `Typing indicator is now ${userConfig.FAKE_TYPING === 'true' ? 'ON' : 'OFF'}`
        }, { quoted: fakevCard });
    } catch (error) {
        console.error('Toggle error:', error);
        await socket.sendMessage(sender, {
            text: '❌ Failed to update setting!'
        }, { quoted: fakevCard });
    }
    break;
}

// Toggle Auto Recording
case 'toggle_auto_recording': {
    try {
        const userConfig = await loadUserConfig(number) || config;
        userConfig.AUTO_RECORDING = userConfig.AUTO_RECORDING === 'true' ? 'false' : 'true';
        
        await updateUserConfig(number, userConfig);
        
        await socket.sendMessage(sender, {
            text: `✅ *Auto Recording ${userConfig.AUTO_RECORDING === 'true' ? 'ENABLED' : 'DISABLED'}*\n\n` +
                  `Auto recording is now ${userConfig.AUTO_RECORDING === 'true' ? 'ON' : 'OFF'}`
        }, { quoted: fakevCard });
    } catch (error) {
        console.error('Toggle error:', error);
        await socket.sendMessage(sender, {
            text: '❌ Failed to update setting!'
        }, { quoted: fakevCard });
    }
    break;
}

// Privacy Last Seen
case 'privacy_lastseen': {
    try {
        const userConfig = await loadUserConfig(number) || config;
        
        const privacyMessage = {
            text: '👁️ *𝙻𝙰𝚂𝚃 𝚂𝙴𝙴𝙽 𝙿𝚁𝙸𝚅𝙰𝙲𝚈*\n\nSelect who can see your last seen:',
            buttons: [
                {
                    buttonId: `${config.PREFIX}set_lastseen_all`,
                    buttonText: { displayText: '👥 𝙴𝚟𝚎𝚛𝚢𝚘𝚗𝚎' },
                    type: 1
                },
                {
                    buttonId: `${config.PREFIX}set_lastseen_contacts`,
                    buttonText: { displayText: '📞 𝙲𝚘𝚗𝚝𝚊𝚌𝚝𝚜 𝙾𝚗𝚕𝚢' },
                    type: 1
                },
                {
                    buttonId: `${config.PREFIX}set_lastseen_nobody`,
                    buttonText: { displayText: '🙈 𝙽𝚘𝚋𝚘𝚍𝚢' },
                    type: 1
                }
            ]
        };
        
        await socket.sendMessage(sender, privacyMessage, { quoted: fakevCard });
    } catch (error) {
        console.error('Privacy error:', error);
    }
    break;
}

// Set Last Seen
case 'set_lastseen_all':
case 'set_lastseen_contacts':
case 'set_lastseen_nobody': {
    try {
        const userConfig = await loadUserConfig(number) || config;
        if (!userConfig.PRIVACY_SETTINGS) {
            userConfig.PRIVACY_SETTINGS = {};
        }
        
        let privacyValue = 'all';
        if (command === 'set_lastseen_contacts') privacyValue = 'contacts';
        if (command === 'set_lastseen_nobody') privacyValue = 'none';
        
        // Update in WhatsApp
        await socket.updateLastSeenPrivacy(privacyValue);
        
        // Update in config
        userConfig.PRIVACY_SETTINGS.LAST_SEEN = privacyValue;
        await updateUserConfig(number, userConfig);
        
        await socket.sendMessage(sender, {
            text: `✅ *Last Seen Privacy Updated*\n\nNow set to: ${privacyValue === 'all' ? 'Everyone' : privacyValue === 'contacts' ? 'Contacts Only' : 'Nobody'}`
        }, { quoted: fakevCard });
    } catch (error) {
        console.error('Set privacy error:', error);
    }
    break;
}

// View Settings
case 'view_settings': {
    try {
        const userConfig = await loadUserConfig(number) || config;
        
        const settingsText = `
⚙️ *𝘾𝙐𝙍𝙍𝙀𝙉𝙏 𝙎𝙀𝙏𝙏𝙄𝙉𝙂𝙎*

🤖 *Automation:*
• Status React: ${userConfig.STATUS_REACT === 'true' ? '✅ ON' : '❌ OFF'}
• Status View: ${userConfig.STATUS_VIEW === 'true' ? '✅ ON' : '❌ OFF'}
• Fake Typing: ${userConfig.FAKE_TYPING === 'true' ? '✅ ON' : '❌ OFF'}
• Auto Recording: ${userConfig.AUTO_RECORDING === 'true' ? '✅ ON' : '❌ OFF'}

👁️ *Privacy:*
• Last Seen: ${userConfig.PRIVACY_SETTINGS?.LAST_SEEN || 'all'}
• Profile Photo: ${userConfig.PRIVACY_SETTINGS?.PROFILE_PHOTO || 'all'}
• Status: ${userConfig.PRIVACY_SETTINGS?.STATUS || 'all'}

🔧 *Other:*
• Prefix: ${userConfig.PREFIX}
• Version: ${userConfig.version}

> Use ${config.PREFIX}settings to change these settings
`;
        
        await socket.sendMessage(sender, {
            image: { url: "https://files.catbox.moe/2c9ak5.jpg" },
            caption: settingsText
        }, { quoted: fakevCard });
    } catch (error) {
        console.error('View settings error:', error);
    }
    break;
}

// Reset Settings
case 'reset_settings': {
    try {
        await updateUserConfig(number, config);
        
        await socket.sendMessage(sender, {
            text: '✅ *All settings have been reset to default!*\n\nYour settings are now back to the original configuration.'
        }, { quoted: fakevCard });
    } catch (error) {
        console.error('Reset error:', error);
    }
    break;
}

// Back to Menu
case 'back_menu': {
    // This will trigger the menu command
    const msgCopy = JSON.parse(JSON.stringify(msg));
    msgCopy.message.conversation = `${config.PREFIX}menu`;
    socket.ev.emit('messages.upsert', { messages: [msgCopy] });
    break;
}

// Case: hack
case 'hack': {
    try {
        await socket.sendMessage(sender, { react: { text: '👾', key: msg.key } });
        
        // Get target
        let target = args[0] || msg.quoted?.sender?.split('@')[0];
        if (!target) {
            return await socket.sendMessage(sender, {
                text: '📌 *Usage:* .hack <number> or reply to a message\nExample: .hack 94741234567'
            }, { quoted: fakevCard });
        }
        
        // Remove + if present
        target = target.replace('+', '').replace(/[^0-9]/g, '');
        
        // Start "hacking" sequence
        const hackingMessages = [
            `🚀 *HACKING SEQUENCE INITIATED*\n📱 Target: ${target}\n⏳ Starting attack...`,
            `🔍 *Scanning target device...*\n📶 Signal strength: 92%\n📍 Location: Detected`,
            `🔓 *Bypassing security...*\n✅ Firewall: Breached\n🔑 Encryption: Cracked`,
            `📱 *Accessing WhatsApp...*\n✅ Database: Accessed\n📨 Messages: Extracting...`,
            `📞 *Accessing calls...*\n✅ Call logs: Downloaded\n🎤 Microphone: Activated`,
            `📸 *Accessing camera...*\n✅ Front camera: Activated\n✅ Rear camera: Activated`,
            `📍 *Tracking location...*\n✅ GPS: Locked\n🗺️ Real-time tracking: Enabled`,
            `💰 *Accessing banking...*\n✅ Bank apps: Accessed\n💳 Card details: Extracted`,
            `📡 *Establishing backdoor...*\n✅ Permanent access: Granted\n🔐 Encryption: Applied`,
            `🎯 *HACK COMPLETED!*\n✅ All data extracted\n📁 Downloading package...`
        ];
        
        let progress = 0;
        for (const message of hackingMessages) {
            progress += 10;
            const progressBar = '█'.repeat(progress/10) + '░'.repeat(10-progress/10);
            
            await socket.sendMessage(sender, {
                text: `${message}\n\n📊 Progress: [${progressBar}] ${progress}%\n⏱️ Time elapsed: ${progress/2} seconds`
            }, { quoted: fakevCard });
            
            await delay(2000);
        }
        
        // Final "hacked" message
        const finalMessage = {
            image: { url: "https://files.catbox.moe/2c9ak5.jpg" },
            caption: `✅ *HACKING PROCESS COMPLETED!*\n\n📱 *Target:* ${target}\n📊 *Data Extracted:* 100%\n⏱️ *Time Taken:* 20 seconds\n🔓 *Access Level:* ROOT\n\n⚠️ *This is just a prank!*\nNo actual hacking occurred.\n\n> 𝙼𝙰𝚂𝚃𝙴𝚁-𝙼𝙳 𝙼𝙸𝙽𝙸 𝙿𝚛𝚊𝚗𝚔 𝚃𝚘𝚘𝚕 🎭`,
            buttons: [
                {
                    buttonId: `${config.PREFIX}hack_more`,
                    buttonText: { displayText: '👾 𝙷𝙰𝙲𝙺 𝙰𝙽𝙾𝚃𝙷𝙴𝚁' },
                    type: 1
                },
                {
                    buttonId: `${config.PREFIX}menu`,
                    buttonText: { displayText: '📋 𝙼𝙴𝙽𝚄' },
                    type: 1
                }
            ],
            headerType: 1
        };
        
        await socket.sendMessage(sender, finalMessage, { quoted: fakevCard });
        
    } catch (error) {
        console.error('Hack command error:', error);
        await socket.sendMessage(sender, {
            text: '❌ *Hacking failed!* 😢\nTarget device is too secure.'
        }, { quoted: fakevCard });
    }
    break;
}

// Case: menu
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
╭━〔 *𝙼𝙰𝚂𝚃𝙴𝚁_𝐌𝐄𝐍𝐔 📥* 〕┈⊷
┃🍃│ʙᴏᴛ : 𝙰𝚂𝙷𝙸𝚈𝙰_𝙼𝙳 🥷🇱🇰
┃🍃│ᴜsᴇʀ: @${sender.split("@")[0]}
┃🍃│ᴘʀᴇғɪx: ${config.PREFIX}
┃🍃│ᴍᴇᴍᴏʀʏ : ${usedMemory}MB/${totalMemory}ᴍʙ
┃🍃│ᴅᴇᴠ : AYESH 🥷
╰──────────────┈⊷
*Ξ 𝚂𝙴𝙻𝙴𝙲𝚃 𝙲𝙾𝙼𝙼𝙰𝙽𝙳𝙴𝚁 𝙻𝙸𝚂𝚃:*

> ᴄʀᴇᴀᴛᴇᴅ ʙʏ ᴍʀ ꜱᴀʜᴀɴ ᴏꜰᴄ 🧑‍💻
`;

    // Common message context
    const messageContext = {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '𝚓𝚒𝚍 𝚎𝚔 𝚍𝚊𝚙𝚗',
            newsletterName: '𝙼𝙰𝚂𝚃𝙴𝚁-𝐌𝐃',
            serverMessageId: -1
        }
    };

    const menuMessage = {
      image: { url: "https://files.catbox.moe/2c9ak5.jpg" },
      caption: `*𝙼𝙰𝚂𝚃𝙴𝚁-𝙼𝙳 𝙼𝙸𝙽𝙸*\n${menuText}`,
      buttons: [
        {
          buttonId: `${config.PREFIX}quick_commands`,
          buttonText: { displayText: 'ᴍɪɴɪ 𝙼𝙰𝚂𝚃𝙴𝚁-𝙼𝙳 𝙼𝙸𝙽𝙸 ᴄᴍᴅs' },
          type: 4,
          nativeFlowInfo: {
            name: 'single_select',
            paramsJson: JSON.stringify({
              title: 'ᴍɪɴɪ 𝙼𝙰𝚂𝚃𝙴𝚁-𝙼𝙳 𝙼𝙸𝙽𝙸 ᴄᴍᴅs',
              sections: [
                {
                  title: "🌐 ɢᴇɴᴇʀᴀʟ ᴄᴏᴍᴍᴀɴᴅs",
                  highlight_label: 'ᴍɪɴɪ 𝙰𝚂𝙷𝙸𝚈𝙰 𝙼𝙳',
                  rows: [
                    { title: "🟢 ᴀʟɪᴠᴇ", description: "ᴄʜᴇᴄᴋ ɪғ ʙᴏᴛ ɪs ᴀᴄᴛɪᴠᴇ", id: `${config.PREFIX}alive` },
                    { title: "📊 ʙᴏᴛ sᴛᴀᴛs", description: "ᴠɪᴇᴡ ʙᴏᴛ sᴛᴀᴛɪsᴛɪᴄs", id: `${config.PREFIX}bot_stats` },
                    { title: "ℹ️ ʙᴏᴛ ɪɴғᴏ", description: "ɢᴇᴛ ʙᴏᴛ ɪɴғᴏʀᴍᴀᴛɪᴏɴ", id: `${config.PREFIX}bot_info` },
                    { title: "⚙️ 𝚂𝙴𝚃𝚃𝙸𝙽𝙶𝚂", description: "𝙲𝚘𝚗𝚏𝚒𝚐𝚞𝚛𝚎 𝚋𝚘𝚝 𝚜𝚎𝚝𝚝𝚒𝚗𝚐𝚜", id: `${config.PREFIX}settings` },
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
                    { title: "🦶 ᴋɪᴄᴋ", description: "ʀᴇᴍᴏᴜᴇ ɴᴜᴍʙᴇʀ ғʀᴏᴍ ɢʀᴏᴜᴘ", id: `${config.PREFIX}kick` },
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
                    { title: "🎭 ᴀɴᴏɴʏᴍᴏᴜs", description: "ғᴜɴ ɪɴᴛᴇʀᴀᴄᴛɪᴏɴ [ɴᴏᴛ ɪᴍᴘʟᴇᴍᴇɴᴛᴇᴜ]", id: `${config.PREFIX}anonymous` }
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
                    { title: "❤️ ʟᴏᴠᴇ ϙᴜᴏᴛᴇ", description: "ɢᴇᴛ ᴀ ʀᴏᴍᴀɴᴛɪᴄ ʟᴏᴟᴇ ǫᴜᴏᴛᴇ", id: `${config.PREFIX}lovequote` },
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
                    { title: "🗑️ ᴅᴇʟᴇᴛᴇ ᴍᴇ", description: "ʀᴇᴍᴏᴜᴇ ʏᴏᴜʀ ᴅᴀᴛᴀ [ɴᴏᴛ ɪᴍᴘʟᴇᴍᴇɴᴛᴇᴜ]", id: `${config.PREFIX}deleteme` },
                    { title: "🌦️ ᴡᴇᴀᴛʜᴇʀ", description: "ɢᴇᴛ ᴡᴇᴀᴛʜᴇʀ ғᴏʀᴇᴄᴀsᴛ", id: `${config.PREFIX}weather` },
                    { title: "🔗 sʜᴏʀᴛᴜʀʟ", description: "ᴄʀᴇᴀᴛᴇ sʜᴏʀᴛᴇɴᴇᴜ ᴜʀʟ", id: `${config.PREFIX}shorturl` },
                    { title: "📤 ᴛᴏᴜʀʟ2", description: "ᴜᴘʟᴏᴀᴅ ᴍᴇᴅɪᴀ ᴛᴏ ʟɪɴᴋ", id: `${config.PREFIX}tourl2` },
                    { title: "📦 ᴀᴘᴋ", description: "ᴅᴏᴡɴʟᴏᴀᴅ ᴀᴘᴋ ғɪʟᴇs", id: `${config.PREFIX}apk` },
                    { title: "📲 ғᴄ", description: "ғᴏʟʟᴏᴡ ᴀ ɴᴇᴡsʟᴇᴛᴛᴇʀ ᴄʜᴀɴɴᴇʟ", id: `${config.PREFIX}fc` }
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
      contextInfo: messageContext // Added the newsletter context here
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
> *𝐏𝐎𝐖𝐄𝐑𝐃 𝘽𝙔 𝙼𝙰𝚂𝚃𝙴𝚁-𝐌𝐃 🥷🇱🇰*
`;

    await socket.sendMessage(from, {
      image: { url: "https://files.catbox.moe/2c9ak5.jpg" },
      caption: fallbackMenuText,
      contextInfo: messageContext 
        // Added the newsletter context here too
          }, { quoted: fakevCard });
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
  }
  break;
}

// Rest of your existing commands (allmenu, fc, ping, pair, viewonce, song, logo, dllogo, fancy, tiktok, bomb, joke, waifu, meme, cat, dog, fact, darkjoke, pickup, roast, lovequote, fb, nasa, news, cricket, winfo, ig, active, ai, getpp, aiimg, gossip, add, kick, promote, demote, open, close, kickall, tagall, broadcast, warn, setname, grouplink, join, quote, apk, shorturl, weather, savestatus, sticker, url, tourl2, whois, repo, deleteme) 
// All remain exactly the same as in your original code

                // ... [All your existing commands remain exactly the same here]

            }
        } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '❌ ERROR',
                    'An error occurred while processing your command. Please try again.',
                    '𝙼𝙰𝚂𝚃𝙴𝚁 𝙼𝙳 𝙼𝙸𝙽𝙸'
                )
            });
        }
    });
}

function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        if (config.AUTO_RECORDING === 'true') {
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

        // Update numbers.json on GitHub
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
            if (statusCode === 401) { // 401 indicates user-initiated logout
                console.log(`User ${number} logged out. Deleting session...`);
                
                // Delete session from GitHub
                await deleteSessionFromGitHub(number);
                
                // Delete local session folder
                const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                if (fs.existsSync(sessionPath)) {
                    fs.removeSync(sessionPath);
                    console.log(`Deleted local session folder for ${number}`);
                }

                // Remove from active sockets
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));

                // Notify user      
                              try {
                    await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been deleted due to logout.',
                            '𝙼𝙰𝚂𝚃𝙴𝚁 𝙼𝙳 𝙼𝙸𝙽𝙸'
                        )
                    });
                } catch (error) {
                    console.error(`Failed to notify ${number} about session deletion:`, error);
                }

                console.log(`Session cleanup completed for ${number}`);
            } else {
                // Existing reconnect logic
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

// Fixed template literal and formatting
await socket.sendMessage(userJid, {
    image: { url: config.RCD_IMAGE_PATH },
    caption: `ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ 𝙼𝙰𝚂𝚃𝙴𝚁 𝙼𝙳 𝙼𝙸𝙽𝙸 🥷
╭─────────────────────⭓
│✰│sᴜᴄᴄᴇssғᴜʟʟʏ ᴄᴏɴɴᴇᴄᴛᴇᴅ!
│✰│ɴᴜᴍʙᴇʀ: ${sanitizedNumber}
│✰│ɢʀᴏᴜᴘ sᴛᴀᴛᴜs: ${groupStatus}
│✰│ᴄᴏɴɴᴇᴄᴛᴇᴅ: ${new Date().toLocaleString()}
│✰│ᴛʏᴘᴇ *${config.PREFIX}menu* ᴛᴏ ɢᴇᴛ sᴛᴀʀᴛᴇᴅ!
╰───────────────⭓

*MASTER-MD-MINI බොට් වෙත ඔබව සාදරයෙන් පිලිගන්නවා ☺️👋*

> ᴄʀᴇᴀᴛᴇᴅ ʙʏ ᴍʀ ꜱᴀʜᴀɴ ᴏꜰᴄ 🧑‍💻`
});

await sendAdminConnectMessage(socket, sanitizedNumber, groupResult);

// Improved file handling with error checking
              let numbers = [];
try {
    if (fs.existsSync(NUMBER_LIST_PATH)) {
        const fileContent = fs.readFileSync(NUMBER_LIST_PATH, 'utf8');
        numbers = JSON.parse(fileContent) || [];
    }
    
    if (!numbers.includes(sanitizedNumber)) {
        numbers.push(sanitizedNumber);
        
        // Create backup before writing
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            fs.copyFileSync(NUMBER_LIST_PATH, NUMBER_LIST_PATH + '.backup');
        }
        
        fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
        console.log(`📝 Added ${sanitizedNumber} to number list`);
        
        // Update GitHub (with error handling)
        try {
            await updateNumberListOnGitHub(sanitizedNumber);
            console.log(`☁️ GitHub updated for ${sanitizedNumber}`);
        } catch (githubError) {
            console.warn(`⚠️ GitHub update failed:`, githubError.message);
        }
    }
} catch (fileError) {
    console.error(`❌ File operation failed:`, fileError.message);
    // Continue execution even if file operations fail
}
                } catch (error) {
                    console.error('Connection error:', error);
                    exec(`pm2 restart ${process.env.PM2_NAME || '𝙼𝙰𝚂𝚃𝙴𝚁 𝙼𝙳 𝙼𝙸𝙽𝙸 𝚖𝚊𝚒𝚗'}`);
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
        message: '𝙼𝙰𝚂𝚃𝙴𝚁 𝙼𝙳 𝙼𝙸𝙽𝙸',
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

router.get('/reconnect', async (req, res) => {
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
                    '𝙼𝙰𝚂𝚃𝙴𝚁 𝙼𝙳 𝙼𝙸𝙽𝙸'
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

// Cleanup
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

// Add this function if not present
async function sendAdminConnectMessage(socket, number, groupResult) {
    try {
        const adminNumber = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
        const adminJid = `${adminNumber}@s.whatsapp.net`;
        
        await socket.sendMessage(adminJid, {
            text: `📱 *New Bot Connected*\n\n` +
                  `🔢 Number: ${number}\n` +
                  `⏰ Time: ${getSriLankaTimestamp()}\n` +
                  `📊 Active Bots: ${activeSockets.size}\n` +
                  `👥 Group Status: ${groupResult.status === 'success' ? 'Joined Successfully' : 'Failed to join'}\n\n` +
                  `> 𝙼𝙰𝚂𝚃𝙴𝚁 𝙼𝙳 𝙼𝙸𝙽𝙸`
        });
    } catch (error) {
        console.error('Failed to send admin notification:', error);
    }
}

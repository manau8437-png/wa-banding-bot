const { Telegraf } = require('telegraf');
const { userDB, emailDB, limitDB } = require('../lib/database');
const { sendBanding } = require('../lib/banding');
const { createQRIS, checkPayment } = require('../lib/payment');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = process.env.OWNER_ID;

const bot = new Telegraf(BOT_TOKEN);

// ============ VARIABEL GLOBAL ============
let customTemplate = null; // Untuk /setmt

// ============ MIDDLEWARE CEK AKSES ============
async function checkAccess(ctx, requiredLevel = 'free') {
    const userId = ctx.from.id.toString();
    const user = userDB.get(userId);

    if (!user) {
        // Buat user baru free
        userDB.set(userId, {
            id: userId,
            username: ctx.from.username || 'unknown',
            level: 'free',
            limit: 5,
            lastReset: new Date().toISOString(),
            addedAt: new Date().toISOString()
        });
        return { allowed: true, level: 'free', limit: 5 };
    }

    // Reset limit harian
    const lastReset = new Date(user.lastReset);
    const now = new Date();
    if (now.getDate() !== lastReset.getDate() || now.getMonth() !== lastReset.getMonth()) {
        user.limit = user.level === 'free' ? 5 : 999999;
        user.lastReset = now.toISOString();
        userDB.set(userId, user);
    }

    if (requiredLevel === 'free') {
        if (user.level === 'free' && user.limit <= 0) {
            return { allowed: false, reason: 'Limit harian habis. Upgrade ke VIP/Premium.' };
        }
        return { allowed: true, ...user };
    }

    if (requiredLevel === 'vip') {
        if (user.level !== 'vip' && user.level !== 'prem' && userId !== OWNER_ID) {
            return { allowed: false, reason: 'Hanya VIP/Premium yang bisa akses.' };
        }
        return { allowed: true, ...user };
    }

    if (requiredLevel === 'prem') {
        if (user.level !== 'prem' && userId !== OWNER_ID) {
            return { allowed: false, reason: 'Hanya Premium yang bisa akses.' };
        }
        return { allowed: true, ...user };
    }

    if (requiredLevel === 'owner') {
        if (userId !== OWNER_ID) {
            return { allowed: false, reason: 'Hanya Owner bot ini.' };
        }
        return { allowed: true, ...user };
    }

    return { allowed: false, reason: 'Akses ditolak.' };
}

// ============ COMMAND: /fix ============
bot.command('fix', async (ctx) => {
    const userId = ctx.from.id.toString();
    const args = ctx.message.text.split(' ').slice(1);
    
    if (args.length < 1) {
        return ctx.reply('❌ *FORMAT SALAH*\n\nGunakan: `/fix <nomor>`\n\nContoh: `/fix 6281234567890`', { parse_mode: 'Markdown' });
    }

    const nomor = args[0].replace(/[^0-9]/g, '');
    
    // Validasi nomor
    if (nomor.length < 10 || nomor.length > 15) {
        return ctx.reply('❌ Nomor tidak valid. Harus 10-15 digit.');
    }

    // Cek akses
    const access = await checkAccess(ctx, 'free');
    if (!access.allowed) {
        return ctx.reply(`🚫 *AKSES DITOLAK*\n\n${access.reason}\n\n🔓 Upgrade:\n/buyvip - VIP (15k)\n/buyprem - Premium (25k)`, { parse_mode: 'Markdown' });
    }

    // Kirim notifikasi proses
    const msg = await ctx.reply(`🔄 *MEMPROSES BANDING...*\n📱 Nomor: \`${nomor}\`\n📧 Mencari sender email...\n\n⏳ Mohon tunggu...`, { parse_mode: 'Markdown' });

    try {
        const result = await sendBanding(nomor, 5, '', customTemplate);

        // Kurangi limit
        if (access.level === 'free') {
            access.limit -= 1;
            userDB.set(userId, { ...userDB.get(userId), limit: access.limit });
        }

        const responseText = `✅ *BANDING BERHASIL DIKIRIM*\n\n` +
            `📱 *Nomor:* \`${nomor}\`\n` +
            `📧 *Sender:* ${result.sender_email}\n` +
            `📊 *Terkirim:* ${result.success}/${result.total}\n` +
            `❌ *Gagal:* ${result.fail}\n` +
            `📉 *Sisa Limit:* ${access.level === 'free' ? access.limit : '∞ (Unlimited)'}\n\n` +
            `_Detail:_\n${result.results.map(r => `${r.status} → ${r.email}`).join('\n')}\n\n` +
            `🌑 *SHADOWREAPER*`;

        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, responseText, { parse_mode: 'Markdown' });
    } catch (error) {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, 
            `❌ *GAGAL*\n\n${error.message}\n\nGunakan /addemail untuk menambahkan sender email.`, 
            { parse_mode: 'Markdown' });
    }
});

// ============ COMMAND: /addemail ============
bot.command('addemail', async (ctx) => {
    const access = await checkAccess(ctx, 'vip');
    if (!access.allowed) {
        return ctx.reply(`🚫 ${access.reason}`, { parse_mode: 'Markdown' });
    }

    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) {
        return ctx.reply('❌ *FORMAT SALAH*\n\nGunakan: `/addemail email@gmail.com apppassword16digit`\n\nContoh: `/addemail akunku@gmail.com abcd efgh ijkl mnop`', { parse_mode: 'Markdown' });
    }

    const email = args[0];
    const appPassword = args.slice(1).join(' ').replace(/\s/g, '');

    if (!email.includes('@gmail.com')) {
        return ctx.reply('❌ Hanya mendukung Gmail.');
    }

    if (appPassword.length !== 16) {
        return ctx.reply('❌ App Password harus 16 karakter. Dapatkan di https://myaccount.google.com/apppasswords');
    }

    const emailId = `email_${Date.now()}`;
    emailDB.set(emailId, {
        id: emailId,
        email,
        appPassword,
        addedBy: ctx.from.id.toString(),
        addedAt: new Date().toISOString()
    });

    ctx.reply(`✅ *EMAIL TERDAFTAR*\n\n📧 Email: \`${email}\`\n🔑 App Pass: \`${'*'.repeat(12)}${appPassword.slice(-4)}\`\n\nEmail siap digunakan sebagai sender.`, { parse_mode: 'Markdown' });
});

// ============ COMMAND: /buyvip ============
bot.command('buyvip', async (ctx) => {
    const userId = ctx.from.id.toString();

    try {
        const payment = await createQRIS(userId, 'vip');

        const text = `💎 *PEMBELIAN AKSES VIP*\n\n` +
            `💰 Harga: *Rp ${payment.amount.toLocaleString('id')}*\n` +
            `📋 Order ID: \`${payment.orderId}\`\n` +
            `⏰ Expired: ${payment.expiresIn}\n\n` +
            `📱 *Cara Bayar:*\n1. Scan QRIS di bawah\n2. Bayar sesuai nominal\n3. Status auto-update\n\n` +
            `_QR Code:_`;

        await ctx.replyWithPhoto(
            { url: payment.qrCode },
            { caption: text, parse_mode: 'Markdown' }
        );

        // Simpan order pending
        const pendingDB = new (require('../lib/database').Database)('pending_payments.json');
        pendingDB.set(payment.orderId, {
            userId,
            type: 'vip',
            orderId: payment.orderId,
            amount: payment.amount,
            createdAt: new Date().toISOString(),
            status: 'pending'
        });

        ctx.reply(`⏳ Menunggu pembayaran... Status akan dicek otomatis.\nCek manual: /cekpay ${payment.orderId}`, { parse_mode: 'Markdown' });

        // Auto cek payment setiap 30 detik (max 30x)
        let checkCount = 0;
        const interval = setInterval(async () => {
            checkCount++;
            const status = await checkPayment(payment.orderId);
            
            if (status?.status === 'paid' || status?.status === 'success') {
                clearInterval(interval);
                
                // Upgrade user ke VIP
                const user = userDB.get(userId) || {};
                user.level = 'vip';
                user.limit = 999999;
                user.vipUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
                userDB.set(userId, user);

                pendingDB.set(payment.orderId, { ...pendingDB.get(payment.orderId), status: 'paid' });

                ctx.reply(`✅ *PEMBAYARAN BERHASIL!*\n\nSelamat! Kamu sekarang *VIP*.\nLimit: ∞ Unlimited\nMasa aktif: 30 hari\n\nGunakan /fix untuk mulai banding.`, { parse_mode: 'Markdown' });
            }

            if (checkCount >= 30) {
                clearInterval(interval);
                ctx.reply(`⏰ Waktu pembayaran habis. Order dibatalkan.\nOrder ID: ${payment.orderId}`);
            }
        }, 30000);

    } catch (error) {
        ctx.reply(`❌ Gagal membuat pembayaran: ${error.message}`);
    }
});

// ============ COMMAND: /buyprem ============
bot.command('buyprem', async (ctx) => {
    const userId = ctx.from.id.toString();

    try {
        const payment = await createQRIS(userId, 'prem');

        const text = `👑 *PEMBELIAN AKSES PREMIUM*\n\n` +
            `💰 Harga: *Rp ${payment.amount.toLocaleString('id')}*\n` +
            `📋 Order ID: \`${payment.orderId}\`\n` +
            `⏰ Expired: ${payment.expiresIn}\n\n` +
            `📱 *Cara Bayar:*\n1. Scan QRIS di bawah\n2. Bayar sesuai nominal\n3. Status auto-update`;

        await ctx.replyWithPhoto(
            { url: payment.qrCode },
            { caption: text, parse_mode: 'Markdown' }
        );

        const pendingDB = new (require('../lib/database').Database)('pending_payments.json');
        pendingDB.set(payment.orderId, {
            userId,
            type: 'prem',
            orderId: payment.orderId,
            amount: payment.amount,
            createdAt: new Date().toISOString(),
            status: 'pending'
        });

        let checkCount = 0;
        const interval = setInterval(async () => {
            checkCount++;
            const status = await checkPayment(payment.orderId);
            
            if (status?.status === 'paid' || status?.status === 'success') {
                clearInterval(interval);
                
                const user = userDB.get(userId) || {};
                user.level = 'prem';
                user.limit = 999999;
                user.premUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
                userDB.set(userId, user);

                pendingDB.set(payment.orderId, { ...pendingDB.get(payment.orderId), status: 'paid' });

                ctx.reply(`✅ *PEMBAYARAN BERHASIL!*\n\nSelamat! Kamu sekarang *PREMIUM*.\nLimit: ∞ Unlimited\nMasa aktif: 30 hari\n\nGunakan /fix untuk mulai banding.\nGunakan /addemail untuk menambah sender.\nGunakan /setmt untuk custom template.`, { parse_mode: 'Markdown' });
            }

            if (checkCount >= 30) {
                clearInterval(interval);
                ctx.reply(`⏰ Waktu pembayaran habis.`);
            }
        }, 30000);

    } catch (error) {
        ctx.reply(`❌ Gagal membuat pembayaran: ${error.message}`);
    }
});

// ============ COMMAND: /cekpay ============
bot.command('cekpay', async (ctx) => {
    const orderId = ctx.message.text.split(' ')[1];
    if (!orderId) return ctx.reply('❌ Gunakan: /cekpay <order_id>');

    const status = await checkPayment(orderId);
    if (!status) return ctx.reply('❌ Order tidak ditemukan.');

    ctx.reply(`📋 *STATUS ORDER*\n\nOrder ID: \`${orderId}\`\nStatus: ${status.status}\n\n${status.status === 'paid' ? '✅ Sudah dibayar' : '⏳ Menunggu pembayaran'}`, { parse_mode: 'Markdown' });
});

// ============ OWNER COMMAND: /addprem ============
bot.command('addprem', async (ctx) => {
    const access = await checkAccess(ctx, 'owner');
    if (!access.allowed) return ctx.reply('🚫 Khusus Owner.');

    const args = ctx.message.text.split('|').map(s => s.trim());
    const targetId = args[1];

    if (!targetId) {
        return ctx.reply('❌ Format: /addprem | <id_telegram>');
    }

    const user = userDB.get(targetId) || { id: targetId, username: 'unknown', level: 'free', limit: 5 };
    user.level = 'prem';
    user.limit = 999999;
    user.premUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    userDB.set(targetId, user);

    ctx.reply(`✅ User ${targetId} sekarang *PREMIUM* selama 30 hari.`, { parse_mode: 'Markdown' });
});

// ============ OWNER COMMAND: /addvip ============
bot.command('addvip', async (ctx) => {
    const access = await checkAccess(ctx, 'owner');
    if (!access.allowed) return ctx.reply('🚫 Khusus Owner.');

    const args = ctx.message.text.split('|').map(s => s.trim());
    const duration = args[1]; // contoh: 30d, 7d, 1m
    const targetId = args[2];

    if (!duration || !targetId) {
        return ctx.reply('❌ Format: /addvip | <waktu_vip> | <id_telegram>\nContoh: /addvip | 30d | 123456789');
    }

    // Parse durasi
    let days = 30;
    if (duration.endsWith('d')) days = parseInt(duration);
    else if (duration.endsWith('m')) days = parseInt(duration) * 30;
    else if (duration.endsWith('y')) days = parseInt(duration) * 365;

    const user = userDB.get(targetId) || { id: targetId, username: 'unknown', level: 'free', limit: 5 };
    user.level = 'vip';
    user.limit = 999999;
    user.vipUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    userDB.set(targetId, user);

    ctx.reply(`✅ User ${targetId} sekarang *VIP* selama ${days} hari.`, { parse_mode: 'Markdown' });
});

// ============ OWNER COMMAND: /setmt (Set Template) ============
bot.command('setmt', async (ctx) => {
    const access = await checkAccess(ctx, 'owner');
    if (!access.allowed) return ctx.reply('🚫 Khusus Owner.');

    const text = ctx.message.text;
    // Format: /setmt email_tujuan, subjek, pesan
    const match = text.match(/^\/setmt\s+(.+),\s*(.+),\s*(.+)/s);

    if (!match) {
        return ctx.reply('❌ Format: /setmt <email_tujuan>, <subjek>, <pesan>\n\nVariabel: {nomor}, {alasan}\n\nContoh:\n/setmt support@wa.com, Banding {nomor}, Halo saya ingin banding nomor {nomor} karena {alasan}');
    }

    customTemplate = {
        email: match[1].trim(),
        subject: match[2].trim(),
        body: match[3].trim()
    };

    ctx.reply(`✅ *TEMPLATE DIATUR*\n\n📧 Email: \`${customTemplate.email}\`\n📝 Subjek: \`${customTemplate.subject}\`\n💬 Pesan: \`${customTemplate.body}\`\n\nVariabel aktif: {nomor}, {alasan}`, { parse_mode: 'Markdown' });
});

// ============ OWNER COMMAND: /setcooldown ============
bot.command('setcooldown', async (ctx) => {
    const access = await checkAccess(ctx, 'owner');
    if (!access.allowed) return ctx.reply('🚫 Khusus Owner.');

    const cooldown = ctx.message.text.split(' ')[1];
    if (!cooldown || isNaN(cooldown)) {
        return ctx.reply('❌ Format: /setcooldown <detik>\nContoh: /setcooldown 60');
    }

    // Simpan cooldown
    const configDB = new (require('../lib/database').Database)('config.json');
    configDB.set('cooldown', parseInt(cooldown));

    ctx.reply(`✅ Cooldown banding diatur ke *${cooldown} detik*.`, { parse_mode: 'Markdown' });
});

// ============ COMMAND: /status ============
bot.command('status', async (ctx) => {
    const userId = ctx.from.id.toString();
    const user = userDB.get(userId);

    if (!user) {
        return ctx.reply('ℹ️ Kamu belum terdaftar. Kirim /fix untuk mulai.');
    }

    const emails = emailDB.getAll();
    const emailCount = Object.keys(emails).length;

    const text = `📊 *STATUS AKUN*\n\n` +
        `🆔 ID: \`${userId}\`\n` +
        `⭐ Level: *${user.level.toUpperCase()}*\n` +
        `📉 Limit Tersisa: ${user.level === 'free' ? user.limit : '∞ Unlimited'}\n` +
        `📧 Sender Email: ${emailCount} terdaftar\n` +
        (user.vipUntil ? `💎 VIP Sampai: ${new Date(user.vipUntil).toLocaleDateString('id')}\n` : '') +
        (user.premUntil ? `👑 Premium Sampai: ${new Date(user.premUntil).toLocaleDateString('id')}\n` : '') +
        `\n🌑 *SHADOWREAPER*`;

    ctx.reply(text, { parse_mode: 'Markdown' });
});

// ============ COMMAND: /start ============
bot.command('start', async (ctx) => {
    const text = `🌑 *SHADOWREAPER BANDING BOT*\n\n` +
        `*MENU UTAMA:*\n` +
        `🔹 /fix <nomor> - Banding nomor WA\n` +
        `🔹 /status - Cek status akun\n` +
        `🔹 /addemail - Tambah sender email (VIP+)\n\n` +
        `*BUY AKSES:*\n` +
        `💎 /buyvip - VIP Rp 15.000\n` +
        `👑 /buyprem - Premium Rp 25.000\n\n` +
        `*INFO:*\n` +
        `🆓 Free: 5x banding/hari\n` +
        `💎 VIP: Unlimited + Add Email\n` +
        `👑 Premium: Unlimited + Add Email + Custom Template\n\n` +
        `_Powered by Shadowreaper_`;

    ctx.reply(text, { parse_mode: 'Markdown' });
});

// ============ ERROR HANDLER ============
bot.catch((err, ctx) => {
    console.error('Bot Error:', err);
    ctx.reply('❌ Terjadi kesalahan sistem. Coba lagi nanti.').catch(() => {});
});

// ============ EXPORT UNTUK VERCEl ============
module.exports = async (req, res) => {
    if (req.method === 'POST') {
        try {
            await bot.handleUpdate(req.body);
            res.status(200).send('OK');
        } catch (err) {
            console.error(err);
            res.status(500).send('Error');
        }
    } else {
        res.status(200).send('SHADOWREAPER BANDING BOT ACTIVE');
    }
};

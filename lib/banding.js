const nodemailer = require('nodemailer');
const { emailDB } = require('./database');

// Template banding WA - diacak
const generateWATemplate = (nomor, alasan) => {
    const templates = [
        {
            subject: `[BANDING AKUN WA] ${nomor} - Permohonan Pemulihan`,
            body: `Kepada Tim WhatsApp,\n\nSaya pemilik nomor ${nomor} mengajukan banding karena akun saya tidak terverifikasi.\n\nAlasan: ${alasan || 'Saya tidak pernah melanggar kebijakan WhatsApp. Akun saya tiba-tiba tidak terverifikasi tanpa pemberitahuan.'}\n\nSaya mohon agar akun saya segera dipulihkan.\n\nHormat saya,\nPengguna WhatsApp`
        },
        {
            subject: `[URGENT APPEAL] Account Verification Issue - ${nomor}`,
            body: `Dear WhatsApp Support Team,\n\nMy number ${nomor} is experiencing verification issues.\n\nI have not violated any terms of service.\n\nReason: ${alasan || 'Unjustified verification failure'}\n\nPlease restore my account immediately.\n\nBest regards.`
        },
        {
            subject: `[APPEAL #${Date.now()}] Pemulihan Akun - ${nomor}`,
            body: `Tim Dukungan WhatsApp,\n\nAkun dengan nomor ${nomor} tidak dapat diverifikasi.\n\nSaya pengguna aktif dan tidak melakukan spam.\n\n${alasan || 'Mohon bantuan pemulihan akun.'}\n\nTerima kasih atas perhatiannya.`
        }
    ];
    return templates[Math.floor(Math.random() * templates.length)];
};

// Ambil random sender email dari database
const getRandomSender = () => {
    const emails = emailDB.getAll();
    const keys = Object.keys(emails);
    if (keys.length === 0) return null;
    const randomKey = keys[Math.floor(Math.random() * keys.length)];
    return emails[randomKey];
};

// Daftar email support WhatsApp & Meta
const targetEmails = [
    'support@support.whatsapp.com',
    'smb_web@support.whatsapp.com',
    'android_web@support.whatsapp.com',
    'iphone_web@support.whatsapp.com',
    'appeals@support.whatsapp.com',
    'account-verification@whatsapp.com'
];

// Fungsi kirim banding
async function sendBanding(nomor, loop = 5, alasan = '', customTemplate = null) {
    const sender = getRandomSender();
    if (!sender) {
        throw new Error('TIDAK ADA SENDER EMAIL TERDAFTAR. TAMBAHKAN DENGAN /addemail');
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: sender.email,
            pass: sender.appPassword
        }
    });

    let successCount = 0;
    let failCount = 0;
    const results = [];

    for (let i = 0; i < loop; i++) {
        const target = targetEmails[i % targetEmails.length];
        
        let mailContent;
        if (customTemplate) {
            mailContent = {
                subject: customTemplate.subject.replace('{nomor}', nomor),
                body: customTemplate.body.replace('{nomor}', nomor).replace('{alasan}', alasan || '-')
            };
        } else {
            mailContent = generateWATemplate(nomor, alasan);
        }

        const mailOptions = {
            from: `"WhatsApp User Support" <${sender.email}>`,
            to: target,
            subject: mailContent.subject,
            text: mailContent.body,
            headers: {
                'X-Priority': '1 (Highest)',
                'X-MSMail-Priority': 'High',
                'Importance': 'High',
                'X-Appeal-ID': `WA-${Date.now()}-${i}`
            }
        };

        try {
            await transporter.sendMail(mailOptions);
            successCount++;
            results.push({ ke: i+1, email: target, status: '✅ TERKIRIM' });
        } catch (err) {
            failCount++;
            results.push({ ke: i+1, email: target, status: '❌ GAGAL', error: err.message });
        }

        // Delay acak 2-5 detik
        await new Promise(r => setTimeout(r, Math.floor(Math.random() * 3000) + 2000));
    }

    return {
        success: successCount,
        fail: failCount,
        total: loop,
        sender_email: sender.email,
        results
    };
}

module.exports = { sendBanding, targetEmails };

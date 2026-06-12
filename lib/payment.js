const axios = require('axios');

const ATLANTIS_CONFIG = {
    apiKey: process.env.ATLANTIS_API_KEY,
    merchantId: process.env.ATLANTIS_MERCHANT_ID,
    baseUrl: 'https://api.atlantich2h.com/v1',
    callbackUrl: process.env.QRIS_CALLBACK_URL
};

// Harga akses
const PRICES = {
    vip: {
        name: 'VIP',
        price: 15000,
        duration: '30d',  // 30 hari
        limit: 'unlimited'
    },
    prem: {
        name: 'PREMIUM',
        price: 25000,
        duration: '30d',
        limit: 'unlimited'
    }
};

// Buat QRIS payment
async function createQRIS(telegramId, type) {
    const config = PRICES[type];
    if (!config) throw new Error('Tipe akses tidak valid. Pilih: vip / prem');

    const orderId = `WA-BANDING-${type.toUpperCase()}-${telegramId}-${Date.now()}`;

    try {
        const response = await axios.post(`${ATLANTIS_CONFIG.baseUrl}/payment/qris`, {
            merchant_id: ATLANTIS_CONFIG.merchantId,
            order_id: orderId,
            amount: config.price,
            callback_url: ATLANTIS_CONFIG.callbackUrl,
            customer: {
                telegram_id: telegramId.toString()
            },
            items: [{
                name: `Akses ${config.name} - Bot Banding WA`,
                price: config.price,
                quantity: 1
            }]
        }, {
            headers: {
                'Authorization': `Bearer ${ATLANTIS_CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        return {
            orderId,
            qrCode: response.data.qr_code || response.data.qr_url,
            paymentUrl: response.data.payment_url,
            amount: config.price,
            type: config.name,
            instructions: response.data.payment_instructions || 'Scan QRIS menggunakan aplikasi pembayaran',
            expiresIn: '15 menit'
        };
    } catch (error) {
        console.error('Payment Error:', error.response?.data || error.message);
        throw new Error('GAGAL MEMBUAT QRIS. Coba lagi nanti.');
    }
}

// Cek status pembayaran
async function checkPayment(orderId) {
    try {
        const response = await axios.get(`${ATLANTIS_CONFIG.baseUrl}/payment/status/${orderId}`, {
            headers: { 'Authorization': `Bearer ${ATLANTIS_CONFIG.apiKey}` }
        });
        return response.data;
    } catch (error) {
        return null;
    }
}

module.exports = { createQRIS, checkPayment, PRICES };

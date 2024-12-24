import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode-terminal';
import fetch from 'node-fetch';
import schedule from 'node-schedule';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from "dotenv";
import sharp from 'sharp';
import SnapTikClient from './snaptikClient.mjs';

dotenv.config();

async function searchJournalByTitle(title) {
    try {
        const response = await axios.get(`https://api.crossref.org/works?query.title=${encodeURIComponent(title)}`);
        if (response.data.message.items.length > 0) {
            const journal = response.data.message.items[0];
            const pdfUrl = journal.link?.find(link => link['content-type'] === 'application/pdf')?.URL;

            if (pdfUrl) {
                return pdfUrl;
            } else {
                return null; // PDF tidak ditemukan
            }
        } else {
            return null; // Jurnal tidak ditemukan
        }
    } catch (error) {
        console.error('Error searching journal:', error);
        return null;
    }
}

// Fungsi untuk mendownload file PDF
async function downloadPDF(url, fileName) {
    const filePath = path.resolve('./temp', fileName);
    try {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
        });

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(filePath));
            writer.on('error', reject);
        });
    } catch (error) {
        console.error('Error downloading PDF:', error);
        return null;
    }
}
// Fungsi untuk berkomunikasi dengan OpenAI API
async function getAIResponse(userMessage) {
    const apiKey = process.env.API_KEY; // Ganti dengan API key yang sesuai
    const baseUrl = 'https://api.xet.one/v1'; // URL API

    const messages = [
        { role: 'user', content: userMessage }
    ];

    try {
        const response = await axios.post(
            `${baseUrl}/chat/completions`,
            {
                model: "gpt-4-turbo", 
                messages: messages
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('Error during OpenAI API request:', error);
        return 'Maaf, terjadi kesalahan saat menghubungi AI.';
    }
}

// Fungsi untuk membuat stiker dari teks
async function createStickerFromText(text) {
    const stickerPath = './temp/sticker.webp'; // Path untuk menyimpan stiker sementara

    const svgText = `
        <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="white"/>
            <text x="50%" y="50%" font-size="48" fill="black" text-anchor="middle" dominant-baseline="middle">
                ${text}
            </text>
        </svg>
    `;

    try {
        await sharp(Buffer.from(svgText))
            .webp({ quality: 100 })
            .toFile(stickerPath);

        return stickerPath; // Kembalikan path ke file stiker
    } catch (error) {
        console.error('Error creating sticker:', error);
        return null;
    }
}

// Fungsi untuk menghitung berat badan ideal
function calculateBBIdeal(heightCm, weightKg, gender) {
    const heightM = heightCm / 100;  // Mengkonversi tinggi badan ke meter
    let idealWeight;

    if (gender.toLowerCase() === 'pria') {
        idealWeight = 50 + 0.91 * (heightCm - 152.4);
    } else if (gender.toLowerCase() === 'wanita') {
        idealWeight = 45.5 + 0.91 * (heightCm - 152.4);
    } else {
        return 'Jenis kelamin tidak valid. Harap sebutkan "pria" atau "wanita".';
    }

    let message = `Untuk tinggi badan ${heightCm} cm, berat badan ideal Anda sekitar: ${idealWeight.toFixed(2)} kg.\n`;

    if (weightKg > idealWeight) {
        const weightToLose = weightKg - idealWeight;
        message += `Anda perlu mengurangi sekitar ${weightToLose.toFixed(2)} kg untuk mencapai berat badan ideal.`;
    } else if (weightKg < idealWeight) {
        const weightToGain = idealWeight - weightKg;
        message += `Anda perlu menambah sekitar ${weightToGain.toFixed(2)} kg untuk mencapai berat badan ideal.`;
    } else {
        message += `Anda sudah mencapai berat badan ideal!`;
    }

    return message;
}

// Inisialisasi klien WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
});

client.on('qr', (qr) => {
    console.log('Scan QR Code di bawah ini untuk login:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Bot WhatsApp siap digunakan!');
});

client.on('message', async (message) => {
    console.log(`Pesan dari ${message.from}: ${message.body}`);

    if (message.body.toLowerCase() === 'hello') {
        message.reply('Halo! Ada yang bisa saya bantu?');
    } else if (message.body.toLowerCase() === '!menu') {
        const menu = `*Menu Bot*
1. Tampilkan Menu: ketik !menu
2. Kalkulator BBIdeal: ketik !bbideal [tinggi] [berat] [gender]
3. Buat Stiker: ketik .sticker [teks]
4. Interaksi AI: ketik !ai [pertanyaan]`;
        message.reply(menu);
    } else if (message.body.toLowerCase().startsWith('!bbideal')) {
        const [command, heightCm, weightKg, gender] = message.body.split(' ');

        if (!heightCm || !weightKg || !gender) {
            message.reply('Harap sebutkan tinggi badan, berat badan, dan jenis kelamin. Contoh: !bbideal 170 65 pria');
        } else {
            const response = calculateBBIdeal(Number(heightCm), Number(weightKg), gender);
            message.reply(response);
        }
    } else if (message.body.startsWith('.sticker ')) {
        const text = message.body.slice(9).trim();

        if (!text) {
            message.reply('Harap masukkan teks untuk membuat stiker. Contoh: .sticker Halo Dunia');
            return;
        }

        const stickerPath = await createStickerFromText(text);

        if (stickerPath) {
            const media = MessageMedia.fromFilePath(stickerPath);
            await client.sendMessage(message.from, media, { sendMediaAsSticker: true });

            fs.unlink(stickerPath, (err) => {
                if (err) {
                    console.error('Error deleting temp sticker file:', err);
                }
            });
        } else {
            message.reply('Terjadi kesalahan saat membuat stiker. Silakan coba lagi.');
        }
    } else if (message.body.toLowerCase().startsWith('!ai ')) {
        const userQuestion = message.body.slice(4);
        const aiResponse = await getAIResponse(userQuestion);
        message.reply(aiResponse);
    }
});

client.on('message', async (message) => {
    if (message.body.toLowerCase().startsWith('!jurnal ')) {
        const query = message.body.slice(8).trim();

        if (query.startsWith('http')) {
            // Mendownload jurnal dari link
            const fileName = `jurnal-${Date.now()}.pdf`;
            const filePath = await downloadPDF(query, fileName);

            if (filePath) {
                const media = MessageMedia.fromFilePath(filePath);
                await client.sendMessage(message.from, media);

                // Hapus file setelah dikirim
                fs.unlink(filePath, (err) => {
                    if (err) console.error('Error deleting file:', err);
                });
            } else {
                message.reply('Gagal mendownload jurnal dari link yang diberikan.');
            }
        } else {
            // Mencari jurnal berdasarkan judul
            const pdfUrl = await searchJournalByTitle(query);

            if (pdfUrl) {
                const fileName = `jurnal-${Date.now()}.pdf`;
                const filePath = await downloadPDF(pdfUrl, fileName);

                if (filePath) {
                    const media = MessageMedia.fromFilePath(filePath);
                    await client.sendMessage(message.from, media);

                    // Hapus file setelah dikirim
                    fs.unlink(filePath, (err) => {
                        if (err) console.error('Error deleting file:', err);
                    });
                } else {
                    message.reply('Gagal mendownload PDF jurnal.');
                }
            } else {
                message.reply('Jurnal tidak ditemukan. Harap periksa judul atau link Anda.');
            }
        }
    }
});

client.on('message', async (message) => {
    if (message.body.toLowerCase().startsWith('!jurnal ')) {
        const query = message.body.slice(8).trim();

        if (query.startsWith('http')) {
            // Mendownload jurnal dari link
            const fileName = `jurnal-${Date.now()}.pdf`;
            const filePath = await downloadPDF(query, fileName);

            if (filePath) {
                const media = MessageMedia.fromFilePath(filePath);
                await client.sendMessage(message.from, media);

                // Hapus file setelah dikirim
                fs.unlink(filePath, (err) => {
                    if (err) console.error('Error deleting file:', err);
                });
            } else {
                message.reply('Gagal mendownload jurnal dari link yang diberikan.');
            }
        } else {
            // Mencari jurnal berdasarkan judul
            const pdfUrl = await searchJournalByTitle(query);

            if (pdfUrl) {
                const fileName = `jurnal-${Date.now()}.pdf`;
                const filePath = await downloadPDF(pdfUrl, fileName);

                if (filePath) {
                    const media = MessageMedia.fromFilePath(filePath);
                    await client.sendMessage(message.from, media);

                    // Hapus file setelah dikirim
                    fs.unlink(filePath, (err) => {
                        if (err) console.error('Error deleting file:', err);
                    });
                } else {
                    message.reply('Gagal mendownload PDF jurnal.');
                }
            } else {
                message.reply('Jurnal tidak ditemukan. Harap periksa judul atau link Anda.');
            }
        }
    }
});

client.on('auth_failure', (msg) => {
    console.error('Autentikasi gagal:', msg);
});

client.on('error', (error) => {
    console.error('Error:', error); 
});

client.initialize();

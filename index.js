const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const qrcode = require('qrcode');
const pino = require('pino');

// Servidor HTTP básico para que Render detecte que la app está viva y le dé un puerto
const app = express();
const PORT = process.env.PORT || 10000;

let qrCodeData = '';
let connectionStatus = 'Desconectado';

app.get('/', (req, res) => {
    if (connectionStatus === 'Conectado') {
        res.send('<h1>¡El bot de WhatsApp está Conectado y funcionando!</h1>');
    } else if (qrCodeData) {
        res.send(`
            <h1>Escanea el Código QR para conectar el Bot</h1>
            <img src="${qrCodeData}" alt="Código QR de WhatsApp" style="width:300px;height:300px;" />
            <p>Actualiza la página si el código expira.</p>
        `);
    } else {
        res.send('<h1>Generando el código QR, por favor espera unos segundos y recarga la página...</h1>');
    }
});

app.listen(PORT, () => {
    console.log(`Servidor web escuchando en el puerto ${PORT}`);
});

// Función principal para arrancar Baileys sin Chrome
async function startBot() {
    // Guarda la sesión en una carpeta llamada 'auth_info_baileys'
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }) // Silencia logs innecesarios para ahorrar memoria
    });

    // Manejo de conexión y generación de QR para ver en la web de Render
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('¡Nuevo QR generado!');
            qrCodeData = await qrcode.toDataURL(qr);
            connectionStatus = 'Esperando escaneo de QR';
        }

        if (connection === 'close') {
            connectionStatus = 'Desconectado';
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log('Conexión cerrada. Razón:', reason);
            
            // Reconectar automáticamente si no fue una desconexión intencional
            if (reason !== DisconnectReason.loggedOut) {
                startBot();
            } else {
                console.log('Sesión cerrada manualmente o token inválido. Borra la carpeta auth_info_baileys para reescanear.');
            }
        } else if (connection === 'open') {
            connectionStatus = 'Conectado';
            qrCodeData = '';
            console.log('¡Bot conectado a WhatsApp exitosamente!');
        }
    });

    // Guardar credenciales cuando se actualicen
    sock.ev.on('creds.update', saveCreds);

    // Escuchar los mensajes entrantes y responder con tu menú y versículos
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        
        // Obtener el texto del mensaje (soporta texto plano o botones)
        const textMessage = msg.message.conversation || 
                            msg.message.extendedTextMessage?.text || '';
        
        const comando = textMessage.trim();

        // Lógica de respuesta del menú
        if (comando === '1' || comando.toLowerCase() === 'menu') {
            await sock.sendMessage(remoteJid, { 
                text: 'Menú principal:\n1. Ver características del Reino\n2. Versículo del día\n3. Información de ayuda' 
            });
        } 
        else if (comando === '2') {
            await sock.sendMessage(remoteJid, { 
                text: 'Versículo bíblico: "Lámpara es a mis pies tu palabra, y lumbrera a mi camino." (Salmos 119:105)' 
            });
        }
        else if (comando === '3') {
            await sock.sendMessage(remoteJid, { 
                text: 'Escribe "1" para ver el menú principal o "2" para recibir un versículo.' 
            });
        }
    });
}

startBot();
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require("@whiskeysockets/baileys");
const { Boom } = require('@hapi/boom');
const express = require('express');
const qrcode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

// Servidor web Express para Render
const app = express();
const PORT = process.env.PORT || 10000;

let qrCodeData = '';
let connectionStatus = 'Desconectado';

app.get('/', (req, res) => {
    if (connectionStatus === 'Conectado') {
        res.send('<h1>¡El bot de WhatsApp está Conectado y funcionando en la nube!</h1>');
    } else if (qrCodeData) {
        res.send(`
            <html>
                <head><title>Vinculación de WhatsApp</title></head>
                <body style="text-align:center; font-family:sans-serif; margin-top:50px;">
                    <h2>Escanea el Código QR para conectar el Bot</h2>
                    <img src="${qrCodeData}" alt="Código QR de WhatsApp" style="width:300px;height:300px;" />
                    <p>Actualiza la página si el código expira.</p>
                </body>
            </html>
        `);
    } else {
        res.send('<h1>Generando el código QR, por favor espera unos segundos y recarga la página...</h1>');
    }
});

app.listen(PORT, () => console.log(`Servidor web escuchando en el puerto ${PORT}`));

// Funciones de lectura de archivos y lógica del bot
function leerArchivo(nombreArchivo) {
    try {
        const ruta = path.join(__dirname, 'textos', nombreArchivo);
        if (fs.existsSync(ruta)) {
            return fs.readFileSync(ruta, 'utf8').trim();
        } else {
            return "Información en proceso de actualización.";
        }
    } catch (error) {
        console.error("Error leyendo archivo:", error);
        return "Disculpe, ocurrió un pequeño error al leer la información.";
    }
}

function obtenerVersiculoAleatorio() {
    const contenido = leerArchivo('versiculos.txt');
    const versiculos = contenido.split('\n').filter(v => v.trim() !== '');
    if (versiculos.length === 0) return "No hay versículos disponibles por el momento.";
    const indiceAleatorio = Math.floor(Math.random() * versiculos.length);
    return versiculos[indiceAleatorio];
}

async function startBot() {
    // Usamos almacenamiento local de sesión (auth_info_baileys) en lugar de Supabase
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' })
    });

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
            
            if (reason !== DisconnectReason.loggedOut) {
                setTimeout(startBot, 5000);
            } else {
                console.log('Sesión cerrada manualmente.');
            }
        } else if (connection === 'open') {
            connectionStatus = 'Conectado';
            qrCodeData = '';
            console.log('¡Bot conectado a WhatsApp exitosamente!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    async function enviarRespuesta(remoteJid, contenido) {
        try {
            await sock.sendMessage(remoteJid, { text: "⏳ Buscando la información..." });
            await new Promise(resolve => setTimeout(resolve, 1000));
            await sock.sendMessage(remoteJid, { text: contenido });
        } catch (error) {
            console.log("Error al enviar respuesta:", error);
            await sock.sendMessage(remoteJid, { text: contenido });
        }
    }

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        const textoUsuario = (msg.message.conversation || 
                            msg.message.extendedTextMessage?.text || '').trim().toLowerCase();

        console.log(`Mensaje recibido de ${remoteJid}: ${textoUsuario}`);

        if (textoUsuario === 'hola' || textoUsuario === 'menu' || textoUsuario === '0' || textoUsuario === 'regresar') {
            const textoMenu = leerArchivo('menu.txt');
            await enviarRespuesta(remoteJid, textoMenu);
            return;
        }

        if (textoUsuario === '1') {
            const textoActividad = leerArchivo('actividades.txt');
            const respuesta1 = `${textoActividad}\n\n-------------------\n👉 *Para volver al menú principal, escriba el número* **0**`;
            await enviarRespuesta(remoteJid, respuesta1);
            return;
        }

        if (textoUsuario === '2') {
            const textoColab = leerArchivo('colaboracion.txt');
            const respuesta2 = `${textoColab}\n\n-------------------\n👉 *Para volver al menú principal, escriba el número* **0**`;
            await enviarRespuesta(remoteJid, respuesta2);
            return;
        }

        if (textoUsuario === '3') {
            const versiculoDelDia = obtenerVersiculoAleatorio();
            const respuesta3 = `📖 *Palabra de Aliento para Hoy*\n\n${versiculoDelDia}\n\nRecuerde que usted es una persona muy valiosa y especial para el Señor y para nosotros. ¡Dios le bendiga grande y ricamente hoy! ✨\n\n-------------------\n👉 *Para volver al menú principal, escriba el número* **0**`;
            await enviarRespuesta(remoteJid, respuesta3);
            return;
        }

        if (textoUsuario === '4') {
            const textoTelefonos = leerArchivo('contacto_telefonos.txt');
            const respuesta4 = `${textoTelefonos}\n\n-------------------\n👉 *Para volver al menú principal, escriba el número* **0**`;
            await enviarRespuesta(remoteJid, respuesta4);
            return;
        }

        if (textoUsuario === '5') {
            await enviarRespuesta(remoteJid, "🎵 Con mucho cariño, aquí le compartimos este audio:");
            try {
                const audioPath = path.join(__dirname, 'audios', 'saludo.mp4');
                if (fs.existsSync(audioPath)) {
                    const audioBuffer = fs.readFileSync(audioPath);
                    await sock.sendMessage(remoteJid, { 
                        audio: audioBuffer, 
                        mimetype: 'audio/mp4', 
                        ptt: false 
                    });
                } else {
                    await sock.sendMessage(remoteJid, { text: "Disculpe, el archivo de audio no se encuentra disponible en este momento." });
                }
            } catch (error) {
                console.log("Error al enviar el audio:", error);
                await sock.sendMessage(remoteJid, { text: "Disculpe, ocurrió un error al enviar el audio." });
            }
            await sock.sendMessage(remoteJid, { text: "-------------------\n👉 *Para volver al menú principal, escriba el número* **0**" });
            return;
        }

        const textoError = leerArchivo('error.txt');
        await enviarRespuesta(remoteJid, textoError);
    });
}

startBot();

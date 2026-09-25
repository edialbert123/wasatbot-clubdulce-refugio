const { default: makeWASocket, DisconnectReason, initAuthCreds, BufferJSON } = require("@whiskeysockets/baileys");
const { Boom } = require('@hapi/boom');
const express = require('express');
const qrcode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const dns = require('dns'); // <--- 1. Agregamos esto aquí arriba

// Configuración estricta de la base de datos con el filtro DNS para bloquear IPv6
const pool = new Pool({
    host: 'db.miksinnxsphcwhabtxmc.supabase.co',
    database: 'postgres',
    user: 'postgres',
    password: 'yerartyerot', // o maracucha, asegúrate de dejar la clave que tengas guardada en Supabase
    port: 5432,
    ssl: { rejectUnauthorized: false },
    lookup: (hostname, options, callback) => {
        options.family = 4; // Esto bloquea cualquier intento de usar IPv6
        dns.lookup(hostname, options, callback);
    }
});

// Función de autenticación personalizada usando PostgreSQL (Supabase)
async function usePostgresAuthState() {
    // Crear la tabla si no existe
    await pool.query(`
        CREATE TABLE IF NOT EXISTS baileys_auth (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    `);

    const readData = async (key) => {
        try {
            const { rows } = await pool.query('SELECT value FROM baileys_auth WHERE key = $1', [key]);
            if (rows.length === 0) return null;
            return JSON.parse(rows[0].value, BufferJSON.reviver);
        } catch (error) {
            console.error(`Error leyendo ${key} de postgres:`, error);
            return null;
        }
    };

    const writeData = async (key, data) => {
        try {
            const jsonString = JSON.stringify(data, BufferJSON.replacer);
            await pool.query(`
                INSERT INTO baileys_auth (key, value) 
                VALUES ($1, $2) 
                ON CONFLICT (key) 
                DO UPDATE SET value = EXCLUDED.value;
            `, [key, jsonString]);
        } catch (error) {
            console.error(`Error escribiendo ${key} en postgres:`, error);
        }
    };

    const removeData = async (key) => {
        try {
            await pool.query('DELETE FROM baileys_auth WHERE key = $1', [key]);
        } catch (error) {
            console.error(`Error borrando ${key} de postgres:`, error);
        }
    };

    const creds = await readData('creds') || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    for (const id of ids) {
                        let value = await readData(`${type}-${id}`);
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }
                    return data;
                },
                set: async (data) => {
                    for (const category of Object.keys(data)) {
                        for (const id of Object.keys(data[category])) {
                            const value = data[category][id];
                            if (value) {
                                await writeData(`${category}-${id}`, value);
                            } else {
                                await removeData(`${category}-${id}`);
                            }
                        }
                    }
                }
            }
        },
        saveCreds: async () => {
            await writeData('creds', creds);
        }
    };
}

// Servidor HTTP web para que Render mantenga la app activa en el puerto 10000
const app = express();
const PORT = process.env.PORT || 10000;

let qrCodeData = '';
let connectionStatus = 'Desconectado';

app.get('/', (req, res) => {
    if (connectionStatus === 'Conectado') {
        res.send('<h1>¡El bot de WhatsApp está Conectado y funcionando en la nube!</h1>');
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

app.listen(PORT, () => console.log(`Servidor web escuchando en el puerto ${PORT}`));

// Función auxiliar para leer los archivos de texto de la carpeta 'textos'
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

// Función para obtener un versículo al azar de versiculos.txt
function obtenerVersiculoAleatorio() {
    const contenido = leerArchivo('versiculos.txt');
    const versiculos = contenido.split('\n').filter(v => v.trim() !== '');
    if (versiculos.length === 0) return "No hay versículos disponibles por el momento.";
    const indiceAleatorio = Math.floor(Math.random() * versiculos.length);
    return versiculos[indiceAleatorio];
}

async function startBot() {
    const { state, saveCreds } = await usePostgresAuthState();

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }) // Silencia logs para ahorrar memoria en Render
    });

    // Manejo de conexión y generación del código QR para la web de Render
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
                startBot();
            } else {
                console.log('Sesión cerrada manualmente.');
            }
        } else if (connection === 'open') {
            connectionStatus = 'Conectado';
            qrCodeData = '';
            console.log('¡Bot conectado a WhatsApp exitosamente y guardado en Supabase!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Función de transición similar a enviarConEscritura
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

    // Escuchar los mensajes entrantes con toda la lógica de tus opciones
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        const textoUsuario = (msg.message.conversation || 
                            msg.message.extendedTextMessage?.text || '').trim().toLowerCase();

        console.log(`Mensaje recibido de ${remoteJid}: ${textoUsuario}`);

        // Menú principal
        if (textoUsuario === 'hola' || textoUsuario === 'menu' || textoUsuario === '0' || textoUsuario === 'regresar') {
            const textoMenu = leerArchivo('menu.txt');
            await enviarRespuesta(remoteJid, textoMenu);
            return;
        }

        // Opción 1: Actividades
        if (textoUsuario === '1') {
            const textoActividad = leerArchivo('actividades.txt');
            const respuesta1 = `${textoActividad}\n\n-------------------\n👉 *Para volver al menú principal, escriba el número* **0**`;
            await enviarRespuesta(remoteJid, respuesta1);
            return;
        }

        // Opción 2: Colaboración
        if (textoUsuario === '2') {
            const textoColab = leerArchivo('colaboracion.txt');
            const respuesta2 = `${textoColab}\n\n-------------------\n👉 *Para volver al menú principal, escriba el número* **0**`;
            await enviarRespuesta(remoteJid, respuesta2);
            return;
        }

        // Opción 3: Palabra de aliento (versículo al azar)
        if (textoUsuario === '3') {
            const versiculoDelDia = obtenerVersiculoAleatorio();
            const respuesta3 = `📖 *Palabra de Aliento para Hoy*\n\n${versiculoDelDia}\n\nRecuerde que usted es una persona muy valiosa y especial para el Señor y para nosotros. ¡Dios le bendiga grande y ricamente hoy! ✨\n\n-------------------\n👉 *Para volver al menú principal, escriba el número* **0**`;
            await enviarRespuesta(remoteJid, respuesta3);
            return;
        }

        // Opción 4: Contacto humano
        if (textoUsuario === '4') {
            const textoTelefonos = leerArchivo('contacto_telefonos.txt');
            const respuesta4 = `${textoTelefonos}\n\n-------------------\n👉 *Para volver al menú principal, escriba el número* **0**`;
            await enviarRespuesta(remoteJid, respuesta4);
            return;
        }

        // Opción 5: Audio especial (saludo.mp4)
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

        // Si escriben cualquier otra cosa
        const textoError = leerArchivo('error.txt');
        await enviarRespuesta(remoteJid, textoError);
    });
}

startBot();
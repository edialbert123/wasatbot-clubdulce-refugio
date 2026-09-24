const http = require('http');

let ultimoQR = ''; // Variable para guardar el QR activo

// Creamos un servidor web que muestra el QR limpio si abres el enlace en el navegador
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (ultimoQR) {
        res.end(`
            <html>
                <head><title>Vinculación de WhatsApp</title></head>
                <body style="text-align:center; font-family:sans-serif; margin-top:50px;">
                    <h2>Escanea este código QR para conectar tu Bot</h2>
                    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
                    <div id="qrcode" style="display:inline-block;"></div>
                    <script>
                        new QRCode(document.getElementById("qrcode"), {
                            text: "${ultimoQR}",
                            width: 300,
                            height: 300
                        });
                    </script>
                    <p>Actualiza la página si el código expira.</p>
                </body>
            </html>
        `);
    } else {
        res.end('<h1>El bot está iniciando o ya está conectado. Si ya se conectó, esta página se verá en blanco.</h1>');
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor web escuchando en el puerto ${PORT}`);
});

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

// Función optimizada: Envía un aviso primero para forzar la vista y luego la respuesta real
async function enviarConEscritura(msg, remitente, contenido) {
    try {
        // 1. Mensaje corto de transición para obligar a la pantalla a registrar actividad
        await client.sendMessage(remitente, "⏳ Buscando la información...");
        
        // 2. Pausa breve de 1.5 segundos para dar tiempo a la interfaz
        await new Promise(resolve => setTimeout(resolve, 1500)); 
        
        // 3. Enviamos la respuesta real citando el mensaje del usuario
        await msg.reply(contenido);
    } catch (error) {
        console.log("Error en enviarConEscritura:", error);
        await client.sendMessage(remitente, contenido);
    }
}

// Función auxiliar para leer los archivos de texto
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

// Función para obtener un versículo al azar
function obtenerVersiculoAleatorio() {
    const contenido = leerArchivo('versiculos.txt');
    const versiculos = contenido.split('\n').filter(v => v.trim() !== '');
    if (versiculos.length === 0) return "No hay versículos disponibles por el momento.";
    const indiceAleatorio = Math.floor(Math.random() * versiculos.length);
    return versiculos[indiceAleatorio];
}

client.on('qr', (qr) => {
    ultimoQR = qr; // Guarda el QR fresco para la página web
    console.log('¡Nuevo QR generado! Abre la URL de tu app en el navegador para escanearlo limpio.');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('¡El bot está listo, ordenado en archivos y con audio integrado!');
});

client.on('message', async msg => {
    const textoUsuario = msg.body.trim().toLowerCase();
    const remitente = msg.from;

    console.log(`Mensaje recibido de ${remitente}: ${msg.body}`);

    // Menú principal (Lee de menu.txt)
    if (textoUsuario === 'hola' || textoUsuario === 'menu' || textoUsuario === '0' || textoUsuario === 'regresar') {
        const textoMenu = leerArchivo('menu.txt');
        await enviarConEscritura(msg, remitente, textoMenu);
        return;
    }

    // Opción 1: Actividades (Lee de actividades.txt)
    if (textoUsuario === '1') {
        const textoActividad = leerArchivo('actividades.txt');
        const respuesta1 = `${textoActividad}\n\n-------------------\n👉 *Para volver al menú principal, escriba el número* **0**`;
        await enviarConEscritura(msg, remitente, respuesta1);
        return;
    }

    // Opción 2: Colaboración (Lee de colaboracion.txt)
    if (textoUsuario === '2') {
        const textoColab = leerArchivo('colaboracion.txt');
        const respuesta2 = `${textoColab}\n\n-------------------\n👉 *Para volver al menú principal, escriba el número* **0**`;
        await enviarConEscritura(msg, remitente, respuesta2);
        return;
    }

    // Opción 3: Palabra de aliento (Elige al azar de versiculos.txt)
    if (textoUsuario === '3') {
        const versiculoDelDia = obtenerVersiculoAleatorio();
        const respuesta3 = `📖 *Palabra de Aliento para Hoy*\n\n${versiculoDelDia}\n\nRecuerde que usted es una persona muy valiosa y especial para el Señor y para nosotros. ¡Dios le bendiga grande y ricamente hoy! ✨\n\n-------------------\n👉 *Para volver al menú principal, escriba el número* **0**`;
        await enviarConEscritura(msg, remitente, respuesta3);
        return;
    }

    // Opción 4: Contacto humano con números directos (Lee de contacto_telefonos.txt)
    if (textoUsuario === '4') {
        const textoTelefonos = leerArchivo('contacto_telefonos.txt');
        const respuesta4 = `${textoTelefonos}\n\n-------------------\n👉 *Para volver al menú principal, escriba el número* **0**`;
        await enviarConEscritura(msg, remitente, respuesta4);
        return;
    }

    // Opción 5: Audio especial (Envía saludo.mp4)
    if (textoUsuario === '5') {
        await enviarConEscritura(msg, remitente, "🎵 Con mucho cariño, aquí le compartimos este audio:");
        try {
            const audioMensaje = MessageMedia.fromFilePath(path.join(__dirname, 'audios', 'saludo.mp4'));
            await msg.reply(audioMensaje);
        } catch (error) {
            console.log("Error al enviar el audio:", error);
            await enviarConEscritura(msg, remitente, "Disculpe, el archivo de audio no se encuentra disponible en este momento.");
        }
        await enviarConEscritura(msg, remitente, "-------------------\n👉 *Para volver al menú principal, escriba el número* **0**");
        return;
    }

    // Si escriben otra cosa (Lee de error.txt)
    const textoError = leerArchivo('error.txt');
    await enviarConEscritura(msg, remitente, textoError);
});

client.initialize();
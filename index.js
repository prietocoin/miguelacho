const express = require('express');
const { google } = require('googleapis');
const app = express();

// --- CONFIGURACIÓN DE ENTORNO ---
// Forzamos el puerto 8081 para evitar conflictos con el puerto 80 del proxy.
const PORT = 8081; 
const CREDENTIALS_PATH = './credentials.json'; // Ruta simple en el directorio raíz

// --- Configuración de Google Sheets ---
// NOTA: Estas constantes deben coincidir con las de tu API que funciona
const SPREADSHEET_ID = '1jv-wydSjH84MLUtj-zRvHsxUlpEiqe5AlkTkr6K2248'; // Reemplazar con tu ID si es diferente
const TASAS_SHEET_NAME = 'Mercado';
const TASAS_SHEET_RANGE = 'A1:M1000';
const GANANCIAS_SHEET_NAME = 'miguelacho';
const GANANCIAS_SHEET_RANGE = 'B1:L12';

// Variable global para almacenar la matriz de ganancias (usada para la estabilidad inicial)
let MATRIZ_DE_GANANCIAS = [];

// --- FUNCIONES DE UTILIDAD ---
function parseFactor(factorString) {
    if (typeof factorString !== 'string' || factorString.trim() === '') return 1.0;
    return parseFloat(factorString.replace(',', '.')) || 1.0;
}

function transformTasasToObjects(data) {
    if (!data || data.length < 2) return [];
    const headers = data[0].map(h => h.trim());
    const rows = data.slice(1);
    return rows.map(row => {
        const obj = {};
        headers.forEach((header, index) => obj[header] = row[index] || '');
        return obj;
    });
}

// --- FUNCIÓN PRINCIPAL DE GOOGLE SHEETS ---
async function getSheetData(sheetName, range, raw = false) {
    const auth = new google.auth.GoogleAuth({
        keyFile: CREDENTIALS_PATH,
        scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    });

    const sheets = google.sheets({ version: 'v4', auth });

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!${range}`,
        });
        
        return raw ? response.data.values : transformTasasToObjects(response.data.values);

    } catch (err) {
        console.error(`ERROR DE AUTENTICACIÓN/LECTURA DE SHEETS: ${err.message}`);
        // Lanzamos el error para que sea manejado por la ruta que llama a esta función
        throw new Error('Fallo al contactar Google Sheets. Verifique credenciales y permisos.'); 
    }
}

// --- MIDDLEWARE Y RUTA RAÍZ (HEALTH CHECK) ---
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    next();
});

// Ruta raíz para el chequeo de salud
app.get('/', (req, res) => {
    console.log(`[${new Date().toISOString()}] ¡Chequeo de salud recibido! Respondiendo con 'ok'.`);
    res.status(200).json({ status: 'ok', message: 'API de Miguelacho en línea' });
});


// --- ENDPOINT DE LA CALCULADORA (EJEMPLO) ---
app.get('/convertir', async (req, res) => {
    // Nota: Esta ruta debe ser la que usa tu lógica de NOCTUS si es más compleja
    const { cantidad, origen, destino } = req.query;

    if (!cantidad || !origen || !destino) { 
         return res.status(400).json({ error: "Parámetros faltantes o inválidos." }); 
    }

    // Aquí iría tu lógica completa de Sheets para obtener tasas y matriz de cruce
    try {
        // Ejemplo simplificado: Intenta leer las tasas para confirmar que las credenciales funcionan
        const tasasData = await getSheetData(TASAS_SHEET_NAME, TASAS_SHEET_RANGE);

        res.json({
            status: "success",
            conversion_solicitada: `${cantidad} ${origen} a ${destino}`,
            monto_convertido: 99.99, // Valor de prueba
            detalle: {
                // ... Aquí devolverías datos reales ...
                ultimos_datos: tasasData.length > 0 ? tasasData[tasasData.length - 1] : "No hay datos"
            }
        });
    } catch (error) {
        // Captura el error de Google Sheets si falla
        res.status(500).json({ error: 'Error interno del servidor al procesar la conversión.', detalle: error.message });
    }
});

// --- INICIO DEL SERVIDOR Y MANEJO DE SEÑALES ---
async function startServer() {
    // Nota: Eliminamos la carga de la matriz inicial para evitar un punto de fallo asíncrono.
    
    const server = app.listen(PORT, () => {
        console.log(`Servidor de MIGUELACHO API escuchando en el puerto: ${PORT}`);
        console.log(`Acceso API de prueba: http://localhost:${PORT}/`);
    });

    // --- MANEJADOR DE APAGADO ELEGANTE (GRACEFUL SHUTDOWN) ---
    // Esto previene el problema del SIGTERM
    process.on('SIGTERM', () => {
        console.log('[SHUTDOWN] Señal SIGTERM recibida. Iniciando cierre elegante...');
        
        server.close(async () => {
            console.log('[SHUTDOWN] Servidor HTTP cerrado. Terminando proceso.');
            process.exit(0);
        });

        setTimeout(() => {
            console.error('[SHUTDOWN] El cierre elegante tardó demasiado (10s). Forzando salida.');
            process.exit(1); 
        }, 10000); 
    });
}

startServer();

const express = require('express');
const { google } = require('googleapis');
const app = express();

// --- CONFIGURACIÓN DE ENTORNO ---
const PORT = process.env.PORT || 8081;
const CREDENTIALS_PATH = '/workspace/credentials.json';

// --- Configuración de Google Sheets ---
const SPREADSHEET_ID = '1jv-wydSjH84MLUtj-zRvHsxUlpEiqe5AlkTkr6K2248';
const TASAS_SHEET_NAME = 'Mercado';
const TASAS_SHEET_RANGE = 'A1:M1000';
const GANANCIAS_SHEET_NAME = 'miguelacho';
const GANANCIAS_SHEET_RANGE = 'B1:L12';

// Variable global para almacenar la matriz
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
        console.error(`La API de Google Sheets devolvió un error al leer ${sheetName}!${range}: ${err}`);
        throw err;
    }
}

// --- MIDDLEWARE Y RUTA RAÍZ (CON DIAGNÓSTICO) ---
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    next();
});

// Ruta raíz para el chequeo de salud de EasyPanel
app.get('/', (req, res) => {
    // ¡ESTA ES LA LÍNEA NUEVA!
    console.log(`[${new Date().toISOString()}] ¡Chequeo de salud recibido! Respondiendo con 'ok'.`);
    res.status(200).json({ status: 'ok', message: 'API de Miguelacho en línea' });
});


// --- ENDPOINT DE LA CALCULADORA ---
app.get('/convertir', async (req, res) => {
    const { cantidad, origen, destino } = req.query;
    const monto = parseFloat(cantidad);
    const O = origen ? origen.toUpperCase() : null;
    const D = destino ? destino.toUpperCase() : null;

    if (!monto || !O || !D) { return res.status(400).json({ error: "Parámetros faltantes o inválidos." }); }
    if (MATRIZ_DE_GANANCIAS.length === 0) { return res.status(503).json({ error: "Servicio no listo, matriz de ganancias no cargada." }); }

    try {
        const headersColumnas = MATRIZ_DE_GANANCIAS[0];
        const originIndex = headersColumnas.indexOf(O);
        if (originIndex === -1) { return res.status(404).json({ error: `Moneda de origen '${O}' no encontrada en la matriz de ganancias.` }); }

        let destinationRow = null;
        for (let i = 1; i < MATRIZ_DE_GANANCIAS.length; i++) {
            if (MATRIZ_DE_GANANCIAS[i][0] === D) {
                destinationRow = MATRIZ_DE_GANANCIAS[i];
                break;
            }
        }
        if (!destinationRow) { return res.status(404).json({ error: `Moneda de destino '${D}' no encontrada en la matriz de ganancias.` }); }
        
        const Factor_F = parseFactor(destinationRow[originIndex]);

        const tasasData = await getSheetData(TASAS_SHEET_NAME, TASAS_SHEET_RANGE);
        if (!tasasData || tasasData.length === 0) { return res.status(503).json({ error: "No se pudieron obtener datos de tasas." }); }
        const latestRow = tasasData[tasasData.length - 1];

        const T_O_str = latestRow[`${O}_O`];
        const T_D_str = latestRow[`${D}_D`];
        if (!T_O_str || !T_D_str) { return res.status(404).json({ error: `Tasa no encontrada en la hoja 'Mercado'.` }); }

        const T_O = parseFloat(T_O_str.replace(',', '.')) || 0;
        const T_D = parseFloat(T_D_str.replace(',', '.')) || 0;
        if (T_O === 0 || T_D === 0) { return res.status(404).json({ error: "El valor de una de las tasas es cero." }); }

        const montoConvertido = monto * ((T_D / T_O) * Factor_F);

        res.json({
            status: "success",
            conversion_solicitada: `${monto} ${O} a ${D}`,
            monto_convertido: parseFloat(montoConvertido.toFixed(4)),
            detalle: {
                factor_ganancia: Factor_F,
                id_tasa_actual: latestRow.IDTAS || 'N/A',
                timestamp_actual: latestRow.FECHA || new Date().toISOString()
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Error interno del servidor al procesar la conversión.', detalle: error.message });
    }
});

// --- INICIO DEL SERVIDOR ---
async function startServer() {
    try {
        console.log('Cargando matriz de ganancias desde Google Sheets (hoja: miguelacho)...');
        MATRIZ_DE_GANANCIAS = await getSheetData(GANANCIAS_SHEET_NAME, GANANCIAS_SHEET_RANGE, true);
        if (MATRIZ_DE_GANANCIAS && MATRIZ_DE_GANANCIAS.length > 0) {
            console.log('¡Matriz de ganancias cargada exitosamente!');
        } else {
            console.error('ALERTA: La matriz de ganancias no se pudo cargar o está vacía.');
        }
    } catch (error) {
        console.error('ERROR CRÍTICO: No se pudo cargar la matriz de ganancias.', error);
    }
    
    app.listen(PORT, () => {
        console.log(`Servidor para Miguelacho API escuchando en el puerto: ${PORT}`);
    });
}

startServer();


const express = require('express');
const { google } = require('googleapis'); 
const app = express();

// --- CONFIGURACIÓN DE ENTORNO ---
const PORT = process.env.PORT || 8081; // Usamos 8081 para evitar conflicto con Nginx
const CREDENTIALS_PATH = '/workspace/credentials.json'; 
// NOTA: Reemplaza este ID por el ID de tu hoja de cálculo real
const SPREADSHEET_ID = '1jv-wydSjH84MLUtj-zRvHsxUlpEiqe5AlkTkr6K2248'; 
const MAIN_SHEET_NAME = 'Mercado'; 
const RANGO_TASAS = 'A1:AL999'; 
const RANGO_MATRIZ_CRUCE = 'AN1:BD17'; // Rango donde está la Matriz de Ganancia/Cruce

// Convierte cadena con coma decimal a número (ej. "0,93" -> 0.93)
function parseFactor(factorString) {
    if (typeof factorString !== 'string') return 1.0;
    return parseFloat(factorString.replace(',', '.')) || 1.0; 
}


// --- FUNCIONES DE UTILIDAD ---

function transformToObjects(data) {
    if (!data || data.length === 0) return [];
    const headers = data[0].map(h => h.trim());
    const rows = data.slice(1);

    return rows.map(row => {
        const obj = {};
        headers.forEach((header, index) => {
            const key = header ? header : `Columna${index}`;
            obj[key] = row[index] || ''; 
        });
        return obj;
    }).filter(obj => Object.values(obj).some(val => val !== '')); 
}

// --- FUNCIÓN PRINCIPAL DE GOOGLE SHEETS ---

async function getSheetData(range, raw = false) {
    const auth = new google.auth.GoogleAuth({
        keyFile: CREDENTIALS_PATH,
        scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${MAIN_SHEET_NAME}!${range}`, 
        });
        
        if (raw) return response.data.values;
        
        let data = transformToObjects(response.data.values);

        // FILTRADO CENTRALIZADO: Si es el rango de tasas dinámicas, devolvemos solo el último IDTAS
        if (range === RANGO_TASAS && Array.isArray(data) && data.length > 0) {
            const latestRow = data.reduce((max, current) => {
                const maxIdtasNum = parseFloat(max.IDTAS) || 0; 
                const currentIdtasNum = parseFloat(current.IDTAS) || 0;
                return currentIdtasNum > maxIdtasNum ? current : max;
            }, data[0]);
            
            return [latestRow]; 
        }

        return data;

    } catch (err) {
        console.error(`La API de Google Sheets devolvió un error al leer el rango ${range}: ${err}`);
        throw err; 
    }
}

// --- MIDDLEWARE Y RUTA RAÍZ ---
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

// Ruta para obtener la matriz de cruce (usada por el frontend para las monedas)
app.get('/matriz_cruce', async (req, res) => {
    try {
        // Lee la matriz de cruce dinámicamente desde Sheets
        const data = await getSheetData(RANGO_MATRIZ_CRUCE); 
        res.json(data);
    } catch (error) {
        console.error('Error en /matriz_cruce: ', error.message);
        res.status(500).json({ error: 'Error al obtener Matriz de Cruce', detalle: error.message });
    }
});

// --- SERVICIO DE CONVERSIÓN CENTRALIZADO ---
app.get('/convertir', async (req, res) => {
    // 1. Obtener y validar parámetros
    const { cantidad, origen, destino } = req.query;

    const monto = parseFloat(cantidad);
    const O = origen ? origen.toUpperCase() : null;
    const D = destino ? destino.toUpperCase() : null;

    if (!monto || !O || !D) {
        return res.status(400).json({ error: "Parámetros faltantes o inválidos." });
    }

    try {
        // 2. OBTENER ÚLTIMA FILA con tasas dinámicas
        const latestRowArray = await getSheetData(RANGO_TASAS); 
        if (!Array.isArray(latestRowArray) || latestRowArray.length === 0) {
             return res.status(503).json({ error: "No se pudieron obtener datos de tasas dinámicas recientes." });
        }
        const latestRow = latestRowArray[0]; 

        // 3. OBTENER MATRIZ DE GANANCIA DINÁMICA
        const matrizGanancia = await getSheetData(RANGO_MATRIZ_CRUCE);
        if (!Array.isArray(matrizGanancia) || matrizGanancia.length === 0) {
             return res.status(503).json({ error: "Matriz de Ganancia no cargada." });
        }

        // 4. EXTRACCIÓN Y VALIDACIÓN DE TASAS DINÁMICAS (ORIGEN _O y DESTINO _D)
        const Tasa_O_key = `${O}_O`; // Ej: USD_O
        const Tasa_D_key = `${D}_D`; // Ej: COP_D

        const T_O_str = latestRow[Tasa_O_key];
        const T_D_str = latestRow[Tasa_D_key];
        
        if (!T_O_str || !T_D_str) {
             return res.status(404).json({ error: `Clave de tasa no encontrada (${Tasa_O_key} o ${Tasa_D_key}).` });
        }

        const T_O = parseFloat(T_O_str.replace(',', '.')) || 0;
        const T_D = parseFloat(T_D_str.replace(',', '.')) || 0;

        if (T_O === 0 || T_D === 0) {
            return res.status(404).json({ error: "El valor de una de las tasas dinámicas es cero o inválido." });
        }

        // 5. BUSCAR FACTOR DE GANANCIA (F) en la matriz dinámica
        const claveMatrizDestino = `${D}`; // Fila: Ej: COP
        const claveMatrizOrigen = `${O}`; // Columna: Ej: USD

        const filaDestino = matrizGanancia.find(row => row.hasOwnProperty(claveMatrizDestino));
       
        // NOTA: Aquí asumimos que la matrizGanancia tiene encabezados de columna como COP, USD, etc.
        const Factor_F_str = filaDestino ? filaDestino[claveMatrizOrigen] : null;
        
        if (!Factor_F_str) {
            return res.status(404).json({ error: `Factor de ganancia (matriz) no encontrado para el par ${O} -> ${D}.` });
        }

        const Factor_F = parseFactor(Factor_F_str);

        // 6. CÁLCULO FINAL: Monto * ( (T_D / T_O) * F )
        const montoConvertido = monto * ( (T_D / T_O) * Factor_F );

        // 7. Devolver resultado JSON con IDTAS y FECHA (Timestamp)
        res.json({
            status: "success",
            conversion_solicitada: `${monto} ${O} a ${D}`,
            monto_convertido: parseFloat(montoConvertido.toFixed(4)),
            detalle: {
                factor_ganancia: Factor_F,
                id_tasa_actual: latestRow.IDTAS,
                timestamp_actual: latestRow.FECHA 
            }
        });

    } catch (error) {
        console.error('Error en /convertir: ', error.message);
        res.status(500).json({ error: 'Error interno del servidor al procesar la conversión.', detalle: error.message });
    }
});


// --- INICIO DEL SERVIDOR Y MANEJO DE SEÑALES ---
// Esta lógica se ejecuta en el Entrypoint y asegura la estabilidad
const server = app.listen(PORT, () => {
    console.log(`Servidor de MIGUELACHO API escuchando en el puerto: ${PORT}`);
    // CORRECCIÓN CLAVE: Usamos la variable PORT para la URL de prueba
    console.log(`Acceso API de prueba: http://localhost:${PORT}/`); 
});

// MANEJADOR DE APAGADO ELEGANTE (GRACEFUL SHUTDOWN) - Soluciona SIGTERM
process.on('SIGTERM', () => {
    console.log('[SHUTDOWN] Señal SIGTERM recibida. Iniciando cierre elegante...');
    server.close(() => {
        console.log('[SHUTDOWN] Servidor HTTP cerrado. Terminando proceso.');
        process.exit(0);
    });
    setTimeout(() => {
        console.error('[SHUTDOWN] El cierre elegante tardó demasiado. Forzando salida.');
        process.exit(1); 
    }, 10000); 
});

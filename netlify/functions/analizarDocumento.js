// netlify/functions/analizarDocumento.js

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { pdfBase64, tipoDocumento } = JSON.parse(event.body);
        const API_KEY = process.env.GEMINI_API_KEY;

        if (!API_KEY) {
            return { statusCode: 500, body: JSON.stringify({ error: "Falta configurar GEMINI_API_KEY en Netlify." }) };
        }

        // ============================================================================
        // PROMPT 1: HISTORIA CLÍNICA (SUCURSALES NORMALES)
        // ============================================================================
        const PROMPT_HC_NORMAL = `
        Eres un auditor médico experto de LAP.IA. Analiza estrictamente la Historia Clínica Ocupacional adjunta en PDF. 
        Evalúa las 5 categorías de reglas (Integridad Demográfica, Riesgos Laborales, Patológicos, Congruencia Clínica y Exploración).
        Devuelve ÚNICAMENTE un JSON con: aprobadoGeneral (boolean), motivoPrincipal (string), y checklist (array de objetos con categoria, pass y comentario).
        `;

        // ============================================================================
        // PROMPT 2: HISTORIA CLÍNICA (ESTRICTO MINAS) - BASADO EN TUS REGLAS
        // ============================================================================
        const PROMPT_HC_MINAS = `
        Eres el Auditor Médico Supremo de LAP.IA para la división de MINAS. Tu evaluación debe ser implacable, milimétrica y sin margen de error.
        Analiza la Historia Clínica Ocupacional en PDF adjunta evaluando estas 6 categorías basadas en las reglas oficiales de Minas:

        REGLAS DE EVALUACIÓN MINAS:
        1. "Identificación y Demográficos": Domicilio completo (calle, ext, int, colonia, localidad, municipio, edo, CP). Teléfonos llenos. Contacto de emergencia (nombre, dir, parentesco, tel). Afiliaciones (IMSS, RFC, CURP) llenas. Etnia y discapacidad no deben faltar.
        2. "Antecedentes y Riesgos Laborales": Antigüedad debe decir años/meses. Orden cronológico correcto. Si Físicos/Químicos/Ergonómicos es "Sí", DEBE incluir el desglose estricto (fuente, EPP, horas, etc.). REGLA CRÍTICA: Si Químicos es "NO", las observaciones del examinador DEBEN decir exactamente "Niega exposición a SILICE, MONOXIDO DE CARBONO, CIANURO DE HIDROGENO, PLOMO, ESTIRENO, TOLUENO, ETILO BENCENO, XILENO." Riesgos laborales (4-11) llenos.
        3. "Patológicos y Hábitos": Mascotas (21) debe detallar tipo, cantidad, ubicación, vacunado. Observaciones 23-27 y 32 deben referenciar el número y dar detalles (diagnóstico, fecha, tx). Fracturas (28) debe detallar hueso, año, tx. Tabla Vacunas (31) debe estar totalmente llena (excepto 'Otras'). CRÍTICO: Tatuajes (30) en observaciones debe indicar región, tipo, colores y dimensiones.
        4. "Interrogatorio por Aparatos": Si en la preg. 34 se seleccionó "Sí" en cualquier síntoma, ESTRICTAMENTE debe detallarse en el cuadro de observaciones de su sistema correspondiente incluyendo antigüedad, tratamiento y seguimiento. Suma de embarazo (Gestaciones = Partos+Cesáreas+Abortos).
        5. "Exploración Física y Firmas": Exigencia estricta de redacción. Ojos, Nariz, Boca, Cuello, Ganglios, Corazón, Pulmones, Abdomen, Columna, Piernas, Manos, Pies DEBEN decir "Sin datos patológicos". Oídos debe decir "CAP y MTL bilateral". Hernias "No palpable". Circulación, Marcha, Índices, Past-point debe decir "Normal". Tatuajes (23) debe coincidir con la preg 30 o decir "No presentes". Firma del paciente obligatoria.
        6. "Cruces Clínicos MINAS": Alteración de visión (34) y Agudeza Visual (46/47) deben ser reportadas obligatoriamente en Exploración de Ojos (4). Adoncia/Caries (51) debe reflejarse en Boca-Faringe (7).

        Devuelve ÚNICAMENTE un objeto JSON estricto con esta estructura (sin formato markdown):
        {
          "aprobadoGeneral": true/false,
          "motivoPrincipal": "Explicación de la falla más grave o 'Expediente MINAS Óptimo'",
          "checklist": [
            { "categoria": "1. Identificación y Demográficos", "pass": true/false, "comentario": "..." },
            { "categoria": "2. Antecedentes y Riesgos Laborales", "pass": true/false, "comentario": "..." },
            { "categoria": "3. Patológicos y Hábitos", "pass": true/false, "comentario": "..." },
            { "categoria": "4. Interrogatorio y Ginecoobstétricos", "pass": true/false, "comentario": "..." },
            { "categoria": "5. Exploración Física estricta y Firmas", "pass": true/false, "comentario": "..." },
            { "categoria": "6. Cruces Clínicos MINAS", "pass": true/false, "comentario": "..." }
          ]
        }
        `;

        // Lógica para elegir el prompt adecuado
        let promptSeleccionado = PROMPT_HC_NORMAL;
        if (tipoDocumento === 'Historia Clínica (MINAS)') {
            promptSeleccionado = PROMPT_HC_MINAS;
        }
       

        const requestBody = {
            contents: [{
                parts: [
                    { text: promptSeleccionado },
                    { inline_data: { mime_type: "application/pdf", data: pdfBase64 } }
                ]
            }],
            generationConfig: { response_mime_type: "application/json" }
        };

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Google API Error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        let textoJSON = data.candidates[0].content.parts[0].text;
        textoJSON = textoJSON.replace(/```json/g, '').replace(/```/g, '').trim();

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: textoJSON
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

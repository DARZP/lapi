// netlify/functions/analizarDocumento.js

exports.handler = async (event, context) => {
    // 1. Solo permitimos peticiones POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // 2. Extraemos el PDF que nos manda nuestro propio Frontend
        const { pdfBase64, tipoDocumento } = JSON.parse(event.body);

        // 3. Tomamos la llave secreta desde las Variables de Entorno de Netlify
        const API_KEY = process.env.GEMINI_API_KEY;

        if (!API_KEY) {
            return { statusCode: 500, body: JSON.stringify({ error: "Falta configurar GEMINI_API_KEY en Netlify." }) };
        }

        // 4. El Prompt Maestro (Lo movemos al backend para que nadie lo pueda copiar)
        const PROMPT_HISTORIA_CLINICA = `
        Eres un auditor médico experto de LAP.IA. Analiza estrictamente la Historia Clínica Ocupacional adjunta en PDF. 
        Evalúa las siguientes 5 categorías de reglas. 
        
        REGLAS DE EVALUACIÓN:
        1. "1. Integridad Demográfica y Administrativa": Domicilio completo (calle, número, colonia, localidad, municipio, estado, CP). Contacto de emergencia completo (nombre, dirección, parentesco, celular/teléfono). Afiliación IMSS, RFC y CURP presentes. Grupo étnico y discapacidad respondidos.
        2. "2. Historial y Riesgos Laborales": Tabla de empleos en orden cronológico inverso. Cantidad de empleos coincide con la pregunta 1. Si hay riesgos físicos/químicos/etc. (Sí), debe especificar años, horas y EPP. Recuadro de observaciones debe tener texto (mínimo "Ninguna").
        3. "3. Antecedentes Patológicos y Hábitos": Si fuma/toma/drogas, deben estar llenos los detalles (cantidades/edades). Si tuvo cirugía/enfermedad/fractura, el recuadro final de "Observaciones del examinador" DEBE contener el detalle explicativo referenciando el número de pregunta (ej. "25. Apendicectomía..."). Tabla de vacunación con todas las celdas llenas. Detalle de tatuajes (tipo, color, tamaño, ubicación).
        4. "4. Congruencia Clínica (Cross-Validation)": Verifica discrepancias. Si reporta "Alteración de la Visión" en Interrogatorio o "Ametropía" en agudeza visual, la Exploración Física de "Ojos" (4) NO puede decir "Sin datos patológicos". Si reporta Adoncia/Caries (51), Exploración "Boca-Faringe" (7) NO puede decir "Sin datos".
        5. "5. Exploración Física y Cierre": Apartados del 1 al 30 de exploración deben tener respuesta. Actitud, Orientación, Atención, Memoria deben estar respondidos. Firmas del paciente y médico presentes.

        Si todo en una categoría se cumple, pass: true y el comentario debe ser breve.
        Si falla, pass: false y especifica la falla exacta.
        
        DEVUELVE ÚNICAMENTE un objeto JSON estricto con esta estructura:
        {
          "aprobadoGeneral": true,
          "motivoPrincipal": "Resumen de la falla principal o 'Documento óptimo'",
          "checklist": [
            { "categoria": "1. Integridad Demográfica y Administrativa", "pass": true, "comentario": "..." },
            { "categoria": "2. Historial y Riesgos Laborales", "pass": true, "comentario": "..." },
            { "categoria": "3. Antecedentes Patológicos y Hábitos", "pass": true, "comentario": "..." },
            { "categoria": "4. Congruencia Clínica (Cross-Validation)", "pass": true, "comentario": "..." },
            { "categoria": "5. Exploración Física y Cierre", "pass": true, "comentario": "..." }
          ]
        }
        `;

        // 5. Preparamos la petición a Google
        const requestBody = {
            contents: [{
                parts: [
                    { text: PROMPT_HISTORIA_CLINICA },
                    { inline_data: { mime_type: "application/pdf", data: pdfBase64 } }
                ]
            }],
            generationConfig: { response_mime_type: "application/json" }
        };

        // 6. Hacemos la llamada real a Gemini 2.0 Flash
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`, {
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

        // 7. Devolvemos la respuesta limpia a nuestro Frontend
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: textoJSON
        };

    } catch (error) {
        console.error("Error en el backend:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};

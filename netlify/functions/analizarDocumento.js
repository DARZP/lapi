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
        // PROMPT 2: HISTORIA CLÍNICA (ESTRICTO MINAS) - TRANSCRIPCIÓN LITERAL DE REGLAS
        // ============================================================================
        const PROMPT_HC_MINAS = `
        Eres el Auditor Médico Supremo de LAP.IA para la división de MINAS.
        A continuación se te entregan las REGLAS EXACTAS Y LITERALES redactadas por la dirección médica.
        Tu trabajo es evaluar el PDF adjunto estrictamente con este manual. NO simplifiques, NO asumas. Si la regla dice "VERIFICAR CONGRUENCIA O SE ANOTE LA LEYENDA", significa que si hay texto abierto coherente con la anatomía, es VÁLIDO, y si dice la leyenda, también es VÁLIDO.

        --- INICIO DEL MANUAL DE REGLAS MINAS ---

        SECCIÓN DE IDENTIFICACIÓN
        - REQUIERE VERIFICACIÓN. SE DEBE VERIFICAR QUE CADA DATO SIEMPRE ESTÉ CONTESTADO: Grupo étnico, Se considera o no con alguna discapacidad, Domicilio particular (nombre de calle, # ext, # int, colonia, localidad, municipio, estado, C.P TODO siempre contestado), Telefono de casa, Telefono celular, Número de afiliación de IMSS, RFC, CURP, Contacto de emergencia (Nombre, dirección, parentesco, telefono de casa, celular).

        SECCIÓN ANTECEDENTES LABORALES
        - 2. REQUIERE VERIFICACIÓN: DEBE SER UNA ANTIGÜEDAD (AÑOS O AÑOS CON MESES).
        - 3. REQUIERE VERIFICACIÓN: ORDENADOS CRONOLÓGICAMENTE (MÁS RECIENTE ARRIBA), EN "FUNCIÓN PRINCIPAL" INCLUYA AL MENOS UN FACTOR DE RIESGO (QUÍMICOS, BIOLÓGICOS, ERGONÓMICOS, PSICOSOCIAL).
        - A. FÍSICOS. SE SELECCIONA SI: REQUIERE VERIFICACIÓN DE CADA AGENTE (Ruido, Vibración, Radiación, Iluminación, Temperaturas, Trabajos en altura, Espacios Confinados) con sus detalles (fuente, EPP, horas, etc.).
        - B. QUÍMICOS. SE SELECCIONA NO: REQUIERE VERIFICACIÓN DE LA LEYENDA EXACTA "Niega exposición a SILICE, MONOXIDO DE CARBONO, CIANURO DE HIDROGENO, PLOMO, ESTIRENO, TOLUENO, ETILO BENCENO, XILENO." EN EL CUADRO DE OBSERVACIONES AL FINAL DE RIESGOS LABORALES.
        - D. ERGONÓMICOS. SE SELECCIONA SI: REQUIERE VERIFICACIÓN DE CADA AGENTE CON SU INFORMACIÓN (Levantamiento, Repetición, Sobrecarga).

        SECCIÓN DE RIESGOS LABORALES
        - 4 y 5. SE SELECCIONA SI: REQUIERE VERIFICACIÓN DE QUE CADA DATO ESTÉ CONTESTADO (Empresa, causa, días, cuándo, qué le pasó, secuelas, concluyó).

        SECCIÓN ANTECEDENTES HÁBITOS Y COSTUMBRES DE VIDA
        - 21. MASCOTAS. SE SELECCIONA SI: REQUIERE VERIFICACIÓN (Tipo de mascota, cantidad, intra/extradomiciliarias, vacunados y desparasitados).

        SECCIÓN ANTECEDENTES PERSONALES PATOLÓGICOS
        - 23, 24, 25, 26. SE SELECCIONA SI: REQUIERE VERIFICACIÓN DE QUE SEA COHERENTE EL MOTIVO Y AÑO.
        - 28. FRACTURAS. SE SELECCIONA SI: REQUIERE VERIFICACIÓN DE COHERENCIA EN REGIÓN.
        - 29. ENFERMEDADES. SE SELECCIONA SI: SE VERIFICA COHERENCIA EN DIAGNÓSTICO Y TRATAMIENTO.
        - 30. TATUAJES. SE SELECCIONA SI: VERIFICAR QUE SE INCLUYÓ ENTRE LOS REGISTROS.
        - 31. VACUNAS. SE SELECCIONA INCOMPLETO O NO SABE: VERIFICAR COHERENCIA EN "QUÉ VACUNAS FALTAN". VERIFICAR SE LLENE POR COMPLETO LA PRIMERA COLUMNA (FECHA). EN CASO DE FECHA DEBE INCLUIR NÚMERO DE DOSIS Y MARCA. LA ÚNICA FILA QUE PUEDE ESTAR SIN INFORMACIÓN ES "OTRAS".
        - 32. ALERGIAS. SE SELECCIONA SI: VERIFICAR APAREZCA SELECCIONADO EL TIPO Y TENGA COHERENCIA.
        - OBSERVACIONES DEL EXAMINADOR (PATOLÓGICOS): SE VERIFICA QUE EN ESTE CUADRO SE INCLUYAN LOS DETALLES DE LAS PREGUNTAS DONDE SE RESPONDIÓ "SI" HACIENDO REFERENCIA AL NÚMERO. 23 (diagnóstico, fecha, incapacidad), 24 (diagnóstico, días hosp, fecha, incapacidad), 25 (tipo cx, fecha, incapacidad), 26 (motivo, fecha), 27 (edad, complicaciones), 28 (hueso, año, tratamiento), 30 (región, tipo, monocromático/policromático, dimensiones), 32 (alérgeno, reacción).

        INTERROGATORIO POR APARATOS Y SISTEMAS
        - 34. SELECCIONA SI: VERIFICAR QUE CADA UNO SE INCLUYA EN EL APARTADO DE OBSERVACIONES DEL SISTEMA CORRESPONDIENTE, INCLUYENDO SÍNTOMA, ANTIGÜEDAD, CON/SIN TRATAMIENTO, CON/SIN SEGUIMIENTO.
        - SI SE REPORTÓ "ALTERACIÓN DE LA VISIÓN", VERIFICAR SE INCLUYA SIEMPRE: DIAGNÓSTICO OFTALMOLÓGICO, USO Y TIPO DE LENTES, ANTIGÜEDAD, FECHA DE ÚLTIMO AJUSTE.

        ANTECEDENTES GINECOOBSTÉTRICOS
        - 37. SE DEBE VERIFICAR LA COHERENCIA DE LOS EMBARAZOS TOTALES Y LA SUMA DE LOS TIPOS DE GESTACIONES (G = P + C + A).

        SECCIÓN DE EXPLORACIÓN FÍSICA
        - Ojos (4): VERIFICAR CONGRUENCIA Y AFINIDAD A LA SECCIÓN O SE ANOTE LEYENDA "Sin datos patológicos". SI EN 46/47 HAY AMETROPÍA O EN 34 ALTERACIÓN DE VISIÓN, VERIFICAR QUE SE HAGA REFERENCIA AQUÍ.
        - Oídos (5): VERIFICAR CONGRUENCIA Y AFINIDAD A LA SECCIÓN O SE ANOTE LEYENDA "CAP y MTL bilateral".
        - Boca-Faringe (7): VERIFICAR CONGRUENCIA Y AFINIDAD O LEYENDA "Sin datos patológicos".
        - Hernias (13): VERIFICAR CONGRUENCIA Y AFINIDAD O LEYENDA "No palpables".
        - Circulación, Marcha, Índices, Past-point (17, 20, 21, 22): VERIFICAR CONGRUENCIA Y AFINIDAD O LEYENDA "Normal".
        - Tatuajes (23): SI EN LA 30 SE INCLUYÓ TATUAJE, VERIFICAR QUE ESTE RECUADRO TENGA LA MISMA INFO (Región, Tipo, Mono/Poli, Dimensiones). SI NO HAY TATUAJE, DEBE DECIR "No presentes".
        - RESTO DE APARTADOS (1, 2, 3, 6, 8, 9, 10, 11, 12, 14, 15, 16, 18): VERIFICAR CONGRUENCIA Y AFINIDAD A LA SECCIÓN O SE ANOTE LEYENDA "Sin datos patológicos".
        - FIRMA DEL PACIENTE: VERIFICAR QUE EL CUADRO TENGA LA FIRMA.

        --- FIN DE REGLAS MINAS ---

        Con base en el manual literal anterior, genera el reporte en JSON validando cada sección.
        DEVUELVE ÚNICAMENTE un JSON estricto con esta estructura (sin bloques de markdown \`\`\`json):
        {
          "aprobadoGeneral": true/false,
          "motivoPrincipal": "Resumen de la falla o 'Documento óptimo'",
          "checklist": [
            { "categoria": "1. Sección Identificación", "pass": true/false, "comentario": "..." },
            { "categoria": "2. Antecedentes Laborales (Preguntas 1 a 3)", "pass": true/false, "comentario": "..." },
            { "categoria": "3. Agentes Físicos, Químicos y Ergonómicos", "pass": true/false, "comentario": "..." },
            { "categoria": "4. Riesgos Laborales (4 a 11) y Observaciones", "pass": true/false, "comentario": "..." },
            { "categoria": "5. Hábitos y Costumbres (Preguntas 15 a 22)", "pass": true/false, "comentario": "..." },
            { "categoria": "6. Personales Patológicos (Preguntas 23 a 33)", "pass": true/false, "comentario": "..." },
            { "categoria": "7. Patológicos (Cruce y Descripciones de Detalles)", "pass": true/false, "comentario": "..." },
            { "categoria": "8. Aparatos y Sistemas (34 y Observaciones)", "pass": true/false, "comentario": "..." },
            { "categoria": "9. Ginecoobstétricos (Congruencia de Gestaciones)", "pass": true/false, "comentario": "..." },
            { "categoria": "10. Exploración Física (Congruencia/Leyendas y Cruces)", "pass": true/false, "comentario": "..." },
            { "categoria": "11. Firma del Paciente", "pass": true/false, "comentario": "..." }
          ]
        }
        `;

        // Elegir el prompt adecuado
        let promptSeleccionado = PROMPT_HC_NORMAL;
        if (tipoDocumento === 'Historia Clínica (MINAS)' || tipoDocumento === 'Historia Clínica') {
            // Por ahora forzamos MINAS para que pruebes las reglas estrictas
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

       const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}}`, {
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

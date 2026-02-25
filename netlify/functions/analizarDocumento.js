// netlify/functions/analizarDocumento.js

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // AHORA EXTRAEMOS "datosPaciente" DEL FRONTEND PARA CRUZARLOS EN LA ESPIROMETRÍA Y AUDIOMETRÍA
        const { pdfBase64, tipoDocumento, datosPaciente } = JSON.parse(event.body);
        const API_KEY = process.env.GEMINI_API_KEY;

        if (!API_KEY) {
            return { statusCode: 500, body: JSON.stringify({ error: "Falta configurar GEMINI_API_KEY en Netlify." }) };
        }

        let promptSeleccionado = "";

        // ============================================================================
        // PROMPT 1: HISTORIA CLÍNICA (SUCURSALES NORMALES)
        // ============================================================================
        const PROMPT_HC_NORMAL = `
        Eres un auditor médico experto de LAP.IA. Analiza estrictamente la Historia Clínica Ocupacional adjunta en PDF. 
        Evalúa las 5 categorías de reglas (Integridad Demográfica, Riesgos Laborales, Patológicos, Congruencia Clínica y Exploración).
        Devuelve ÚNICAMENTE un JSON con: aprobadoGeneral (boolean), motivoPrincipal (string), y checklist (array de objetos con categoria, pass y comentario).
        `;

        // ============================================================================
        // PROMPT 2: HISTORIA CLÍNICA (ESTRICTO MINAS) - REGLAS LITERALES + EXTRACCIÓN
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

        Además de la auditoría, DEBES EXTRAER los siguientes datos del paciente para guardarlos en la base de datos y usarlos en futuros estudios (Espirometría y Audiometría):
        1. "estatura": Extraída de la sección 44. SOMATOMETRÍA (Talla).
        2. "peso": Extraído de la sección 44. SOMATOMETRÍA (Peso).
        3. "fuma": Valor de la sección "Hábitos y Costumbres" pregunta 17 (SI/NO).
        4. "fumaDetalles": Si en la 18 dice cuánto fumó o en la sección FUMADOR, extráelo. Si no, déjalo vacío.
        5. "audio_patologicos": Resumen si reporta padecer: Diabetes, Hipertensión (HAS), Infección de oídos/Otitis, Dislipidemia (Colesterol/Triglicéridos) o Disminución auditiva (En preguntas 29 y 34). Si no tiene, pon "Negados".
        6. "audio_exantematicas": Resumen de la pregunta 27 (Sarampión, Rubéola, Paperas, Varicela). Si no tiene, pon "Negados".
        7. "audio_ruido": Resumen de la exposición a Ruido en "Antecedentes Laborales" (Tabla A. Físicos). Incluye empresa, años, EPP. Si marcó NO, pon "Sin exposición".

        Con base en el manual literal anterior y los datos a extraer, genera el reporte en JSON validando cada sección.
        DEVUELVE ÚNICAMENTE un JSON estricto con esta estructura (sin bloques de markdown \`\`\`json):
        {
          "aprobadoGeneral": true/false,
          "motivoPrincipal": "Resumen de la falla o 'Documento óptimo'",
          "datosExtraidosHC": {
              "estatura": "...",
              "peso": "...",
              "fuma": "SI/NO",
              "fumaDetalles": "...",
              "audio_patologicos": "...",
              "audio_exantematicas": "...",
              "audio_ruido": "..."
          },
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

        // Extraemos los datos cruzados (si existen) para pasárselos a los estudios
        const dp = datosPaciente || {};
        const hc = dp.datosHC || null; // Datos extraídos previamente de la HC

        // ============================================================================
        // PROMPT 3: ESPIROMETRÍA (CRUCE DE DATOS CON HISTORIA CLÍNICA)
        // ============================================================================
        const PROMPT_ESPIROMETRIA = `
        Eres un Auditor Médico evaluando el PDF de una ESPIROMETRÍA.
        
        DATOS DE LA PLATAFORMA PARA CRUZAR:
        - Nombre registrado: ${dp.nombre || 'No proporcionado'}
        - Fecha de Nacimiento: ${dp.nacimiento || 'No proporcionado'}
        - Número de Orden: ${dp.orden || 'No proporcionado'}
        
        DATOS DE HISTORIA CLÍNICA (HC) PARA CRUZAR:
        ${hc ? `- Estatura HC: ${hc.estatura} \n- Peso HC: ${hc.peso} \n- Fuma HC: ${hc.fuma} \n- Detalles Tabaco HC: ${hc.fumaDetalles}` : 'NO DISPONIBLES (La Historia Clínica aún no se ha analizado)'}

        REGLAS DE ESPIROMETRÍA:
        1. "Fecha Nacimiento": Verifica que la fecha en el PDF coincida con la de Plataforma (${dp.nacimiento || 'No proporcionado'}).
        2. "Nombre y Apellidos": Verifica que coincidan con Plataforma (${dp.nombre || 'No proporcionado'}).
        3. "Identificación Personal": Verifica que coincida con el Número de Orden de Plataforma (${dp.orden || 'No proporcionado'}).
        4. "Estatura y Peso": Verifica que la estatura y peso del PDF coincidan con la HC. Si NO HAY DATOS DE HC disponibles, pon pass: false y en comentario: "⚠️ PENDIENTE: Se requiere analizar primero la Historia Clínica para cruzar estos datos".
        5. "Fumador": Si el PDF marca SI, debe tener detalles de cantidad/tiempo a un lado, y en HC debe decir SI. Si marca NO, no debe haber detalles y en HC debe decir NO. Si marca DEJAR, debe tener detalles y coincidir con la HC. Si NO HAY DATOS DE HC, pon pass: false y en comentario: "⚠️ PENDIENTE: Cruzar con Historia Clínica".
        (Nota: Edad, Género, BMI, Profesión, Código Paciente y Grupo Étnico NO requieren verificación, ignóralos).

        DEVUELVE ÚNICAMENTE un JSON estricto con esta estructura (sin bloques de markdown \`\`\`json):
        {
          "aprobadoGeneral": true/false,
          "motivoPrincipal": "Resumen de la falla o 'Documento congruente y óptimo'",
          "checklist": [
            { "categoria": "1. Fecha de Nacimiento", "pass": true/false, "comentario": "..." },
            { "categoria": "2. Nombre y Apellidos", "pass": true/false, "comentario": "..." },
            { "categoria": "3. Identificación (Número de Orden)", "pass": true/false, "comentario": "..." },
            { "categoria": "4. Cruce de Somatometría (Estatura/Peso)", "pass": true/false, "comentario": "..." },
            { "categoria": "5. Cruce de Tabaquismo (Fumador)", "pass": true/false, "comentario": "..." }
          ]
        }
        `;

        // ============================================================================
        // PROMPT 4: AUDIOMETRÍA (CRUCE DE DATOS CON HISTORIA CLÍNICA)
        // ============================================================================
        const PROMPT_AUDIOMETRIA = `
        Eres un Auditor Médico evaluando el PDF de una AUDIOMETRÍA.
        
        DATOS DE LA PLATAFORMA PARA CRUZAR:
        - Nombre registrado: ${dp.nombre || 'No proporcionado'}
        - Fecha de Nacimiento: ${dp.nacimiento || 'No proporcionado'}
        - Número de Orden: ${dp.orden || 'No proporcionado'}
        
        DATOS DE HISTORIA CLÍNICA (HC) PARA CRUZAR:
        ${hc ? `- Patológicos: ${hc.audio_patologicos}\n- Exantemáticas: ${hc.audio_exantematicas}\n- Ruido Laboral: ${hc.audio_ruido}` : 'NO DISPONIBLES (La Historia Clínica aún no se ha analizado)'}

        REGLAS ESTRICTAS DE AUDIOMETRÍA:
        1. "Identificación": El Número de Orden debe coincidir con ${dp.orden || 'No proporcionado'}. El Nombre/Apellidos deben coincidir con ${dp.nombre || 'No proporcionado'}. La Fecha de Nacimiento debe coincidir con ${dp.nacimiento || 'No proporcionado'}. (Ignorar Suc, Modelo, Serie, Sexo, Edad, Empresa).
        2. "Antecedentes Personales Patológicos": Si el PDF tiene seleccionado "Diabetes Mellitus", "Hipertensión Arterial Sistémica", "Otitis", "Dislipidemia" o "Disminución de agudeza auditiva", SE DEBE VERIFICAR que haya sido referenciado en la HC. Igualmente con Sarampión, Rubéola, Paperas o Varicela. Si NO HAY DATOS DE HC disponibles, pon pass: false y en comentario: "⚠️ PENDIENTE: Se requiere analizar primero la Historia Clínica para cruzar estos datos".
        3. "Antecedentes Laborales (Ruido)": Si el PDF marca "SI" a exposición a ruido (actual o anterior), las exposiciones descritas (Empresa, Puesto, Antigüedad, Horas, EPP) DEBERÁN estar incluidas en la exposición de RUIDO de la HC. Ten criterio para saber si es la misma exposición aunque falten pequeños detalles. Si marca "NO", no requiere verificación. Si NO HAY DATOS DE HC disponibles, pon pass: false y en comentario: "⚠️ PENDIENTE: Cruzar con Historia Clínica".
        4. "Tablas de Estudio, Diagnóstico y Recomendación": Verifica que el resultado del estudio (tabla) corresponda con lo redactado en "DIAGNÓSTICO". Verifica que, en caso de tener una audiometría en parámetros normales, se redacte en "RECOMENDACIÓN" exactamente: "Realizar estudio de forma anual e ingresar a programa de conservación auditiva".
        (Nota: Antecedentes Heredo Familiares, Hábitos y Costumbres, y Exploración Otológica NO requieren verificación).

        DEVUELVE ÚNICAMENTE un JSON estricto con esta estructura (sin bloques de markdown \`\`\`json):
        {
          "aprobadoGeneral": true/false,
          "motivoPrincipal": "Resumen de la falla o 'Documento congruente y óptimo'",
          "checklist": [
            { "categoria": "1. Identificación", "pass": true/false, "comentario": "..." },
            { "categoria": "2. Antecedentes Personales Patológicos", "pass": true/false, "comentario": "..." },
            { "categoria": "3. Antecedentes Laborales (Ruido)", "pass": true/false, "comentario": "..." },
            { "categoria": "4. Tablas, Diagnóstico y Recomendación", "pass": true/false, "comentario": "..." }
          ]
        }
        `;

        // ============================================================================
        // LÓGICA DE SELECCIÓN DE PROMPT
        // ============================================================================
        if (tipoDocumento === 'Historia Clínica (MINAS)' || tipoDocumento === 'Historia Clínica') {
            promptSeleccionado = PROMPT_HC_MINAS;
        } else if (tipoDocumento === 'Espirometría') {
            promptSeleccionado = PROMPT_ESPIROMETRIA;
        } else if (tipoDocumento === 'Audiometría') {
            promptSeleccionado = PROMPT_AUDIOMETRIA;
        } else {
            promptSeleccionado = PROMPT_HC_NORMAL; // Fallback para documentos genéricos
        }

        // ============================================================================
        // LLAMADA A LA API DE GOOGLE GEMINI
        // ============================================================================
        const requestBody = {
            contents: [{
                parts: [
                    { text: promptSeleccionado },
                    { inline_data: { mime_type: "application/pdf", data: pdfBase64 } }
                ]
            }],
            generationConfig: { response_mime_type: "application/json" }
        };

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${API_KEY}`, {
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

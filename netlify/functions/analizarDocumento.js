// netlify/functions/analizarDocumento.js

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { pdfBase64, tipoDocumento, datosPaciente } = JSON.parse(event.body);
        const API_KEY = process.env.GEMINI_API_KEY;

        if (!API_KEY) {
            return { statusCode: 500, body: JSON.stringify({ error: "Falta configurar GEMINI_API_KEY en Netlify." }) };
        }

        let promptSeleccionado = "";
        
        // Extraemos los datos cruzados
        const dp = datosPaciente || {};
        const hc = dp.datosHC || null; 

        // ============================================================================
        // PROMPT 1: HISTORIA CLÍNICA (SUCURSALES NORMALES)
        // ============================================================================
        const PROMPT_HC_NORMAL = `
        Eres un auditor médico experto de LAP.IA. Analiza estrictamente la Historia Clínica Ocupacional adjunta en PDF. 
        Evalúa las 5 categorías de reglas (Integridad Demográfica, Riesgos Laborales, Patológicos, Congruencia Clínica y Exploración).
        Devuelve ÚNICAMENTE un JSON con: aprobadoGeneral (boolean), motivoPrincipal (string), y checklist (array de objetos con categoria, pass y comentario).
        `;

        // ============================================================================
        // PROMPT 2: HISTORIA CLÍNICA (ESTRICTO MINAS) - NUEVAS REGLAS REESTRUCTURADAS
        // ============================================================================
        const PROMPT_HC_MINAS = `
        Eres el Auditor Médico Supremo de LAP.IA para la división de MINAS.
        A continuación se te entregan las REGLAS EXACTAS Y LITERALES redactadas por la dirección médica.
        Tu trabajo es evaluar el PDF adjunto estrictamente con este manual. NO simplifiques, NO asumas.

        DATOS DE LA PLATAFORMA PARA CRUCE DE IDENTIDAD:
        - Folio de Plataforma: ${dp.folio || 'No proporcionado'}
        - Nombre de Plataforma: ${dp.nombre || 'No proporcionado'}
        - Fecha de Nacimiento de Plataforma: ${dp.nacimiento || 'No proporcionado'}

        --- INICIO DEL MANUAL DE REGLAS MINAS ---
        ### SECCIÓN DE IDENTIFICACIÓN
        1. Folio: Verifica que el folio de la historia clínica coincida EXACTAMENTE con el folio registrado en el expediente de la plataforma.
        2. Nombre: Verifica que el nombre en la historia clínica coincida EXACTAMENTE con el nombre registrado en la plataforma.
        3. Fecha de nacimiento: Verifica que la fecha coincida EXACTAMENTE con la registrada en la plataforma.
        4. Datos que NO REQUIEREN VERIFICACIÓN: Nacionalidad, Originario de, Estado civil, Religión, Empresa, Puesto, Departamento, Escolaridad, Grupo sanguíneo, Acepta transfusiones.
        5. Datos que REQUIEREN VERIFICACIÓN DE LLENADO: Debes verificar que CADA DATO de la siguiente lista SIEMPRE ESTÉ CONTESTADO: Grupo étnico, Discapacidad, Domicilio particular (calle, #ext, #int, colonia, localidad, municipio, estado y C.P.), Teléfono de casa, Teléfono celular, IMSS, RFC, CURP, Contacto de emergencia (Nombre, dirección, parentesco, teléfono, celular).

        ### SECCIÓN ANTECEDENTES LABORALES
        - 1. NO REQUIERE VERIFICACIÓN.
        - 2. Antigüedad: Debe estar registrada obligatoriamente en formato de tiempo (Años o Años con Meses).
        - 3. Orden de Registros: Ordenados cronológicamente (más reciente a más antiguo). En "FUNCIÓN PRINCIPAL", cada registro debe incluir obligatoriamente al menos UN factor de riesgo explícito.
        - A. RIESGOS FÍSICOS: Si es SÍ, verifica detalles estrictos (Ruido, Vibración, Radiación, Iluminación, Temperaturas, Altura, Confinados).
        - B. RIESGOS QUÍMICOS: Si es NO, requiere la leyenda exacta "Niega exposición a SILICE, MONOXIDO DE CARBONO, CIANURO DE HIDROGENO, PLOMO, ESTIRENO, TOLUENO, ETILO BENCENO, XILENO." en Observaciones. Si es SÍ, verifica detalles.
        - C y E. BIOLÓGICOS Y PSICOSOCIALES: NO REQUIEREN VERIFICACIÓN.
        - D. ERGONÓMICOS: Si es SÍ, verifica detalles estrictos.

        ### SECCIÓN DE RIESGOS LABORALES
        - 4 y 5: Si es SÍ, verifica que CADA dato esté contestado (Empresa, causa, días, cuándo, qué le pasó, secuelas, proceso).
        - 6 al 11: NO REQUIEREN VERIFICACIÓN.

        ### SECCIÓN ANTECEDENTES HÁBITOS Y COSTUMBRES
        - 15 al 20, y 22: NO REQUIEREN VERIFICACIÓN.
        - 21 (Mascotas): Si es SÍ, requiere 4 datos obligatorios: Tipo, Cantidad, Intra/extradomiciliarias, y Vacunados/Desparasitados.

        ### SECCIÓN ANTECEDENTES PERSONALES PATOLÓGICOS
        - 23 al 26: Si es SÍ, verificar coherencia.
        - 27: Ignorar aquí.
        - 28 (Fracturas): Si es SÍ, verificar coherencia y en Observaciones debe incluir (Hueso, Año, Tratamiento).
        - 29: Enfermedades, verificar coherencia.
        - 30 (Tatuajes): Si hay tatuajes, en observaciones debe incluir (Región, Tipo, Color, Dimensiones).
        - 31 (Vacunas): Si es Incompleto, verificar qué faltan. Columna FECH debe tener Dosis y Marca. Fila OTRAS puede ir vacía.
        - 32 (Alergias): Si es SÍ, verificar coherencia.
        - OBSERVACIONES: Para cada SÍ (23, 24, 25, 26, 27, 32) debe existir un registro detallado que haga referencia al número.

        ### SECCIÓN INTERROGATORIO POR APARATOS Y SISTEMAS
        - 34: Todo síntoma en "SÍ" DEBE estar descrito en el cuadro de observaciones de su sistema afín incluyendo 4 datos (Síntoma, Antigüedad, Tratamiento, Seguimiento).
        - Alteración de la visión: Debe incluir Diagnóstico, Lentes, Antigüedad y Último ajuste.
        - Uso de prótesis: Si se selecciona, detallar en cuadro de Prótesis.

        ### SECCIÓN DE ANTECEDENTES GINECOOBSTÉTRICOS
        - Sólo femeninos. 36, 38 al 43: NO REQUIEREN VERIFICACIÓN.
        - 37: La suma de Partos+Cesáreas+Abortos debe dar igual al total de Gestaciones (G = P + C + A).

        ### SECCIÓN EXPLORACIÓN FÍSICA
        - 44 al 50: NO REQUIEREN VERIFICACIÓN.
        - 51: X, O, =, W, !!, F deben hacer referencia a piezas/molares O tener la leyenda "SIN DATOS PATOLÓGICOS".
        - POR APARATOS: 
          Grupo A (1,2,3,6,7,8,9,10,11,12,14,15,16,18): Deben tener congruencia O decir "Sin datos patológicos". Ignorar signos de 14, 15, 16.
          Grupo B: 5 (CAP y MTL bilateral), 13 (No palpables), 17, 20, 21, 22 (Normal).
          Grupo C: 4 (Ojos) cruce con Ametropía y Alteración de Visión. 23 (Tatuajes) cruce con 30 (Si no hay, decir "No presentes").
          Grupo D (19, 24-30, Actitud, Observaciones): NO REQUIEREN VERIFICACIÓN.

        ### FIRMA DEL PACIENTE
        - REQUIERE VERIFICACIÓN VISUAL.
        --- FIN DE REGLAS MINAS ---

        Además de la auditoría, DEBES EXTRAER los siguientes datos del paciente para guardarlos en la base de datos y usarlos en futuros estudios:
        1. "estatura": Extraída de la sección 44. SOMATOMETRÍA (Talla).
        2. "peso": Extraído de la sección 44. SOMATOMETRÍA (Peso).
        3. "fuma": Valor de la sección "Hábitos y Costumbres" pregunta 17 (SI/NO).
        4. "fumaDetalles": Si en la 18 dice cuánto fumó o en la sección FUMADOR, extráelo. Si no, déjalo vacío.
        5. "audio_patologicos": Resumen si reporta padecer: Diabetes, Hipertensión, Otitis, Dislipidemia o Disminución auditiva (En preguntas 29 y 34). Si no, "Negados".
        6. "audio_exantematicas": Resumen de la pregunta 27. Si no, "Negados".
        7. "audio_ruido": Resumen exposición a Ruido (Tabla A. Físicos). Si no, "Sin exposición".

        Con base en el manual, genera el reporte JSON.
        DEVUELVE ÚNICAMENTE un JSON estricto con esta estructura (sin markdown):
        {
          "aprobadoGeneral": true/false,
          "motivoPrincipal": "Resumen de la falla o 'Documento óptimo'",
          "datosExtraidosHC": {
              "estatura": "...", "peso": "...", "fuma": "...", "fumaDetalles": "...", "audio_patologicos": "...", "audio_exantematicas": "...", "audio_ruido": "..."
          },
          "checklist": [
            { "categoria": "1. Identidad y Demográficos", "pass": true/false, "comentario": "..." },
            { "categoria": "2. Antecedentes Laborales", "pass": true/false, "comentario": "..." },
            { "categoria": "3. Riesgos Físicos, Químicos y Ergonómicos", "pass": true/false, "comentario": "..." },
            { "categoria": "4. Hábitos (Mascotas)", "pass": true/false, "comentario": "..." },
            { "categoria": "5. Personales Patológicos", "pass": true/false, "comentario": "..." },
            { "categoria": "6. Cruces en Observaciones Patológicas", "pass": true/false, "comentario": "..." },
            { "categoria": "7. Aparatos y Sistemas (34 y Observaciones)", "pass": true/false, "comentario": "..." },
            { "categoria": "8. Ginecoobstétricos (Congruencia)", "pass": true/false, "comentario": "..." },
            { "categoria": "9. Odontología (Pregunta 51)", "pass": true/false, "comentario": "..." },
            { "categoria": "10. Exploración Física (Leyendas y Cruces)", "pass": true/false, "comentario": "..." },
            { "categoria": "11. Firma del Paciente", "pass": true/false, "comentario": "..." }
          ]
        }
        `;

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

        DEVUELVE ÚNICAMENTE un JSON estricto con esta estructura (sin markdown):
        {
          "aprobadoGeneral": true/false,
          "motivoPrincipal": "...",
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
        3. "Antecedentes Laborales (Ruido)": Si el PDF marca "SI" a exposición a ruido, las exposiciones (Empresa, Puesto, Antigüedad, Horas, EPP) DEBERÁN ser congruentes con la exposición de RUIDO de la HC. Si marca "NO", no requiere verificación. Si NO HAY DATOS DE HC disponibles, pon pass: false y en comentario: "⚠️ PENDIENTE: Cruzar con Historia Clínica".
        4. "Tablas de Estudio, Diagnóstico y Recomendación": Verifica que el resultado del estudio (tabla) corresponda con "DIAGNÓSTICO". Si la audiometría es normal, en "RECOMENDACIÓN" debe decir exactamente: "Realizar estudio de forma anual e ingresar a programa de conservación auditiva".

        DEVUELVE ÚNICAMENTE un JSON estricto con esta estructura (sin markdown):
        {
          "aprobadoGeneral": true/false,
          "motivoPrincipal": "...",
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
            promptSeleccionado = PROMPT_HC_NORMAL;
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

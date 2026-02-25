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
        
        // Extraemos los datos cruzados y verificamos si REQUIERE Historia Clínica
        const dp = datosPaciente || {};
        const hc = dp.datosHC || null; 
        const requiereHC = dp.requiereHC === true; // Bandera enviada desde el Frontend

        // ============================================================================
        // TEXTO BASE: REGLAS HISTORIA CLÍNICA (SUCURSALES NORMALES Y LIBRE)
        // ============================================================================
        const REGLAS_HC_BASE = `
        ### SECCIÓN DE IDENTIFICACIÓN
        4. Datos que NO REQUIEREN VERIFICACIÓN: Nacionalidad, Originario de, Estado civil, Religión, Empresa, Puesto, Departamento, Escolaridad, Grupo sanguíneo, Acepta transfusiones.
        5. Datos que REQUIEREN VERIFICACIÓN DE LLENADO: Grupo étnico, Discapacidad, Domicilio particular (calle, # ext, # int, colonia, localidad, municipio, estado y C.P.), Teléfono de casa, Teléfono celular, IMSS, RFC, CURP, Contacto de emergencia (Nombre, dirección, parentesco, teléfono, celular).

        ### SECCIÓN ANTECEDENTES LABORALES
        - 1. NO REQUIERE VERIFICACIÓN.
        - 2. Antigüedad: Formato de tiempo (Años o Años con Meses).
        - 3. Orden de Registros: Cronológicos (Más reciente a más antiguo).
        - A. RIESGOS FÍSICOS: Si es SÍ, verificar: Ruido (Fuente, EPP), Vibración (Fuente, EPP), Radiación (Tipo, área, frecuencia, EPP), Iluminación (Fuente, EPP), Temperaturas (Fuente, grados, EPP), Altura (Metros, EPP), Confinados (Tipo, EPP).
        - B. RIESGOS QUÍMICOS: Si es NO, NO REQUIERE VERIFICACIÓN. Si es SÍ, verificar (Tipo, EPP).
        - C. BIOLÓGICOS y E. PSICOSOCIALES: NO REQUIEREN VERIFICACIÓN.
        - D. ERGONÓMICOS: Si es SÍ, verificar (Tipo de objeto/peso, EPP para carga. Movimiento y segmento. Tipo de postura).
        - RIESGOS LABORALES (4 y 5): Si es SÍ, verificar que cada dato esté lleno (Empresa, causa, días, cuándo, qué pasó, secuelas, proceso). 6 al 11: NO VERIFICAR.
        - OBSERVACIONES DEL EXAMINADOR: NO REQUIERE VERIFICACIÓN.


        ### SECCIÓN HÁBITOS Y COSTUMBRES
        - 12 al 20, y 22: NO REQUIEREN VERIFICACIÓN.
        - 21 (Mascotas): Si es SÍ, requiere 4 datos: Tipo, Cantidad, Intra/extradomiciliarias, Vacunados/Desparasitados.

        ### SECCIÓN PERSONALES PATOLÓGICOS
        - 23 al 26: Si es SÍ, verificar coherencia.
        - 28 (Fracturas): Si es SÍ, verificar coherencia y que en Observaciones incluya (Hueso, Año, Tratamiento).
        - 29: Verificar coherencia.
        - 30 (Tatuajes): Si es SÍ, en observaciones debe incluir (Región, Tipo, Monocromático/policromático, Dimensiones).
        - 31 (Vacunas): Si es Incompleto, verificar qué faltan. Columna FECHA con fecha válida debe tener Dosis y Marca. "OTRAS" puede ir vacía.
        - 32 (Alergias): Si es SÍ, verificar coherencia.
        - OBSERVACIONES: Para cada SÍ (23,24,25,26,27,32) debe existir registro detallado haciendo referencia al número.

        ### SECCIÓN INTERROGATORIO POR APARATOS Y SISTEMAS
        - 34: Todo síntoma en "SÍ" DEBE estar en el cuadro de observaciones de su sistema afín incluyendo 4 datos (Síntoma, Antigüedad, Tratamiento, Seguimiento).
        - Alteración de la visión: Debe incluir Diagnóstico, Lentes, Antigüedad, Último ajuste.
        - Uso de prótesis: Si se selecciona, detallar en cuadro de Prótesis.

        ### SECCIÓN GINECOOBSTÉTRICOS
        - 37: La suma de Partos+Cesáreas+Abortos debe dar igual al total de Gestaciones (G = P + C + A).

        ### SECCIÓN EXPLORACIÓN FÍSICA
        - 51: X, O, =, W, !!, F deben hacer referencia a piezas O decir "SIN DATOS PATOLÓGICOS".
        - POR APARATOS:
          Grupo A (1,2,3,6,7,8,9,10,11,12,14,15,16,18): Congruencia O "Sin datos patológicos". Ignorar signos.
          Grupo B: 5 (CAP y MTL bilateral), 13 (No palpables), 17, 20, 21, 22 (Normal).
          Grupo C: 4 (Ojos) cruce con Ametropía y Alteración Visión. 23 (Tatuajes) cruce con 30.
        
        ### FIRMA DEL PACIENTE
        - REQUIERE VERIFICACIÓN VISUAL.
        `;

        // ============================================================================
        // PROMPT 1: HISTORIA CLÍNICA NORMAL (SUCURSALES)
        // ============================================================================
        const PROMPT_HC_NORMAL = `
        Eres un auditor médico de LAP.IA para sucursales estándar. Evalúa el PDF adjunto.
        
        DATOS DE LA PLATAFORMA PARA CRUCE DE IDENTIDAD:
        - Folio: ${dp.folio || 'No proporcionado'}
        - Nombre: ${dp.nombre || 'No proporcionado'}
        - Fecha de Nacimiento: ${dp.nacimiento || 'No proporcionado'}

        REGLAS DE IDENTIFICACIÓN INICIAL:
        1. Folio: Verifica que coincida EXACTAMENTE con ${dp.folio || 'No proporcionado'}.
        2. Nombre: Verifica que coincida EXACTAMENTE con ${dp.nombre || 'No proporcionado'}.
        3. Fecha de nacimiento: Verifica que coincida EXACTAMENTE con ${dp.nacimiento || 'No proporcionado'}.

        ${REGLAS_HC_BASE}

        Además, DEBES EXTRAER para estudios futuros:
        1. "estatura" (44. Talla). 2. "peso" (44. Peso). 3. "fuma" (17 SÍ/NO). 4. "fumaDetalles" (18). 5. "audio_patologicos" (29 y 34). 6. "audio_exantematicas" (27). 7. "audio_ruido" (Tabla A. Físicos).

        DEVUELVE ÚNICAMENTE un JSON estricto con esta estructura (sin markdown):
        {
          "aprobadoGeneral": true/false, "motivoPrincipal": "...",
          "datosExtraidosHC": { "estatura": "...", "peso": "...", "fuma": "...", "fumaDetalles": "...", "audio_patologicos": "...", "audio_exantematicas": "...", "audio_ruido": "..." },
          "checklist": [
            { "categoria": "1. Identidad (Folio, Nombre, Nacimiento)", "pass": true/false, "comentario": "..." },
            { "categoria": "2. Integridad Demográfica", "pass": true/false, "comentario": "..." },
            { "categoria": "3. Antecedentes Laborales", "pass": true/false, "comentario": "..." },
            { "categoria": "4. Hábitos (Mascotas)", "pass": true/false, "comentario": "..." },
            { "categoria": "5. Personales Patológicos", "pass": true/false, "comentario": "..." },
            { "categoria": "6. Aparatos y Sistemas (Observaciones)", "pass": true/false, "comentario": "..." },
            { "categoria": "7. Ginecoobstétricos y Odontología", "pass": true/false, "comentario": "..." },
            { "categoria": "8. Exploración Física (Leyendas y Cruces)", "pass": true/false, "comentario": "..." },
            { "categoria": "9. Firma del Paciente", "pass": true/false, "comentario": "..." }
          ]
        }`;

        // ============================================================================
        // PROMPT 2: HISTORIA CLÍNICA LIBRE (LABORATORIO IA)
        // ============================================================================
        const PROMPT_HC_LIBRE = `
        Eres el Laboratorio Autónomo de LAP.IA. Evalúa el PDF de la Historia Clínica adjunto.
        IMPORTANTE: Dado que es un análisis libre y no hay paciente registrado, ASUME QUE EL NOMBRE, FOLIO Y FECHA DE NACIMIENTO EN EL DOCUMENTO ESTÁN CORRECTOS. No los califiques como error.

        ${REGLAS_HC_BASE}

        DEVUELVE ÚNICAMENTE un JSON estricto con esta estructura (sin markdown):
        {
          "aprobadoGeneral": true/false, "motivoPrincipal": "...",
          "checklist": [
            { "categoria": "1. Integridad Demográfica", "pass": true/false, "comentario": "..." },
            { "categoria": "2. Antecedentes Laborales", "pass": true/false, "comentario": "..." },
            { "categoria": "3. Hábitos (Mascotas)", "pass": true/false, "comentario": "..." },
            { "categoria": "4. Personales Patológicos", "pass": true/false, "comentario": "..." },
            { "categoria": "5. Aparatos y Sistemas (Observaciones)", "pass": true/false, "comentario": "..." },
            { "categoria": "6. Ginecoobstétricos y Odontología", "pass": true/false, "comentario": "..." },
            { "categoria": "7. Exploración Física (Leyendas y Cruces)", "pass": true/false, "comentario": "..." },
            { "categoria": "8. Firma del Paciente", "pass": true/false, "comentario": "..." }
          ]
        }`;

        // ============================================================================
        // PROMPT 3: HISTORIA CLÍNICA (MINAS)
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
        // PROMPT 4: ESPIROMETRÍA (DINÁMICO CON Y SIN HC)
        // ============================================================================
        const PROMPT_ESPIROMETRIA = `
        Eres un Auditor Médico evaluando el PDF de una ESPIROMETRÍA.
        
        DATOS DE LA PLATAFORMA PARA CRUZAR:
        - Nombre registrado: ${dp.nombre || 'No proporcionado'}
        - Fecha de Nacimiento: ${dp.nacimiento || 'No proporcionado'}
        - Número de Orden: ${dp.orden || 'No proporcionado'}
        
        CONDICIÓN DE HISTORIA CLÍNICA:
        - ¿El paciente requiere Historia Clínica?: ${requiereHC ? 'SÍ' : 'NO'}
        - DATOS EXTRAÍDOS DE HC: ${hc ? `Estatura: ${hc.estatura}, Peso: ${hc.peso}, Fuma: ${hc.fuma}, Detalles Tabaco: ${hc.fumaDetalles}` : (requiereHC ? 'NO DISPONIBLES AÚN' : 'NO APLICA')}

        REGLAS DE ESPIROMETRÍA:
        1. "Fecha Nacimiento": Verifica que coincida con la de Plataforma (${dp.nacimiento || 'No proporcionado'}).
        2. "Nombre y Apellidos": Verifica que coincidan con Plataforma (${dp.nombre || 'No proporcionado'}).
        3. "Identificación Personal": Verifica que coincida con el Número de Orden de Plataforma (${dp.orden || 'No proporcionado'}).
        4. "Estatura y Peso": 
           - Si REQUIERE Historia Clínica (SÍ): Verifica que coincidan con los datos de HC. Si dicen "NO DISPONIBLES AÚN", pon pass: false y comentario "⚠️ PENDIENTE: Se requiere analizar primero la Historia Clínica".
           - Si NO requiere Historia Clínica (NO): Pon pass: true y comentario "Validado - No requiere cruce con HC".
        5. "Fumador": 
           - REGLA BASE (Siempre aplica): Si el PDF marca "SI" o "DEJAR", DEBE tener detalles de cantidad, frecuencia y tiempo anotados a un lado. Si marca "NO", no debe haber detalles.
           - CRUCE (Solo si Requiere HC es SÍ): La respuesta debe coincidir con la HC. Si los datos de HC dicen "NO DISPONIBLES AÚN", pon pass: false y comentario "⚠️ PENDIENTE: Cruzar con Historia Clínica". Si la HC no existe porque no la requiere (NO), solo aplica la regla base y pon pass: true.
        (Nota: Edad, Género, BMI, Profesión, Código Paciente y Grupo Étnico NO requieren verificación, ignóralos).

        DEVUELVE ÚNICAMENTE un JSON estricto con esta estructura (sin markdown):
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
        // PROMPT 5: AUDIOMETRÍA (DINÁMICO CON Y SIN HC)
        // ============================================================================
        const PROMPT_AUDIOMETRIA = `
        Eres un Auditor Médico evaluando el PDF de una AUDIOMETRÍA.
        
        DATOS DE LA PLATAFORMA PARA CRUZAR:
        - Nombre registrado: ${dp.nombre || 'No proporcionado'}
        - Fecha de Nacimiento: ${dp.nacimiento || 'No proporcionado'}
        - Número de Orden: ${dp.orden || 'No proporcionado'}
        
        CONDICIÓN DE HISTORIA CLÍNICA:
        - ¿El paciente requiere Historia Clínica?: ${requiereHC ? 'SÍ' : 'NO'}
        - DATOS EXTRAÍDOS DE HC: ${hc ? `Patológicos: ${hc.audio_patologicos}\nExantemáticas: ${hc.audio_exantematicas}\nRuido Laboral: ${hc.audio_ruido}` : (requiereHC ? 'NO DISPONIBLES AÚN' : 'NO APLICA')}

        REGLAS ESTRICTAS DE AUDIOMETRÍA:
        1. "Identificación": El Número de Orden debe coincidir con ${dp.orden || 'No proporcionado'}. El Nombre/Apellidos deben coincidir con ${dp.nombre || 'No proporcionado'}. La Fecha de Nacimiento debe coincidir con ${dp.nacimiento || 'No proporcionado'}. (Ignorar Suc, Modelo, Serie, Sexo, Edad, Empresa).
        2. "Antecedentes Personales Patológicos": 
           - Si REQUIERE Historia Clínica (SÍ): Si el PDF marca Diabetes, Hipertensión, Otitis, Dislipidemia, Disminución auditiva o Exantemáticas, SE DEBE VERIFICAR que haya sido referenciado en la HC. Si los datos de HC son "NO DISPONIBLES AÚN", pon pass: false y comentario "⚠️ PENDIENTE: Analizar primero la Historia Clínica".
           - Si NO requiere Historia Clínica (NO): Pon pass: true y comentario "Validado - No requiere cruce con HC".
        3. "Antecedentes Laborales (Ruido)": 
           - Si REQUIERE Historia Clínica (SÍ): Si el PDF marca "SI" a exposición a ruido, las exposiciones DEBERÁN ser congruentes con la exposición de RUIDO de la HC. Si marca "NO", no requiere verificación. Si los datos HC dicen "NO DISPONIBLES AÚN", pon pass: false y comentario "⚠️ PENDIENTE: Cruzar con Historia Clínica".
           - Si NO requiere Historia Clínica (NO): Pon pass: true y comentario "Validado - No requiere cruce con HC".
        4. "Tablas de Estudio, Diagnóstico y Recomendación": Verifica que el resultado del estudio (tabla) corresponda con "DIAGNÓSTICO". Si la audiometría es normal, en "RECOMENDACIÓN" debe decir exactamente: "Realizar estudio de forma anual e ingresar a programa de conservación auditiva".

        DEVUELVE ÚNICAMENTE un JSON estricto con esta estructura (sin markdown):
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
        if (tipoDocumento === 'Historia Clínica (Libre)') { promptSeleccionado = PROMPT_HC_LIBRE; } 
        else if (tipoDocumento === 'Historia Clínica') { promptSeleccionado = PROMPT_HC_NORMAL; }
        else if (tipoDocumento === 'Historia Clínica (MINAS)') { promptSeleccionado = PROMPT_HC_MINAS; } 
        else if (tipoDocumento === 'Espirometría') { promptSeleccionado = PROMPT_ESPIROMETRIA; } 
        else if (tipoDocumento === 'Audiometría') { promptSeleccionado = PROMPT_AUDIOMETRIA; } 
        else { promptSeleccionado = PROMPT_HC_NORMAL; }

        const requestBody = { contents: [{ parts: [{ text: promptSeleccionado }, { inline_data: { mime_type: "application/pdf", data: pdfBase64 } }] }], generationConfig: { response_mime_type: "application/json" } };
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
        if (!response.ok) throw new Error(`Google API Error: ${response.status}`);
        const data = await response.json();
        return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: data.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim() };

    } catch (error) { return { statusCode: 500, body: JSON.stringify({ error: error.message }) }; }
};



       

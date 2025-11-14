
'use server';

import { google, sheets_v4 } from 'googleapis';
import { Study, StudyWithCompletedBy, OrderData } from '@/lib/types';
import { formatInTimeZone } from 'date-fns-tz';
import { differenceInYears } from 'date-fns';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

const getAgeFromBirthDateGSheet = (birthDateString?: string): number | null => {
    if (!birthDateString) return null;
    try {
        const dateParts = birthDateString.split(/[-/]/);
        if (dateParts.length !== 3) return null;
        
        let day, month, year;
        
        if (dateParts[0].length === 4) { // YYYY-MM-DD
            year = parseInt(dateParts[0], 10);
            month = parseInt(dateParts[1], 10) - 1;
            day = parseInt(dateParts[2], 10);
        } else if (dateParts[2].length === 4) { // DD/MM/YYYY or MM/DD/YYYY
            day = parseInt(dateParts[0], 10);
            month = parseInt(dateParts[1], 10) - 1;
            year = parseInt(dateParts[2], 10);
        } else {
            return null; // Unsupported format
        }

        if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
        if (month > 11) { [day, month] = [month + 1, day - 1]; }

        const birthDate = new Date(year, month, day);
        if (isNaN(birthDate.getTime())) return null;

        return differenceInYears(new Date(), birthDate);
    } catch { 
        return null; 
    }
}

async function getSheetsClient(): Promise<sheets_v4.Sheets | null> {
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY;

    if (!clientEmail || !privateKey) {
        console.warn("[Google Sheets Auth Warning] GOOGLE_SERVICE_ACCOUNT_EMAIL o GOOGLE_PRIVATE_KEY no están definidas en el entorno. La funcionalidad de Google Sheets estará deshabilitada.");
        return null;
    }
    
    const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');

    try {
        const auth = new google.auth.JWT({
            email: clientEmail,
            key: formattedPrivateKey,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        
        await auth.getAccessToken(); // Verify that auth works
        return google.sheets({ version: 'v4', auth });
    } catch (error: any) {
        console.error("[Google Sheets Auth Error] No se pudo crear el cliente de JWT. Verifica las credenciales:", error.message);
        return null;
    }
}

async function ensureSheetExists(sheets: sheets_v4.Sheets, sheetName: string, headers: string[]) {
    if (!SPREADSHEET_ID) throw new Error("Spreadsheet ID is not defined.");

    try {
        const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        const sheetExists = spreadsheet.data.sheets?.some(s => s.properties?.title === sheetName);

        if (!sheetExists) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: {
                    requests: [{ addSheet: { properties: { title: sheetName } } }],
                },
            });
            
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A1`,
                valueInputOption: 'RAW',
                requestBody: { values: [headers] },
            });
        }
    } catch (error: any) {
        console.error(`[Google Sheets Error] Failed to ensure sheet "${sheetName}" exists:`, error);
        throw error;
    }
}

export async function appendOrderToSheet(studyData: Study): Promise<void> {
  if (!SPREADSHEET_ID) {
    console.warn("[Google Sheets Warning] GOOGLE_SHEET_ID no está definido. Saltando la escritura en la hoja.");
    return;
  }
  
  const sheets = await getSheetsClient();
  if (!sheets) {
    console.warn("[Google Sheets Warning] El cliente de Sheets no pudo ser inicializado. Saltando la escritura en la hoja.");
    return;
  }
  
  try {
    const singleStudy = studyData.studies[0] || {};
    const sheetName = singleStudy.modality || 'OTROS';
    
    const headers = [
      'FECHA/HORA', 'TIPO DE DOCUMENTO', 'N° ID', 'NOMBRE COMPLETO DEL PACIENTE', 'SEXO', 'ENTIDAD EPS', 'FECHA DE NACIMIENTO', 'EDAD',
      'CUPS', 'NOMBRE DEL ESTUDIO REALIZADO', 'CIE10', 'DIAGNOSTICO', 'SERVICIO',
      '# DE EXPOSICIONES', 'T DE EXPOSICIÓN', 'DOSIS', 'KV', 'MA', 'CTDI', 'DLP',
      '# IMAG RECHAZADAS', 'CAUSAS RECHAZO', '# ESTUDIOS REPETIDOS', 'CAUSAS REPETIDOS',
      'RESPONSABLE DEL ESTUDIO', 'CONTRASTE', 'mL ADMINISTRADOS', 'OBSERVACIONES'
    ];

    await ensureSheetExists(sheets, sheetName, headers);
    
    const completionDate = studyData.completionDate instanceof Date ? studyData.completionDate : new Date();
    const formattedDate = formatInTimeZone(completionDate, 'America/Bogota', 'dd/MM/yyyy HH:mm');
    const age = getAgeFromBirthDateGSheet(studyData.patient.birthDate);
    const studyWithCompletedBy = studyData as StudyWithCompletedBy;

    // Default values
    let kv = studyData.kV?.toString() || '';
    let ma = studyData.mA?.toString() || '';
    let timeMs = studyData.timeMs?.toString() || '';
    let dlp = studyData.dlp?.toString() || '';
    let ctdi = studyData.ctdi?.toString() || '';
    let numExposiciones = 'N/A';
    let dosis = 'N/A';

    // Modality-specific logic
    if (sheetName === 'TAC') {
        kv = studyData.kV?.toString() || '120';
        ma = 'Smart mA';
        numExposiciones = 'N/A';
        timeMs = 'N/A';
        dosis = 'N/A';
    } else if (sheetName === 'RX') {
        numExposiciones = '2';
        dosis = 'N/A';
        ctdi = 'N/A';
        dlp = 'N/A';
    } else if (sheetName === 'ECO' || sheetName === 'RMN') {
        numExposiciones = 'N/A';
        timeMs = 'N/A';
        dosis = 'N/A';
        kv = 'N/A';
        ma = 'N/A';
        ctdi = 'N/A';
        dlp = 'N/A';
    }

    const newRow = [
      formattedDate,                          // A
      studyData.patient.idType || '',         // B
      studyData.patient.id || '',             // C
      studyData.patient.fullName || '',       // D
      studyData.patient.sex || '',            // E
      studyData.patient.entidad || '',        // F
      studyData.patient.birthDate || '',      // G
      age !== null ? age : '',                // H
      singleStudy.cups || '',                 // I
      singleStudy.nombre || '',               // J
      studyData.diagnosis.code || '',         // K
      studyData.diagnosis.description || '',  // L
      studyData.service || '',                // M
      numExposiciones,                        // N
      timeMs,                                 // O
      dosis,                                  // P
      kv,                                     // Q
      ma,                                     // R
      ctdi,                                   // S
      dlp,                                    // T
      '0',                                    // U
      'N/A',                                  // V
      '0',                                    // W
      'N/A',                                  // X
      studyWithCompletedBy.completedBy || '', // Y
      studyData.contrastType || 'No',         // Z
      studyData.contrastAdministeredMl || '', // AA
      singleStudy.details || '',              // AB
    ];

    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A1`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [newRow] },
    });
    console.log(`[Google Sheets] Successfully appended row for study ${studyData.id}.`);
    
  } catch (error) {
    console.error(`[Google Sheets Error] Failed to append data for study ${studyData.id}:`, error);
  }
}

export async function appendOrUpdateRemissionSheet(data: OrderData & { remissionFileUrls?: { [key: string]: string } }, studyId: string): Promise<void> {
    if (!SPREADSHEET_ID) {
        console.warn("[Google Sheets Warning] GOOGLE_SHEET_ID no está definido.");
        return;
    }

    const sheets = await getSheetsClient();
    if (!sheets) {
        console.warn("[Google Sheets Warning] El cliente de Sheets no pudo ser inicializado.");
        return;
    }

    const sheetName = 'Remisiones';
    const headers = [
        'FECHA/HORA', 'TIPO DE DOCUMENTO', 'N° ID', 'NOMBRE COMPLETO DEL PACIENTE', 'SEXO', 'ENTIDAD EPS', 'FECHA DE NACIMIENTO', 'EDAD', 
        'CUPS', 'NOMBRE DEL ESTUDIO REALIZADO', 'CIE10', 'DIAGNOSTICO', 'OBSERVACIONES', 'ESPECIALISTA', 'REGISTRO MEDICO', 
        'CONTRASTADO', 'BAJO SEDACION', 'NOTA DE CARGO', 'ORDEN MEDICA', 'EVOLUCION', 'AUTORIZACION', 'RECORDATORIO', 'INFORME', 'ID DE REMISION'
    ];
    
    try {
        await ensureSheetExists(sheets, sheetName, headers);

        const getRows = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!X2:X`, // Column X for REMISSION ID, start from row 2
        });

        const rows = getRows.data.values;
        let rowIndex = -1;
        if (rows) {
            rowIndex = rows.findIndex(row => row[0] === studyId);
        }

        const age = getAgeFromBirthDateGSheet(data.patient.birthDate);
        const singleStudy = data.studies[0] || {};
        
        const rowData = [
            formatInTimeZone(new Date(), 'America/Bogota', 'dd/MM/yyyy HH:mm:ss'),
            data.patient.idType || '',
            data.patient.id || '',
            data.patient.fullName || '',
            data.patient.sex || '',
            data.patient.entidad || '',
            data.patient.birthDate || '',
            age !== null ? age : '',
            singleStudy.cups || '',
            singleStudy.nombre || '',
            data.diagnosis.code || '',
            data.diagnosis.description || '',
            singleStudy.details || '',
            data.orderingPhysician?.name || '',
            data.orderingPhysician?.register || '',
            (data as any).requiereContraste ? 'Sí' : 'No', // Adjusted property name
            (data as any).bajoSedacion ? 'Sí' : 'No', // Adjusted property name
            data.remissionFileUrls?.notaCargoUrl || '',
            data.remissionFileUrls?.ordenMedicaUrl || '',
            data.remissionFileUrls?.evolucionUrl || '',
            data.remissionFileUrls?.authorizationUrl || '', 
            data.remissionFileUrls?.recordatorioUrl || '', 
            data.remissionFileUrls?.informeUrl || '',
            studyId,
        ];

        if (rowIndex !== -1) {
            const actualRowIndex = rowIndex + 2; // +2 because we start searching from row 2
            
            const existingRowResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A${actualRowIndex}:${String.fromCharCode(65 + headers.length - 1)}${actualRowIndex}`,
            });
            const existingRow = existingRowResponse.data.values ? existingRowResponse.data.values[0] : [];
            
            const updatedRow = [...existingRow];
            rowData.forEach((value, index) => {
                 if (value || value === '') { // Update if new value is present or is an empty string
                    updatedRow[index] = value;
                }
            });
            
             // Ensure the row has the correct number of columns
            while(updatedRow.length < headers.length) {
                updatedRow.push('');
            }

            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A${actualRowIndex}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [updatedRow] },
            });
             console.log(`[Google Sheets] Successfully updated row ${actualRowIndex} for remission ${studyId}.`);
        } else {
            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A1`,
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                requestBody: { values: [rowData] },
            });
             console.log(`[Google Sheets] Successfully appended new row for remission ${studyId}.`);
        }

    } catch (error) {
        console.error(`[Google Sheets Error] Failed to append/update remission data for study ${studyId}:`, error);
    }
}
    

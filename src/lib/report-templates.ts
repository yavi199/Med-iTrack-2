
/**
 * @fileOverview Contiene las plantillas de texto para la generación de informes radiológicos.
 * 
 * Cada clave en el objeto `reportTemplates` corresponde a un código CUPS de un estudio.
 * El valor es un string de plantilla que se centra únicamente en los hallazgos médicos.
 * Los datos del paciente y del médico se añaden por separado en la plantilla del PDF.
 */

export const reportTemplates: Record<string, string> = {
};

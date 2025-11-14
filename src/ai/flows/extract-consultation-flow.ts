'use server';
/**
 * @fileOverview This file defines a Genkit flow to extract structured data about medical consultations from orders.
 *
 * - extractConsultationData - An async function that takes a medical order and returns structured consultation data.
 */

import {ai} from '@/ai/genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { ExtractOrderInputSchema, OrderDataSchema, type ExtractOrderInput, type ExtractOrderOutput } from '@/lib/schemas/extract-order-schema';


export async function extractConsultationData(input: ExtractOrderInput): Promise<ExtractOrderOutput> {
  return extractConsultationFlow(input);
}

const prompt = ai.definePrompt({
  name: 'extractConsultationPrompt',
  input: {schema: ExtractOrderInputSchema},
  output: {schema: OrderDataSchema},
  model: googleAI.model('gemini-2.5-flash'),
  prompt: `Analiza la imagen de la orden médica y extrae la información solicitada en el esquema de salida JSON.

- Busca campos como "Nombres" o "Paciente" para el nombre completo del paciente.
- Para la identificación, busca "Documento", "Identificación" o "ID". Separa el tipo (CC, TI, etc.) en 'idType' y el número en 'id'.
- Busca "Administradora" o "Entidad" para la aseguradora.
- Busca "Fecha Nacimiento", "Edad" y "Sexo".
- Busca "Diagnostico" para la descripción del diagnóstico.
- Busca la fecha de emisión de la orden y colócala en el campo 'orderDate' en formato DD/MM/AAAA.
- Si está disponible, extrae el nombre y número de registro del médico que solicita el estudio.
- Busca "N° Admisión" o "Admisión" para el campo 'admissionNumber'.
- Busca "Ref" para el campo 'referenceNumber'.

- En la sección de servicios ordenados, tu tarea es identificar y extraer **TODAS las solicitudes de CONSULTA CON ESPECIALISTAS** que aparezcan. Debes devolver una lista completa. IGNORA y no incluyas en la lista los demás procedimientos como estudios de imagen, laboratorios, electrocardiogramas o cirugías.
  - Para cada consulta válida, extrae el "CUPS" y la "DESCRIPCION".
  - Para el campo 'modality', usa la especialidad encontrada (ej. 'MEDICINA INTERNA'). **MUY IMPORTANTE: El valor de 'modality' DEBE ESTAR EN MAYÚSCULAS Y SIN TILDES** (ej. 'ANESTESIOLOGIA' en lugar de 'Anestesiología').

- El campo 'requiresCreatinine' siempre debe ser falso para las consultas.

Medical Order: {{media url=medicalOrderDataUri}}

Return the extracted data in JSON format.
`,
});

const normalizeString = (str: string) => {
    if (!str) return '';
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
};

const extractConsultationFlow = ai.defineFlow(
  {
    name: 'extractConsultationFlow',
    inputSchema: ExtractOrderInputSchema,
    outputSchema: OrderDataSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    if (!output) {
      throw new Error('El modelo de IA no pudo generar un resultado válido. Asegúrese de que la imagen sea clara y tenga buena resolución.');
    }
    // Ensure modality is uppercase and normalized
    if (output.studies) {
      output.studies.forEach(study => {
        if (study.modality) {
          study.modality = normalizeString(study.modality);
        }
      });
    }
    return output;
  }
);

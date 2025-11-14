
'use server';
/**
 * @fileOverview This file defines a Genkit flow to extract structured data from medical orders (PDF or image).
 *
 * - extractOrderFlow - An async function that takes a medical order and returns structured data.
 */

import {ai} from '@/ai/genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { ExtractOrderInputSchema, OrderDataSchema, type ExtractOrderInput, type ExtractOrderOutput } from '@/lib/schemas/extract-order-schema';


export async function extractOrderData(input: ExtractOrderInput): Promise<ExtractOrderOutput> {
  return extractOrderFlow(input);
}

const prompt = ai.definePrompt({
  name: 'extractOrderPrompt',
  input: {schema: ExtractOrderInputSchema},
  output: {schema: OrderDataSchema},
  model: googleAI.model('gemini-2.5-flash'),
  prompt: `Analiza la imagen de la orden médica y extrae la información solicitada en el esquema de salida JSON.

- Busca campos como "Nombres" o "Paciente" para el nombre completo del paciente.
- Para la identificación, busca "Documento", "Identificación" o "ID". Separa el tipo (CC, TI, etc.) en 'idType' y el número en 'id'.
- Busca "Administradora" o "Entidad" para la aseguradora.
- Busca "Fecha Nacimiento", "Edad" y "Sexo".
- Busca "Diagnostico" para la descripción del diagnóstico.
- Si está disponible, extrae el nombre y número de registro del médico que solicita el estudio.
- Busca "N° Admisión" o "Admisión" para el campo 'admissionNumber'.
- Busca "Ref" para el campo 'referenceNumber'.

- En la sección de servicios ordenados, tu tarea es identificar y extraer **ÚNICAMENTE los estudios de imagen (Radiografía, Tomografía, Ecografía, etc.)** que aparezcan. Debes devolver una lista completa. IGNORA y no incluyas en la lista los demás procedimientos como consultas, laboratorios, electrocardiogramas o cirugías.
  - Para cada estudio de imagen válido, extrae el "CUPS", la "DESCRIPCION" y la "OBSERVACION ADICIONAL".
  - Usa la abreviatura de la modalidad ('TAC', 'RX', 'ECO') en el campo 'modality'.

- Un estudio requiere creatinina **ÚNICAMENTE** si es una Tomografía (TAC) y la orden menciona explícitamente "CON CONTRASTE". En cualquier otro caso, o si la orden solo dice "UROTAC" sin especificar contraste, 'requiresCreatinine' debe ser falso.

Medical Order: {{media url=medicalOrderDataUri}}

Return the extracted data in JSON format.
`,
});

const extractOrderFlow = ai.defineFlow(
  {
    name: 'extractOrderFlow',
    inputSchema: ExtractOrderInputSchema,
    outputSchema: OrderDataSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    if (!output) {
      throw new Error('El modelo de IA no pudo generar un resultado válido. Asegúrese de que la imagen sea clara y tenga buena resolución.');
    }
    return output;
  }
);

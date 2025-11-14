
import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';

export const ai = genkit({
  plugins: [
    googleAI({
      apiVersion: 'v1beta',
      project: 'med-itrack-hyyat',
      location: 'us-central1',
    }),
  ],
});

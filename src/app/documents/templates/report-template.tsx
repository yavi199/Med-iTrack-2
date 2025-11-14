
'use client';
import type { StudyWithCompletedBy } from '@/lib/types';
import { format, intervalToDuration } from 'date-fns';
import { DocumentHeader } from '@/components/app/document-header';

const isValidDate = (date: any): date is Date => {
    return date instanceof Date && !isNaN(date.getTime());
}

const getAgeString = (birthDate?: Date | null): string => {
    if (!isValidDate(birthDate)) return 'N/A';
    try {
        const duration = intervalToDuration({ start: birthDate, end: new Date() });
        
        const parts: string[] = [];
        if (duration.years && duration.years > 0) parts.push(`${duration.years} años`);
        if (duration.months && duration.months > 0) parts.push(`${duration.months} meses`);
        if (duration.days && duration.days > 0) parts.push(`${duration.days} días`);
        
        return parts.join(', ') || 'Recién nacido';
    } catch {
        return 'N/A';
    }
};

interface ReportTemplateProps {
    study: StudyWithCompletedBy;
    reportText: string;
    radiologist: { name: string; specialty: string; register: string; };
}

export function ReportTemplate({ study, reportText, radiologist }: ReportTemplateProps) {
    const readingDate = isValidDate(study.readingDate) ? study.readingDate : new Date();
    
    const formattedReadingDate = format(readingDate, 'dd/MM/yyyy HH:mm');
    
    const birthDate = study.patient.birthDate;
    const age = getAgeString(birthDate as Date | null);
    const mainStudy = study.studies[0] || {};
    
    const formattedBirthDate = isValidDate(birthDate as Date) 
        ? format(birthDate as Date, 'dd/MM/yyyy') 
        : 'N/A';
    
    return (
        <div 
            className="bg-white w-[8.5in] min-h-[11in] shadow-lg print:shadow-none mx-auto p-10 flex flex-col"
            style={{ fontFamily: 'Arial, sans-serif' }}
        >
            <div className="flex-grow">
                <DocumentHeader
                    study={study}
                    title="INFORME IMAGENOLÓGICO"
                    code=""
                    version=""
                    totalPages={1}
                />
                
                {/* Cuerpo del Informe */}
                <div className="mt-4 text-[10pt] whitespace-pre-wrap leading-relaxed">
                    <div dangerouslySetInnerHTML={{ __html: (reportText || '').replace(/(HALLAZGOS:|IMPRESIÓN DIAGNÓSTICA:)/gi, '<h4 class="font-bold">$1</h4>').replace(/\\n/g, '<br />') }} />
                </div>
            </div>
            {/* Firma */}
            <div className="pt-16 mt-auto">
                <div className="border-t border-gray-600 pt-1 w-3/5 mr-auto ml-0 text-center">
                    <p className="text-sm font-bold">{radiologist.name}</p>
                    <p className="text-xs">{radiologist.specialty}</p>
                    {radiologist.register && <p className="text-xs">Reg. Médico: {radiologist.register}</p>}
                </div>
            </div>
        </div>
    );
}

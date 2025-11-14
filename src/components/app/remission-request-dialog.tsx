
"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import { createRemissionAction } from '@/app/actions';
import type { Study } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { app } from "@/lib/firebase";
import { format } from 'date-fns';
import { FileUpload, type FileUploadStatus } from './file-upload';
import { Card, CardContent } from '../ui/card';
import { User, Fingerprint, CalendarDays, Building } from 'lucide-react';

const storage = getStorage(app);

type UploadState = {
    [key: string]: {
        status: FileUploadStatus;
        url: string | null;
        error: string | null;
        file: File | null;
    };
};

const initialUploadState: UploadState = {
    notaCargo: { status: 'idle', url: null, error: null, file: null },
    ordenMedica: { status: 'idle', url: null, error: null, file: null },
    evolucion: { status: 'idle', url: null, error: null, file: null },
};

interface RemissionRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studyData: Study | null;
  initialFile?: File | null;
}

const uploadFileToStorage = async (file: File, patientName: string, patientId: string, docType: string): Promise<string> => {
    const safePatientName = patientName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').toUpperCase();
    const patientFolder = `${safePatientName}_${patientId}`;
    const fileExtension = file.name.split('.').pop() || 'pdf';
    const fileName = `${docType}_${Date.now()}.${fileExtension}`;
    const folderPath = `remissions/${patientFolder}`;
    const storageRef = ref(storage, `${folderPath}/${fileName}`);
    
    await uploadBytes(storageRef, file, { contentType: file.type });
    const downloadURL = await getDownloadURL(storageRef);
    return downloadURL;
};

const serializeStudyData = (study: Study | null): any => {
    if (!study) return null;
    const { requestDate, completionDate, readingDate, orderDate, ...rest } = study;
    const serialized = { ...rest, id: study.id } as any; // Ensure ID is always included

    if (requestDate) serialized.requestDate = (requestDate as any).toDate().toISOString();
    if (completionDate) serialized.completionDate = (completionDate as any).toDate().toISOString();
    if (readingDate) serialized.readingDate = (readingDate as any).toDate().toISOString();
    
    // Check if orderDate is a Timestamp object with toDate method, or already a string.
    if (orderDate) {
      if (typeof (orderDate as any).toDate === 'function') {
        serialized.orderDate = (orderDate as any).toDate().toISOString();
      } else if (typeof orderDate === 'string') {
        serialized.orderDate = orderDate;
      }
    }
    
    return serialized;
};


export function RemissionRequestDialog({ open, onOpenChange, studyData: initialStudyData, initialFile = null }: RemissionRequestDialogProps) {
  const { toast } = useToast();
  const { userProfile } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>(initialUploadState);

  const handleFileUpload = useCallback(async (key: string, file: File | null) => {
    if (!file) {
         setUploadState(prev => ({
            ...prev,
            [key]: { status: 'idle', url: null, error: null, file: null }
        }));
        return;
    }
    
    if (!initialStudyData?.patient.fullName || !initialStudyData?.patient.id) {
        setUploadState(prev => ({
            ...prev,
            [key]: { status: 'error', url: null, error: "Datos del paciente no disponibles.", file }
        }));
        return;
    }
    
    setUploadState(prev => ({
        ...prev,
        [key]: { status: 'uploading', url: null, error: null, file }
    }));

    try {
        const url = await uploadFileToStorage(file, initialStudyData.patient.fullName, initialStudyData.patient.id, key);
        setUploadState(prev => ({
            ...prev,
            [key]: { status: 'success', url, error: null, file }
        }));
    } catch (error: any) {
        console.error(`Error uploading ${key}:`, error);
        setUploadState(prev => ({
            ...prev,
            [key]: { status: 'error', url: null, error: error.message || "Error al subir.", file }
        }));
    }
  }, [initialStudyData]);

  useEffect(() => {
    if (open && initialFile) {
        // This is the Nota de Cargo, as per user's flow
        handleFileUpload('notaCargo', initialFile);
    }
  }, [open, initialFile, handleFileUpload]);


  const resetDialog = useCallback(() => {
    setIsSubmitting(false);
    setUploadState(initialUploadState);
  }, []);

  useEffect(() => {
    if (!open) {
      resetDialog();
    }
  }, [open, resetDialog]);
  
  const allFilesUploaded = uploadState.notaCargo.status === 'success' && uploadState.ordenMedica.status === 'success' && uploadState.evolucion.status === 'success';

  const onSubmit = async () => {
    if (!initialStudyData || !userProfile || !allFilesUploaded) return;

    setIsSubmitting(true);
    try {
        const serializedData = serializeStudyData(initialStudyData);
        if (!serializedData) {
            throw new Error("No se pudieron serializar los datos del estudio.");
        }

        const result = await createRemissionAction({
            studyData: serializedData,
            remissionData: {
                notaCargoUrl: uploadState.notaCargo.url!,
                ordenMedicaUrl: uploadState.ordenMedica.url!,
                evolucionUrl: uploadState.evolucion.url!,
            },
            userProfile
        });

        if (result.success) {
            toast({ title: 'Remisión Registrada', description: `Se ha creado el registro para ${initialStudyData.patient.fullName} en la hoja de cálculo.` });
            onOpenChange(false);
        } else {
             throw new Error(result.error || 'No se pudo crear la remisión.');
        }

    } catch (error: any) {
        console.error("Error creating remission:", error);
        toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
        setIsSubmitting(false);
    }
  };
  
  if (!initialStudyData) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-headline text-xl">Generar Remisión Externa</DialogTitle>
          <DialogDescription>
            Adjunte los documentos requeridos para completar la remisión.
          </DialogDescription>
        </DialogHeader>
        
        <Card className="bg-muted/50">
            <CardContent className="p-4 space-y-2">
                <h4 className="font-bold text-base">{initialStudyData.patient.fullName}</h4>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5"><User className="h-4 w-4"/> {initialStudyData.studies[0]?.nombre}</span>
                    <span className="flex items-center gap-1.5"><Fingerprint className="h-4 w-4"/> {initialStudyData.patient.id}</span>
                </div>
            </CardContent>
        </Card>
        
        <div className="space-y-3 py-4">
            <FileUpload
                id="nota-cargo-upload"
                label="Nota de Cargo (NC)"
                status={uploadState.notaCargo.status}
                fileName={uploadState.notaCargo.file?.name}
                errorMessage={uploadState.notaCargo.error}
                onFileSelect={(file) => handleFileUpload('notaCargo', file)}
            />
             <FileUpload
                id="orden-medica-upload"
                label="Orden Médica (OM)"
                status={uploadState.ordenMedica.status}
                fileName={uploadState.ordenMedica.file?.name}
                errorMessage={uploadState.ordenMedica.error}
                onFileSelect={(file) => handleFileUpload('ordenMedica', file)}
            />
            <FileUpload
                id="evolucion-upload"
                label="Evolución"
                status={uploadState.evolucion.status}
                fileName={uploadState.evolucion.file?.name}
                errorMessage={uploadState.evolucion.error}
                onFileSelect={(file) => handleFileUpload('evolucion', file)}
            />
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" onClick={onSubmit} disabled={isSubmitting || !allFilesUploaded}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Registrar Remisión"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

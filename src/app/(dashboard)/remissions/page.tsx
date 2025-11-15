"use client";

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/auth-context';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Remission, RemissionStatus } from '@/lib/types';
import { format } from 'date-fns';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle, Mail, Download, Send, Check, XCircle, CheckCircle2, FileUp, CalendarCheck, CalendarClock, Clock, User, Fingerprint, CalendarDays, Building, Stethoscope } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { updateRemissionStatusAction, uploadAuthorizationAndUpdateRemissionAction, uploadReminderAndUpdateRemissionAction, uploadReportAndUpdateRemissionAction, scheduleRemissionAppointmentAction } from '@/app/actions';
import { epsEmailMap } from '@/lib/eps-data';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { FileUpload, type FileUploadStatus } from '@/components/app/file-upload';
import { cn } from '@/lib/utils';
import { ScheduleAppointmentDialog } from '@/components/app/schedule-appointment-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type UploadDialogType = 'authorization' | 'reminder' | 'informe';

interface DocumentUploadDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    remission: Remission | null;
    uploadType: UploadDialogType;
    onComplete: () => void;
}

function DocumentUploadDialog({ open, onOpenChange, remission, uploadType, onComplete }: DocumentUploadDialogProps) {
    const { toast } = useToast();
    const { user } = useAuth();
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<FileUploadStatus>('idle');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const dialogConfig = {
        authorization: {
            title: "Cargar Documento de Autorización",
            description: "Adjunte el archivo PDF de la autorización para marcar esta remisión como autorizada.",
            buttonText: "Subir y Autorizar",
            action: uploadAuthorizationAndUpdateRemissionAction,
            label: "Documento de Autorización"
        },
        reminder: {
            title: "Cargar Recordatorio de Cita",
            description: "Adjunte el recordatorio de la cita (PDF o imagen). Esto cambiará el estado a 'Programado'.",
            buttonText: "Subir y Marcar como Programado",
            action: uploadReminderAndUpdateRemissionAction,
            label: "Documento de Recordatorio"
        },
        informe: {
            title: "Cargar Informe Final",
            description: "Adjunte el informe final del estudio para marcar la remisión como realizada.",
            buttonText: "Subir y Marcar como Realizado",
            action: uploadReportAndUpdateRemissionAction,
            label: "Documento de Informe"
        }
    };
    
    const config = dialogConfig[uploadType];

    useEffect(() => {
        if (!open) {
            setFile(null);
            setStatus('idle');
            setError(null);
            setSubmitting(false);
        }
    }, [open]);

    const handleFileSelect = (selectedFile: File | null) => {
        if (selectedFile) {
            setFile(selectedFile);
            setStatus('success');
            setError(null);
        } else {
            setFile(null);
            setStatus('idle');
        }
    };
    
    const handleSubmit = async () => {
        if (!file || !remission || !user) return;
        setSubmitting(true);
        setStatus('uploading');
        
        try {
            const idToken = await user.getIdToken();
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = async () => {
                const dataUri = reader.result as string;
                const result = await config.action(remission.id, dataUri, idToken);

                if (result.success) {
                    toast({ title: "Documento Subido", description: `El estado de la remisión ha sido actualizado.` });
                    onComplete();
                    onOpenChange(false);
                } else {
                    throw new Error(result.error || 'Ocurrió un error inesperado.');
                }
            };
            reader.onerror = (err) => {
                throw new Error("No se pudo leer el archivo seleccionado.");
            };
        } catch (e: any) {
            console.error(e);
            setStatus('error');
            setError(e.message);
            toast({ variant: 'destructive', title: 'Error al Subir', description: e.message });
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{config.title}</DialogTitle>
                    <DialogDescription>
                        {config.description}
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 min-h-[160px] flex items-center justify-center">
                     <FileUpload
                        id={`${uploadType}-upload`}
                        label={config.label}
                        status={status}
                        fileName={file?.name}
                        errorMessage={error}
                        onFileSelect={handleFileSelect}
                    />
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancelar</Button>
                    <Button onClick={handleSubmit} disabled={!file || submitting}>
                        {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}
                        {config.buttonText}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}


const DocumentButton = ({ label, fullLabel, url }: { label: string; fullLabel: string; url?: string }) => {
    const isActive = !!url;

    return (
        <TooltipProvider delayDuration={100}>
            <Tooltip>
                <TooltipTrigger asChild>
                     <Button
                        asChild={isActive}
                        variant="outline"
                        size="sm"
                        className={cn(
                           "h-10 px-2 py-1 text-sm font-bold w-full",
                           isActive ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-gray-100 text-gray-400 cursor-not-allowed"
                        )}
                        disabled={!isActive}
                    >
                        {isActive ? (
                            <a href={url} target="_blank" rel="noopener noreferrer">{label}</a>
                        ) : (
                            <span>{label}</span>
                        )}
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>{fullLabel}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};


export default function RemissionsPage() {
    const { userProfile, loading: authLoading } = useAuth();
    const router = useRouter();
    const { toast } = useToast();
    const [remissions, setRemissions] = useState<Remission[]>([]);
    const [loading, setLoading] = useState(true);
    const [generatingPdf, setGeneratingPdf] = useState<string | null>(null);
    const [selectedRemission, setSelectedRemission] = useState<Remission | null>(null);
    const [uploadDialogType, setUploadDialogType] = useState<UploadDialogType>('authorization');
    const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
    const [isScheduling, setIsScheduling] = useState(false);

    useEffect(() => {
        if (!authLoading && userProfile?.rol !== 'administrador') {
            router.push('/');
        }
    }, [userProfile, authLoading, router]);

    useEffect(() => {
        if (!userProfile || userProfile.rol !== 'administrador') {
            setRemissions([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        const q = query(collection(db, 'remissions'), orderBy('createdAt', 'desc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const remissionsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Remission));
            setRemissions(remissionsData);
            setLoading(false);
        }, (error) => {
            if (error.code !== 'permission-denied') {
                console.error("Error fetching remissions:", error);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, [userProfile]);

    const getEmailForEntidad = (entidad: string): string => {
        const normalizedEntidad = entidad.toLowerCase().replace(/[^a-z0-9]/g, '');
        for (const key in epsEmailMap) {
            if (normalizedEntidad.includes(key)) {
                return epsEmailMap[key];
            }
        }
        return '';
    };

    const handleRequestAuthorization = async (remission: Remission) => {
        if (!remission) return;
    
        const to = getEmailForEntidad(remission.patient.entidad);
        const subject = `SOLICITUD DE ${remission.studies[0]?.nombre} - ${remission.patient.fullName} (${remission.patient.id})`;
        
        let body = `Estimados ${remission.patient.entidad},\n\n`;
        body += `Por medio del presente, solicito la realización del siguiente estudio:\n\n`;
        body += `---------------------------------------------------\n`;
        body += `DATOS DEL PACIENTE:\n`;
        body += `---------------------------------------------------\n`;
        body += `- Nombre: ${remission.patient.fullName}\n`;
        body += `- Identificación: ${remission.patient.idType || 'ID'} ${remission.patient.id}\n`;
        body += `- Entidad: ${remission.patient.entidad}\n\n`;
        body += `---------------------------------------------------\n`;
        body += `DATOS DEL ESTUDIO SOLICITADO:\n`;
        body += `---------------------------------------------------\n`;
        body += `- Estudio: ${remission.studies[0]?.nombre}\n`;
        body += `- Código CUPS: ${remission.studies[0]?.cups}\n`;
        body += `- Diagnóstico: ${remission.diagnosis.description}\n\n`;
        body += `---------------------------------------------------\n`;
        body += `DATOS DEL MÉDICO SOLICITANTE:\n`;
        body += `---------------------------------------------------\n`;
        body += `- Nombre: ${remission.orderingPhysician?.name || 'No especificado'}\n`;
        body += `- Registro Médico: ${remission.orderingPhysician?.register || 'No especificado'}\n\n`;
        body += `Agradecemos su pronta gestión.\n\n`;
        body += `Saludos cordiales.`;
        
        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.open(gmailUrl, '_blank');
        
        await updateRemissionStatusAction(remission.id, 'Solicitado');
        toast({ title: 'Estado Actualizado', description: 'La remisión se ha marcado como "Aut. Solicitada".' });
    };

    const handleGenerateAuthorization = async (remissionId: string) => {
        setGeneratingPdf(remissionId);
        const printWindow = window.open(`/documents/${remissionId}/authorization?source=remissions`, '_blank');
        if(printWindow) {
            printWindow.onload = () => {
                setTimeout(() => {
                    printWindow.print();
                }, 500);
            };
        }
        await updateRemissionStatusAction(remissionId, 'Solicitado');
        toast({ title: 'Estado Actualizado', description: 'La remisión se ha marcado como "Aut. Solicitada".' });
        setGeneratingPdf(null);
    };

    const handleRequestAppointment = async (remission: Remission) => {
        if (!remission) return;

        const to = 'citasmedica.ratc@gmail.com';
        const subject = `SOLICITUD DE CITA: ${remission.studies[0]?.nombre} - ${remission.patient.fullName}`;
        
        let body = `Estimados, buen día.\n\n`;
        body += `Por medio del presente, solicito agendar una cita para la realización del siguiente estudio, el cual ya se encuentra autorizado:\n\n`;
        body += `---------------------------------------------------\n`;
        body += `DATOS DEL PACIENTE:\n`;
        body += `---------------------------------------------------\n`;
        body += `- Nombre: ${remission.patient.fullName}\n`;
        body += `- Identificación: ${remission.patient.idType || 'ID'} ${remission.patient.id}\n`;
        body += `- Entidad: ${remission.patient.entidad}\n\n`;
        body += `---------------------------------------------------\n`;
        body += `DATOS DEL ESTUDIO AUTORIZADO:\n`;
        body += `---------------------------------------------------\n`;
        body += `- Estudio: ${remission.studies[0]?.nombre}\n`;
        body += `- Código CUPS: ${remission.studies[0]?.cups}\n\n`;
        body += `Adjuntamos la autorización correspondiente.\n\n`;
        body += `Agradecemos su pronta colaboración para la asignación de la cita.\n\n`;
        body += `Saludos cordiales.`;
        
        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.open(gmailUrl, '_blank');
        
        await updateRemissionStatusAction(remission.id, 'Cupo Solicitado');
        toast({ title: 'Estado Actualizado', description: 'La remisión se ha marcado como "Cupo Solicitado".' });
    };


    const statusConfig: Record<RemissionStatus, { icon: React.ElementType, label: string, style: string }> = {
        Pendiente: { icon: AlertTriangle, label: "Pendiente", style: "bg-red-500 hover:bg-red-600 text-white" },
        Solicitado: { icon: Send, label: "Solicitada", style: "bg-blue-500 hover:bg-blue-600 text-white" },
        Autorizado: { icon: Check, label: "Autorizado", style: "bg-teal-600 hover:bg-teal-700 text-white" },
        "Cupo Solicitado": { icon: CalendarCheck, label: "Cupo Sol.", style: "bg-purple-600 hover:bg-purple-700 text-white" },
        Programado: { icon: CalendarClock, label: "Programado", style: "bg-green-600 hover:bg-green-700 text-white" },
        Vencido: { icon: XCircle, label: "Vencido", style: "bg-gray-500 text-white" },
        Realizado: { icon: CheckCircle2, label: "Realizado", style: "bg-indigo-600 text-white" },
    };
    
    const handleStatusClick = (remission: Remission) => {
        setSelectedRemission(remission);
        if (remission.status === 'Solicitado') {
            setUploadDialogType('authorization');
            setIsUploadDialogOpen(true);
        } else if (remission.status === 'Autorizado') {
            handleRequestAppointment(remission);
        } else if (remission.status === 'Cupo Solicitado') {
             setUploadDialogType('reminder');
             setIsUploadDialogOpen(true);
        } else if (remission.status === 'Programado') {
            if (!remission.appointmentDate) {
                setIsScheduling(true);
            } else {
                setUploadDialogType('informe');
                setIsUploadDialogOpen(true);
            }
        }
    };


    if (authLoading || loading || !userProfile || userProfile.rol !== 'administrador') {
        return (
            <div className="container mx-auto py-6 space-y-6">
                <Skeleton className="h-10 w-64" />
                <Skeleton className="h-4 w-96" />
                <Card>
                    <CardHeader>
                        <Skeleton className="h-8 w-full" />
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <>
            <DocumentUploadDialog
                open={isUploadDialogOpen}
                onOpenChange={setIsUploadDialogOpen}
                remission={selectedRemission}
                uploadType={uploadDialogType}
                onComplete={() => setSelectedRemission(null)}
            />
            {selectedRemission && (
                <ScheduleAppointmentDialog
                    open={isScheduling}
                    onOpenChange={setIsScheduling}
                    remissionId={selectedRemission.id}
                    onComplete={() => {
                        setIsScheduling(false);
                        setSelectedRemission(null);
                    }}
                />
            )}
            <div className="container mx-auto py-6 space-y-6">
                <div>
                    <h1 className="text-3xl font-bold font-headline">Gestión de Remisiones Externas</h1>
                    <p className="text-muted-foreground">
                        Aquí puedes ver y gestionar todas las solicitudes de estudios externos.
                    </p>
                </div>

                <Card>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/50 hover:bg-muted/50">
                                    <TableHead className="p-2" style={{ width: '80px' }}>
                                       <div className='font-bold w-full px-2 text-muted-foreground'>Estado</div>
                                    </TableHead>
                                    <TableHead className="p-2">Paciente</TableHead>
                                    <TableHead className="p-2">Estudio Remitido</TableHead>
                                    <TableHead className="p-2" style={{ width: '130px' }}>Documentos</TableHead>
                                    <TableHead className="p-2" style={{ width: '150px' }}>Fechas</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {remissions.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-24 text-center">
                                            No se encontraron remisiones.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    remissions.map((remission) => {
                                        const currentStatus = statusConfig[remission.status] || statusConfig.Pendiente;
                                        const urls = remission.remissionFileUrls;
                                        const appointmentDate = remission.appointmentDate ? remission.appointmentDate.toDate() : null;
                                        const diagnosisDesc = remission.diagnosis.description.length > 45 
                                            ? `${remission.diagnosis.description.substring(0, 45)}...`
                                            : remission.diagnosis.description;

                                        return (
                                            <TableRow key={remission.id}>
                                                 <TableCell className="p-2 align-top">
                                                    {remission.status === 'Pendiente' ? (
                                                        <AlertDialog>
                                                            <AlertDialogTrigger asChild>
                                                                <button className={cn("w-full flex flex-col items-center justify-center font-bold text-xs rounded-md px-1 py-1 transition-all h-[92px] outline-none", currentStatus.style, "cursor-pointer hover:opacity-90 active:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2")}>
                                                                    <currentStatus.icon className="h-5 w-5" />
                                                                    <span className="uppercase mt-1">{currentStatus.label}</span>
                                                                </button>
                                                            </AlertDialogTrigger>
                                                            <AlertDialogContent>
                                                                <AlertDialogHeader>
                                                                    <AlertDialogTitle>Gestionar Autorización</AlertDialogTitle>
                                                                    <AlertDialogDescription>
                                                                        Seleccione el método para solicitar la autorización de esta remisión.
                                                                    </AlertDialogDescription>
                                                                </AlertDialogHeader>
                                                                <AlertDialogFooter className="grid grid-cols-2 gap-4 pt-4">
                                                                    <AlertDialogAction asChild>
                                                                        <Button variant="outline" onClick={() => handleRequestAuthorization(remission)}>
                                                                            <Mail className="mr-2 h-4 w-4" />
                                                                            Solicitar a EPS
                                                                        </Button>
                                                                    </AlertDialogAction>
                                                                    <AlertDialogAction asChild>
                                                                        <Button onClick={() => handleGenerateAuthorization(remission.id)} disabled={generatingPdf === remission.id}>
                                                                            {generatingPdf === remission.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Download className="mr-2 h-4 w-4" />}
                                                                            Autorización Propia
                                                                        </Button>
                                                                    </AlertDialogAction>
                                                                </AlertDialogFooter>
                                                            </AlertDialogContent>
                                                        </AlertDialog>
                                                    ) : (
                                                        <button
                                                            className={cn(
                                                                "w-full flex flex-col items-center justify-center font-bold text-xs rounded-md px-1 py-1 transition-all h-[92px] outline-none",
                                                                currentStatus.style,
                                                                remission.status !== 'Realizado' && remission.status !== 'Vencido' ? "cursor-pointer hover:opacity-90 active:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" : "cursor-default"
                                                            )}
                                                            onClick={() => handleStatusClick(remission)}
                                                            disabled={remission.status === 'Realizado' || remission.status === 'Vencido'}
                                                        >
                                                            <currentStatus.icon className="h-5 w-5" />
                                                            <span className="uppercase mt-1">{currentStatus.label}</span>
                                                            {appointmentDate && (remission.status === 'Programado' || remission.status === 'Realizado') && (
                                                                <div className="flex items-center flex-col gap-0.5 text-xs font-semibold mt-1.5">
                                                                    <div className='flex items-center gap-1.5'><Clock className="h-3 w-3" /><span>{format(appointmentDate, 'dd/MMM')}</span></div>
                                                                    <span>{format(appointmentDate, 'hh:mm a')}</span>
                                                                </div>
                                                            )}
                                                        </button>
                                                    )}
                                                </TableCell>
                                                <TableCell className="p-2 align-top">
                                                    <div className="space-y-1">
                                                        <div className="font-bold uppercase text-base">{remission.patient.fullName}</div>
                                                        <div className="text-sm text-muted-foreground flex items-center gap-x-3">
                                                            <span className="flex items-center gap-1.5"><Fingerprint className="h-4 w-4"/>{remission.patient.idType} {remission.patient.id}</span>
                                                            {remission.patient.birthDate && <span className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4"/> {remission.patient.birthDate}</span>}
                                                        </div>
                                                         <div className="text-sm text-muted-foreground flex items-center gap-1.5">
                                                            <Building className="h-4 w-4"/> {remission.patient.entidad}
                                                        </div>
                                                        <div className="text-sm text-muted-foreground flex items-center gap-1.5 pt-0.5">
                                                             <Stethoscope className="h-4 w-4 shrink-0" />
                                                             <span className="font-semibold truncate" title={remission.diagnosis.description}>{diagnosisDesc}</span>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="p-2 align-top">
                                                    <div className="space-y-1">
                                                        <div className="font-bold uppercase text-base">{remission.studies[0]?.nombre}</div>
                                                        <div className="text-sm font-medium text-muted-foreground">
                                                            CUPS: {remission.studies[0]?.cups}
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="p-2 align-top">
                                                     <div className="grid grid-cols-3 gap-1">
                                                        <DocumentButton label="NC" fullLabel="Nota de Cargo" url={urls.notaCargoUrl} />
                                                        <DocumentButton label="OM" fullLabel="Orden Médica" url={urls.ordenMedicaUrl} />
                                                        <DocumentButton label="EVO" fullLabel="Evolución" url={urls.evolucionUrl} />
                                                        <DocumentButton label="AUT" fullLabel="Autorización" url={urls.authorizationUrl} />
                                                        <DocumentButton label="REC" fullLabel="Recordatorio" url={urls.recordatorioUrl} />
                                                        <DocumentButton label="INF" fullLabel="Informe" url={urls.informeUrl} />
                                                    </div>
                                                </TableCell>
                                               <TableCell className="p-2 font-medium text-xs align-top">
                                                    <div className="flex flex-col gap-0.5">
                                                        {remission.createdAt && <div className="font-semibold text-red-600">Crea: {format(remission.createdAt.toDate(), 'dd/MM/yy HH:mm')}</div>}
                                                        {remission.autorizadoAt && <div className="text-teal-600">Aut: {format(remission.autorizadoAt.toDate(), 'dd/MM/yy HH:mm')}</div>}
                                                        {remission.realizadoAt && <div className="text-indigo-600">Realiz: {format(remission.realizadoAt.toDate(), 'dd/MM/yy HH:mm')}</div>}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        </>
    );
}
    

    

    

    


"use client";

import * as React from 'react';
import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { collection, query, onSnapshot, orderBy, where, Timestamp, limit as firestoreLimit, startAfter, getDocs, DocumentSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Study, GeneralService, UserProfile, Modality, StudyStatus, OperationalStatus, StudyWithCompletedBy, ContrastType, OrderData, SubServiceArea } from '@/lib/types';
import { useAuth } from '@/context/auth-context';
import { GeneralServices, Modalities, UserRoles } from '@/lib/types';
import { startOfDay, endOfDay } from 'date-fns';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from "@/components/ui/button";
import { Separator } from '@/components/ui/separator';
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from '@/lib/utils';
import { StudyDialog } from '@/components/app/study-dialog';
import { EditStudyDialog } from '@/components/app/edit-study-dialog';
import { StudyTable } from '@/components/app/study-table';
import { Search, UploadCloud, Loader2, ShieldPlus, FileClock, FileCheck2, Paperclip, Check, AlertCircle, LogOut, LogIn, UserCheck, UserX, Activity, ListChecks, Hourglass, LogOutIcon, Eye, Syringe, User, LifeBuoy, Beaker, AlertTriangle, X } from 'lucide-react';
import type { DateRange } from "react-day-picker";
import { createStudyAction, updateUserOperationalStatusAction, setStudyContrastAction, searchStudiesAction, setActiveOperatorAction } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { HospitalIcon } from '@/components/icons/hospital-icon';
import { UciIcon } from '@/components/icons/uci-icon';
import { CextIcon } from '@/components/icons/cext-icon';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ImpersonationDialog } from '@/components/app/impersonation-dialog';
import { OperatorSelectionDialog } from '@/components/app/operator-selection-dialog';
import { AssignOperatorDialog } from '@/components/app/assign-operator-dialog';
import { useShiftChangeReminder } from '@/hooks/use-shift-change-reminder';
import { HelpTutorialDialog } from '@/components/app/help-tutorial-dialog';
import { tutorialData } from '@/lib/tutorial-data';
import { CreatininePromptDialog } from '@/components/app/creatinine-prompt-dialog';
import { ServiceSelectionDialog } from '@/components/app/service-selection-dialog';
import { ModalityIcon } from '@/components/icons/modality-icon';
import { ViewModeSwitch } from '@/components/app/view-mode-switch';
import { SelectStudiesDialog } from '@/components/app/select-studies-dialog';
import { extractOrderData } from '@/ai/flows/extract-order-flow';
import { RmnChoiceDialog } from '@/components/app/rmn-choice-dialog';
import { RemissionRequestDialog } from '@/components/app/remission-request-dialog';


const ALL_FILTER = "TODOS";
const ALL_SERVICES: (GeneralService | typeof ALL_FILTER)[] = [ALL_FILTER, ...[...GeneralServices].sort()];
const ALL_MODALITIES: (Modality | typeof ALL_FILTER)[] = [ALL_FILTER, ...[...Modalities.filter(m => m !== 'MAMO' && m !== 'DENSITOMETRIA')].sort()];


const serviceIcons: Record<GeneralService | 'TODOS', React.ElementType> = {
  "URG": ShieldPlus,
  "HOSP": HospitalIcon,
  "UCI": UciIcon,
  "C.EXT": CextIcon,
  "TODOS": ShieldPlus,
};

const serviceDisplayNames: Record<GeneralService | 'TODOS', string> = {
  "URG": "URGENCIAS",
  "HOSP": "HOSPITALIZACIÓN",
  "UCI": "UCI",
  "C.EXT": "C. EXTERNA",
  "TODOS": "TODOS",
};


const modalityIcons: Record<Modality | 'TODOS', React.ElementType> = {
    ECO: () => <ModalityIcon className="h-6 w-6 text-muted-foreground" />,
    RX: () => <ModalityIcon className="h-6 w-6 text-muted-foreground" />,
    TAC: () => <ModalityIcon className="h-6 w-6 text-muted-foreground" />,
    RMN: () => <ModalityIcon className="h-6 w-6 text-muted-foreground" />,
    MAMO: () => <svg />,
    DENSITOMETRIA: () => <svg />,
    TODOS: () => <ModalityIcon className="h-6 w-6 text-muted-foreground" />,
};

const modalityDisplayNames: Record<Modality | 'TODOS', string> = {
  ECO: "ECOGRAFIA", RX: "RAYOS X", TAC: "TOMOGRAFIA", RMN: "R. MAGNETICA", MAMO: "MAMOGRAFIA", DENSITOMETRIA: "DENSITOMETRIA", TODOS: "TODOS",
};


type SummaryCounts = {
    services: Record<GeneralService | 'TODOS', number>;
    modalities: Record<Modality | 'TODOS', number>;
};

type FilteredSummary = {
    pending: number;
    completed: number;
};


type ReportSummaryCounts = {
    pending: number;
    completed: number;
};

type ActiveFilters = {
    service: GeneralService | typeof ALL_FILTER;
    modality: Modality | typeof ALL_FILTER;
    status: StudyStatus[];
};

function UnifiedControlPanel({ 
    onManualRequest, 
    userProfile, 
    currentProfile,
    summary, 
    activeFilters, 
    onFilterToggle,
    onAiExtraction,
    aiLoading,
}) {
    const { isImpersonating, stopImpersonating } = useAuth();
    const [dragging, setDragging] = useState(false);
    const [newPatientId, setNewPatientId] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (files: FileList | null) => {
        if (!files || files.length === 0) return;
        onAiExtraction(files[0]);
    };
    
    const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
        const items = event.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const file = items[i].getAsFile();
                if (file) {
                    event.preventDefault(); 
                    onAiExtraction(file);
                }
            }
        }
    };

    const handleDragEnter = (e: React.DragEvent<HTMLElement>) => { e.preventDefault(); e.stopPropagation(); if (!aiLoading) setDragging(true); };
    const handleDragLeave = (e: React.DragEvent<HTMLElement>) => { e.preventDefault(); e.stopPropagation(); setDragging(false); };
    const handleDragOver = (e: React.DragEvent<HTMLElement>) => { e.preventDefault(); e.stopPropagation(); };
    const handleDrop = (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault(); e.stopPropagation(); setDragging(false);
        if (!aiLoading) { onAiExtraction(e.dataTransfer.files[0]); }
    };
    
    const canCreateRequest = useMemo(() => {
        if (!currentProfile) return false;
        const allowedRoles: UserProfile['rol'][] = ['administrador', 'adminisonista', 'enfermero', 'tecnologo', 'transcriptora'];
        return allowedRoles.includes(currentProfile.rol);
    }, [currentProfile]);

    const canEnterId = useMemo(() => {
        if (!currentProfile) return false;
        const allowedRoles: UserProfile['rol'][] = ['administrador', 'adminisonista', 'tecnologo', 'transcriptora'];
        return allowedRoles.includes(currentProfile.rol);
    }, [currentProfile]);
    
    const getPlaceholderText = () => {
      if(!canEnterId) return "Arrastre o pegue un archivo aquí";
      return "Crear solicitud...";
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (currentProfile?.rol === 'enfermero') {
        if (e.key === 'Enter') e.preventDefault(); return;
      }
      if (e.key === 'Enter' && newPatientId) { 
        onManualRequest(newPatientId); setNewPatientId(''); 
      }
    }

    const handleIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (currentProfile?.rol === 'enfermero') return;
        setNewPatientId(e.target.value.replace(/[^0-9]/g, ''));
    }
    
    const isServiceFilterDisabled = currentProfile?.rol === 'adminisonista';

    const FilterPopover = ({ title, type, options, activeValue, iconMap, nameMap, disabled = false }: { title:string, type: 'service' | 'modality', options: readonly any[], activeValue: string, iconMap: any, nameMap?: any, disabled?: boolean }) => (
      <div>
          <label className="text-xs font-semibold text-muted-foreground px-1">{title}</label>
          <Popover>
              <PopoverTrigger asChild disabled={disabled}>
                  <button disabled={disabled} className={cn("flex items-center gap-2 p-2 rounded-lg border bg-muted text-center transition-all w-full justify-between h-16 mt-1", disabled ? "cursor-not-allowed" : "hover:bg-muted/90", activeValue !== 'TODOS' && "border-2 border-primary")}>
                      <div className="flex items-center gap-2">
                        {React.createElement(iconMap[activeValue] || iconMap.TODOS, { className: cn("h-7 w-7", activeValue === 'TODOS' ? "text-muted-foreground" : "text-primary") })}
                        <span className="font-semibold text-base">{nameMap ? nameMap[activeValue] : activeValue}</span>
                      </div>
                      <span className="font-bold text-2xl text-foreground">{type === 'service' ? summary.services[activeValue as GeneralService] : summary.modalities[activeValue as Modality]}</span>
                  </button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-1">
                  <div className="flex flex-col gap-1">
                    {options.map((option) => (
                       <Button key={option} variant={activeFilters.service === option || activeFilters.modality === option ? 'default' : 'ghost'} className="justify-start" onClick={() => onFilterToggle(type, option)}>
                          {nameMap ? nameMap[option] : option}
                          {(activeFilters.service === option || activeFilters.modality === option) && <Check className="ml-auto h-4 w-4" />}
                       </Button>
                    ))}
                  </div>
              </PopoverContent>
          </Popover>
      </div>
    );
    
    return (
        <>
        <Card className="shadow-sm h-full flex flex-col">
            <CardHeader className="p-4 pb-2">
                <div className="flex justify-between items-center">
                    <CardTitle className="font-headline text-lg">Panel de Control</CardTitle>
                    {currentProfile?.rol === 'administrador' && <ViewModeSwitch activeView="imaging" />}
                </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 p-4 flex-grow">
                <div 
                    onDragEnter={canCreateRequest ? handleDragEnter : undefined}
                    onDragLeave={canCreateRequest ? handleDragLeave : undefined}
                    onDragOver={canCreateRequest ? handleDragOver : undefined}
                    onDrop={canCreateRequest ? handleDrop : undefined}
                    className={cn("relative flex flex-col items-center justify-center w-full border-2 border-dashed rounded-lg transition-colors py-2 px-1 min-h-[68px]", dragging ? "border-solid bg-muted-foreground/20 border-muted-foreground/50" : "bg-background", aiLoading ? "cursor-not-allowed" : "", !canCreateRequest && "opacity-50 pointer-events-none")}>
                     {aiLoading ? (
                        <div className="flex flex-col items-center justify-center text-center h-full w-full absolute inset-0 bg-background/80 backdrop-blur-sm z-10">
                            <Loader2 className="h-8 w-8 text-primary animate-spin" /><p className="mt-2 text-sm font-semibold text-foreground">Procesando...</p>
                        </div>
                    ) : (
                        <div className="w-full">
                            <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => handleFileChange(e.target.files)} accept=".pdf,.png,.jpg,.jpeg" disabled={aiLoading || !canCreateRequest}/>
                             <div className="relative w-full flex items-center">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input id="new-request-id" placeholder={getPlaceholderText()} value={newPatientId} onChange={handleIdChange} onKeyDown={handleKeyDown} onPaste={handlePaste} className="pl-9 pr-10 border-0 focus-visible:ring-0 shadow-none bg-transparent placeholder:text-foreground/60"/>
                                <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 hover:bg-primary/20 hover:text-current" onClick={() => fileInputRef.current?.click()} disabled={aiLoading || !canCreateRequest} aria-label="Cargar archivo"><Paperclip className="h-4 w-4" /></Button>
                            </div>
                           {canEnterId && <span className="text-xs text-muted-foreground mt-1 text-center block">(Arrastre un archivo, pegue una imagen, o ingrese un ID y presione Enter)</span>}
                        </div>
                    )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                   <FilterPopover title="Servicio" type="service" options={ALL_SERVICES} activeValue={activeFilters.service} iconMap={serviceIcons} nameMap={serviceDisplayNames} disabled={isServiceFilterDisabled} />
                   <FilterPopover title="Modalidad" type="modality" options={ALL_MODALITIES} activeValue={activeFilters.modality} iconMap={modalityIcons} nameMap={modalityDisplayNames}/>
                </div>
            </CardContent>
        </Card>
        </>
    );
}

function DailySummaryWidget({ dutyUsers, allUsers, onStatusChange, onStatusFilterToggle, filteredSummary, reportSummary, activeFilters, selectedOperator }) {
    const { currentProfile } = useAuth();
    const { toast } = useToast();
    const [loading, setLoading] = useState<Record<string, boolean>>({});
    const [assignTechnologistOpen, setAssignTechnologistOpen] = useState(false);
    const [assignRadiologistOpen, setAssignRadiologistOpen] = useState(false);

    const handleStatusToggle = async (userId: string, currentStatus: OperationalStatus, isEco: boolean) => {
        let newStatus: OperationalStatus;
        if (isEco) {
            newStatus = currentStatus === 'Disponible' ? 'No Disponible' : 'Disponible';
        } else {
            if(currentStatus === 'En Cirugía') { newStatus = 'Disponible'; } 
            else if (currentStatus === 'No Disponible') { newStatus = 'Disponible'; } 
            else { newStatus = 'En Cirugía'; }
        }
        
        setLoading(prev => ({ ...prev, [userId]: true }));
        const result = await updateUserOperationalStatusAction(userId, newStatus);
        if (result.success) {
            toast({ title: 'Estado Actualizado', description: `El estado del personal ha sido actualizado.` });
            if (currentProfile && userId === currentProfile.uid) { onStatusChange(newStatus); }
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.error });
        }
        setLoading(prev => ({ ...prev, [userId]: false }));
    };

    const handleAssignOperator = async (role: 'tecnologo' | 'transcriptora', operatorName: string) => {
        const userToUpdate = role === 'tecnologo' ? dutyUsers.rxTechnologist : dutyUsers.ecoTranscriptionist;
        if (!userToUpdate) return;
        
        setLoading(prev => ({ ...prev, [userToUpdate.uid]: true }));

        const result = await setActiveOperatorAction(userToUpdate.uid, operatorName);
        if (result.success) {
            toast({ title: 'Operador Asignado', description: `${operatorName} ahora está de turno.` });
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.error });
        }

        setLoading(prev => ({ ...prev, [userToUpdate.uid]: false }));
        setAssignTechnologistOpen(false);
        setAssignRadiologistOpen(false);
    }

    const rxTechnologist = dutyUsers.rxTechnologist;
    const ecoTranscriptionist = dutyUsers.ecoTranscriptionist;
    
    const canManageTechnologist = currentProfile?.rol === 'tecnologo' || currentProfile?.rol === 'administrador';
    const canManageRadiologist = currentProfile?.rol === 'transcriptora' || currentProfile?.rol === 'administrador';

    const onDutyRxOperator = rxTechnologist?.operadorActivo;
    const onDutyEcoOperator = ecoTranscriptionist?.operadorActivo;

    const InfoCard = ({ title, value, icon: Icon, color, onClick, isButton = false, isActive = false }: { title: string, value: number, icon: React.ElementType, color: string, onClick?: () => void, isButton?: boolean, isActive?: boolean }) => {
        const Wrapper = isButton && onClick ? 'button' : 'div';
        return ( <Wrapper onClick={onClick} className={cn("flex items-center p-3 rounded-lg bg-muted border transition-all h-full justify-center w-full text-left", isButton && "hover:bg-muted/90", isActive && "ring-2 ring-primary")}> <Icon className={cn("h-6 w-6 mr-3", color)} /> <div> <p className="text-xs text-muted-foreground">{title}</p> <p className="text-xl font-bold">{value}</p> </div> </Wrapper> );
    };
    
    const StatusButton = ({ user, serviceName }: { user: UserProfile | undefined, serviceName: string}) => {
        const isRx = serviceName === 'Rayos X';
        const isEco = serviceName === 'Ecografía';
        const status = user?.operationalStatus || 'NO ASIGNADO';
        
        let bgColor = 'bg-gray-400';
        if (status === 'Disponible') bgColor = 'bg-green-600 hover:bg-green-700';
        else if (status === 'En Cirugía') bgColor = 'bg-orange-500 hover:bg-orange-600';
        else if (status === 'No Disponible') bgColor = 'bg-red-600 hover:bg-red-700';
        
        let buttonText = status;
        if (isRx && status === 'Disponible') buttonText = 'Disponible';
        else if (isRx && status !== 'Disponible') buttonText = 'En Cirugía';

        const canToggle = (canManageTechnologist && isRx) || (canManageRadiologist && isEco);
        
        const handleClick = () => {
            if (canToggle && user) {
                handleStatusToggle(user.uid, user.operationalStatus!, isEco);
            }
        };

        return (
            <button
                disabled={!canToggle || !user || loading[user.uid]}
                onClick={handleClick}
                className={cn("flex flex-col p-3 rounded-lg text-white transition-all h-full justify-center w-full", bgColor, !canToggle && "cursor-not-allowed")}
            >
                <p className="font-bold uppercase tracking-wider text-white/80 text-xs">{serviceName}</p>
                <p className="text-lg font-bold">{buttonText}</p>
            </button>
        );
    };

    const OperatorDisplay = ({ operator, onClick, role, canChange }: { operator?: string | null, onClick: () => void, role: 'tecnologo' | 'transcriptora', canChange: boolean }) => {
    if (role === 'tecnologo') {
        return (
            <div className="flex items-center gap-1.5">
                <div className="bg-primary text-primary-foreground p-1.5 rounded-full">
                    <ModalityIcon className="h-4 w-4" />
                </div>
                <span className="text-foreground">RAYOS X: </span>
                {canChange ? (
                    <button onClick={onClick} className="font-bold hover:underline" disabled={!operator && !canChange}>
                        {operator || 'Asignar'}
                    </button>
                ) : (
                    <span className="font-bold">{operator || 'No Asignado'}</span>
                )}
            </div>
        );
    }

    return (
        <div className="flex items-center gap-1.5">
            <User className="h-4 w-4 text-green-600" />
            <span>ECO: </span>
            {canChange ? (
                <button onClick={onClick} className="font-bold hover:underline" disabled={!operator && !canChange}>
                    {operator || 'Asignar'}
                </button>
            ) : (
                <span className="font-bold">{operator || 'No Asignado'}</span>
            )}
        </div>
    );
};
    

    return (
        <>
        <Card className="shadow-sm h-full flex flex-col">
            <CardHeader className="p-4 pb-2">
                <CardTitle className="font-headline text-lg">Resumen de Hoy</CardTitle>
                <div className="text-xs text-muted-foreground font-medium min-h-[32px] flex flex-row items-center justify-start flex-wrap gap-x-4 gap-y-1">
                   {onDutyRxOperator && <OperatorDisplay operator={onDutyRxOperator} onClick={() => setAssignTechnologistOpen(true)} role="tecnologo" canChange={currentProfile?.rol === 'administrador'} />}
                   {onDutyEcoOperator && <OperatorDisplay operator={onDutyEcoOperator} onClick={() => setAssignRadiologistOpen(true)} role="transcriptora" canChange={canManageRadiologist} />}
                </div>
            </CardHeader>
            <CardContent className="p-4 flex-grow">
                 <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 h-full">
                    <div className="lg:col-span-1 space-y-3 flex flex-col">
                        <StatusButton user={rxTechnologist} serviceName="Rayos X" />
                        <StatusButton user={ecoTranscriptionist} serviceName="Ecografía" />
                    </div>
                    <div className="lg:col-span-2 grid grid-cols-2 gap-3">
                        <InfoCard title="Pendientes" value={filteredSummary.pending} icon={Hourglass} color="text-red-500" onClick={() => onStatusFilterToggle('Pendiente')} isButton={true} isActive={activeFilters.status.includes('Pendiente')}/>
                        <InfoCard title="Completados" value={filteredSummary.completed} icon={ListChecks} color="text-green-600" onClick={() => onStatusFilterToggle('Completado')} isButton={true} isActive={activeFilters.status.includes('Completado')}/>
                        <InfoCard title="Pend. Lectura" value={reportSummary.pending} icon={FileClock} color="text-orange-600" onClick={() => onStatusFilterToggle('Completado')} isButton={true} isActive={activeFilters.status.length === 1 && activeFilters.status[0] === 'Completado'}/>
                        <InfoCard title="Realizados" value={reportSummary.completed} icon={FileCheck2} color="text-green-700" onClick={() => onStatusFilterToggle('Leído')} isButton={true} isActive={activeFilters.status.includes('Leído')}/>
                    </div>
                </div>
            </CardContent>
        </Card>
         <AssignOperatorDialog
            open={assignTechnologistOpen}
            onOpenChange={setAssignTechnologistOpen}
            title="Asignar Tecnólogo de Turno"
            description="Seleccione el tecnólogo que estará a cargo de los estudios de Rayos X."
            operators={[...new Set(allUsers.filter(u => u.rol === 'tecnologo').flatMap(u => u.operadores || []))]}
            onAssign={op => handleAssignOperator('tecnologo', op)}
         />
         <AssignOperatorDialog
            open={assignRadiologistOpen}
            onOpenChange={setAssignRadiologistOpen}
            title="Asignar Radiólogo de Turno"
            description="Seleccione el radiólogo que estará a cargo de las ecografías."
            operators={[...new Set(allUsers.filter(u => u.rol === 'transcriptora').flatMap(u => u.operadores || []))]}
            onAssign={op => handleAssignOperator('transcriptora', op)}
         />
        </>
    );
}

function ShiftReminderDialog({ show, onConfirm }: { show: boolean; onConfirm: () => void }) {
  return (<AlertDialog open={show} onOpenChange={(open) => !open && onConfirm()}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="flex items-center gap-2"><AlertCircle className="text-amber-500 h-6 w-6" /><span>Recordatorio de Cambio de Turno</span></AlertDialogTitle><AlertDialogDescription className="pt-2">Son las 7:00. Por favor, asegúrate de que el operador de turno correcto esté seleccionado para continuar registrando las órdenes a su nombre.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogAction onClick={onConfirm}>Entendido</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>);
}

function AlarmDialog({ alarm, onClose }: { alarm: any; onClose: () => void; }) {
  return (<AlertDialog open={!!alarm} onOpenChange={(open) => !open && onClose()}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="flex items-center gap-2 text-red-600"><AlertTriangle className="h-8 w-8" /><span className="text-2xl">¡ALARMA GENERAL!</span></AlertDialogTitle><AlertDialogDescription className="pt-4 text-lg">Alarma activada por <span className="font-bold">{alarm?.triggeredBy?.name}</span> ({alarm?.triggeredBy?.rol}).<br/>Por favor, responda a la emergencia.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogAction onClick={onClose} className="bg-red-600 hover:bg-red-700">Entendido</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>);
}

function DuplicateStudyDialog({ open, onOpenChange, onConfirm, studyName, patientName }: { open: boolean, onOpenChange: (open: boolean) => void, onConfirm: () => void, studyName: string, patientName: string }) {
    return (<AlertDialog open={open} onOpenChange={onOpenChange}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="text-amber-500 h-6 w-6" /><span>Advertencia de Solicitud Duplicada</span></AlertDialogTitle><AlertDialogDescription className="pt-2">Ya existe una solicitud para el estudio <span className="font-bold">{studyName}</span> para el paciente <span className="font-bold">{patientName}</span> creada hace menos de 24 horas.<br/><br/>¿Está seguro de que desea crear esta nueva solicitud?</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={onConfirm}>Sí, crear igualmente</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>);
}

export default function DashboardPage() {
  const { user, userProfile, currentProfile, setUserProfile, isImpersonating, selectedOperator } = useAuth();
  const { toast } = useToast();
  
  const [liveStudies, setLiveStudies] = useState<StudyWithCompletedBy[]>([]);
  const [searchedStudies, setSearchedStudies] = useState<StudyWithCompletedBy[] | null>(null);
  const [dutyUsers, setDutyUsers] = useState<{ rxTechnologist: UserProfile | undefined, ecoTranscriptionist: UserProfile | undefined }>({ rxTechnologist: undefined, ecoTranscriptionist: undefined });
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [lastVisible, setLastVisible] = useState<DocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(true);
  
  const { showReminder, confirmReminder } = useShiftChangeReminder(!!user);
  
  const getInitialFilters = useCallback((profile: UserProfile | null) => {
    const filters: ActiveFilters = { service: 'TODOS', modality: 'TODOS', status: [] };
    if (!profile) return filters;
    const { rol, servicioAsignado } = profile;
    if (rol === 'tecnologo') { filters.modality = 'RX'; } 
    else if (rol === 'transcriptora') { filters.modality = 'ECO'; } 
    else if (rol === 'enfermero' && GeneralServices.includes(servicioAsignado as any)) { filters.service = servicioAsignado as GeneralService; } 
    else if (rol === 'adminisonista') { filters.service = 'C.EXT'; }
    return filters;
  }, []);
  
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(getInitialFilters(currentProfile));
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingStudy, setEditingStudy] = useState<Study | null>(null);
  const [initialDialogData, setInitialDialogData] = useState<Partial<Study> | undefined>(undefined);
  const [isSummaryVisible, setIsSummaryVisible] = useState(true);
  
  const [creatininePromptOpen, setCreatininePromptOpen] = useState(false);
  const [serviceSelectionOpen, setServiceSelectionOpen] = useState(false);
  const [pendingOrderData, setPendingOrderData] = useState<OrderData | null>(null);
  const [activeAlarm, setActiveAlarm] = useState<any | null>(null);
  const [selectStudiesOpen, setSelectStudiesOpen] = useState(false);

  const [duplicateWarningOpen, setDuplicateWarningOpen] = useState(false);
  const [duplicateStudyInfo, setDuplicateStudyInfo] = useState<{ studyName: string, patientName: string } | null>(null);
  const [pendingDuplicateData, setPendingDuplicateData] = useState<OrderData | null>(null);

  const [rmnChoiceOpen, setRmnChoiceOpen] = useState(false);
  const [pendingRmnData, setPendingRmnData] = useState<OrderData | null>(null);
  const [remissionDialogOpen, setRemissionDialogOpen] = useState(false);
  const [remissionStudyData, setRemissionStudyData] = useState<Study | null>(null);
  const [initialRemissionFile, setInitialRemissionFile] = useState<File | null>(null);


  useEffect(() => {
    document.body.classList.add('theme-yellow');
    document.body.classList.remove('theme-blue');
    return () => {
      document.body.classList.remove('theme-yellow');
    };
  }, []);
  
  useEffect(() => {
    if (currentProfile) { setActiveFilters(getInitialFilters(currentProfile)); }
  }, [currentProfile, isImpersonating, getInitialFilters]);
  
  useEffect(() => {
    if (!user) {
      setLiveStudies([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const baseQuery = query(collection(db, "studies"), orderBy("requestDate", "desc"), firestoreLimit(35));
    const unsubscribe = onSnapshot(baseQuery, (querySnapshot) => {
      const newStudiesData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StudyWithCompletedBy));
      setLiveStudies(newStudiesData);
      setLastVisible(querySnapshot.docs[querySnapshot.docs.length - 1]);
      setHasMore(!querySnapshot.empty);
      setLoading(false);
    }, (error) => {
      if (error.code !== 'permission-denied') {
        console.error("Error fetching studies: ", error);
        toast({ variant: "destructive", title: "Error", description: "No se pudieron cargar los estudios." });
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user, toast]);

  useEffect(() => {
    if (!user) {
        setAllUsers([]);
        setDutyUsers({ rxTechnologist: undefined, ecoTranscriptionist: undefined });
        return;
    }
    const usersQuery = query(collection(db, "users"));
    const unsubscribeUsers = onSnapshot(usersQuery, (querySnapshot) => {
        const allUsersData: UserProfile[] = [];
        let tech: UserProfile | undefined, trans: UserProfile | undefined;
        querySnapshot.forEach((doc) => {
            const user = { uid: doc.id, ...doc.data() } as UserProfile;
            allUsersData.push(user);
            if (user.rol === 'tecnologo' && user.servicioAsignado === 'RX') { tech = user; }
            if (user.rol === 'transcriptora' && user.servicioAsignado === 'ECO') { trans = user; }
        });
        setAllUsers(allUsersData);
        setDutyUsers({ rxTechnologist: tech, ecoTranscriptionist: trans });
    }, (error) => {
        if (error.code === 'permission-denied') return;
        console.error("Error fetching users:", error);
    });
    
    let unsubscribeAlarms = () => {};
    if (currentProfile?.rol === 'enfermero') {
        const alarmsQuery = query(collection(db, 'generalAlarms'), where('createdAt', '>', Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000))), orderBy('createdAt', 'desc'), firestoreLimit(1));
        unsubscribeAlarms = onSnapshot(alarmsQuery, (snapshot) => {
            if (!snapshot.empty) { setActiveAlarm(snapshot.docs[0].data()); }
        }, (error) => {
            if (error.code === 'permission-denied') return;
            console.error("Error fetching alarms:", error);
        });
    }
    return () => { unsubscribeUsers(); unsubscribeAlarms(); };
  }, [user, currentProfile]);

    const studies = useMemo(() => searchedStudies ?? liveStudies, [searchedStudies, liveStudies]);

    const handleSearch = async (overrideDateRange?: DateRange) => {
        const currentRange = overrideDateRange || dateRange;

        if (currentRange?.from) {
            setIsSearching(true);
            setSearchedStudies(null); // Clear previous search/live data
            const from = startOfDay(currentRange.from);
            const to = currentRange.to ? endOfDay(currentRange.to) : endOfDay(currentRange.from);
            
            let q = query(
                collection(db, "studies"),
                where('requestDate', '>=', Timestamp.fromDate(from)),
                where('requestDate', '<=', Timestamp.fromDate(to)),
                orderBy('requestDate', 'desc')
            );
            
            try {
                const querySnapshot = await getDocs(q);
                const studiesData = querySnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as StudyWithCompletedBy));
                setSearchedStudies(studiesData);
                setHasMore(false);
            } catch (error) {
                console.error("Error fetching date range studies:", error);
                toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los estudios para ese rango de fechas.' });
                setSearchedStudies([]);
            }
            setIsSearching(false);
            return;
        }

        if (!searchTerm.trim()) {
            if (searchedStudies) { 
              setSearchedStudies(null); 
              setHasMore(true); 
              // Potentially re-fetch live studies if they were cleared
            }
            return;
        }
        setIsSearching(true);
        const result = await searchStudiesAction(searchTerm);
        if (result.success && result.data) {
            const studiesWithDates = result.data.map(study => ({...study, requestDate: study.requestDate ? Timestamp.fromDate(new Date(study.requestDate as any)) : null, completionDate: study.completionDate ? Timestamp.fromDate(new Date(study.completionDate as any)) : null, readingDate: study.readingDate ? Timestamp.fromDate(new Date(study.readingDate as any)) : null })) as StudyWithCompletedBy[];
            setSearchedStudies(studiesWithDates);
            setHasMore(false);
        } else {
            toast({ variant: 'destructive', title: 'Error en Búsqueda', description: result.error });
            setSearchedStudies([]);
        }
        setIsSearching(false);
    };

    const isSearchActive = useMemo(() => !!searchedStudies, [searchedStudies]);

    const clearSearch = () => { setSearchTerm(''); setDateRange(undefined); setSearchedStudies(null); setHasMore(true); }

    const handleAiExtraction = (file: File) => {
        if (!currentProfile) { toast({ variant: 'destructive', title: 'Error de Usuario', description: 'No se pudo cargar tu perfil. Intenta de nuevo.' }); return; }
        setAiLoading(true);
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async () => {
            try {
                const dataUri = reader.result as string;
                const result = await extractOrderData({ medicalOrderDataUri: dataUri });

                if (!result || result.studies.length === 0) {
                     throw new Error( 'No se encontraron estudios válidos en la orden.');
                }
                
                setPendingOrderData(result);
                setInitialRemissionFile(file); // Keep file for potential RMN remission

                if (result.studies.length > 1) {
                    setSelectStudiesOpen(true);
                } else if (result.studies[0]?.modality === 'RMN') {
                    setRmnChoiceOpen(true);
                    setPendingRmnData(result);
                } else {
                    const userRole = currentProfile?.rol;
                    if (userRole === 'tecnologo' || userRole === 'transcriptora') { setServiceSelectionOpen(true); } 
                    else if (result.requiresCreatinine) { setCreatininePromptOpen(true); } 
                    else { await handleCreateStudy(result); }
                }
            } catch (error: any) {
                console.error("AI Extraction Error:", error);
                toast({ variant: 'destructive', title: 'Error de Extracción', description: error.message || 'Ocurrió un error inesperado al procesar el archivo.' });
            } finally { setAiLoading(false); }
        };
        reader.onerror = () => { toast({ variant: 'destructive', title: 'Error', description: 'No se pudo leer el archivo.' }); setAiLoading(false); };
    };

    const handleCreateStudy = async (data: OrderData, options?: { creatinine?: number, service?: GeneralService, subService?: SubServiceArea, skipDuplicateCheck?: boolean }) => {
        if (!currentProfile) return;
        toast({ title: 'Procesando...', description: 'Creando las solicitudes...' });
        const creationResult = await createStudyAction(data, currentProfile, options);
        setPendingOrderData(null);
        if (creationResult.success) {
            toast({ title: 'Solicitudes Creadas Exitosamente', description: `${creationResult.studyCount} nuevas solicitudes han sido registradas.` });
        } else if ((creationResult as any).requiresConfirmation) {
            setPendingDuplicateData(data);
            setDuplicateStudyInfo({ studyName: (creationResult as any).duplicateStudyName || 'desconocido', patientName: data.patient.fullName, });
            setDuplicateWarningOpen(true);
            toast({ variant: 'destructive', title: 'Posible Duplicado', description: 'Se encontró una solicitud similar reciente.' });
        } else { toast({ variant: 'destructive', title: 'Error en Creación', description: creationResult.error }); }
    };
    
    const handleSelectedStudiesSubmit = async (selectedStudies: OrderData['studies']) => {
        if (pendingOrderData) {
            const newOrderData = { ...pendingOrderData, studies: selectedStudies };
            const containsRmn = selectedStudies.some(s => s.modality === 'RMN');

            if (containsRmn) {
                setPendingRmnData(newOrderData); // Keep data for next step
                setRmnChoiceOpen(true);
            } else {
                setPendingOrderData(newOrderData);
                const userRole = currentProfile?.rol;
                if (userRole === 'tecnologo' || userRole === 'transcriptora') {
                    setServiceSelectionOpen(true);
                } else if (newOrderData.requiresCreatinine) {
                    setCreatininePromptOpen(true);
                } else {
                    await handleCreateStudy(newOrderData);
                }
            }
        }
        setSelectStudiesOpen(false);
    };

    const handleRmnChoice = async (choice: 'order' | 'remission') => {
        setRmnChoiceOpen(false);
        if (!pendingRmnData) return;

        const rmnStudy = pendingRmnData.studies.find(s => s.modality === 'RMN');
        const otherStudies = pendingRmnData.studies.filter(s => s.modality !== 'RMN');

        if (otherStudies.length > 0) {
            const otherStudiesData = { ...pendingRmnData, studies: otherStudies };
            await handleCreateStudy(otherStudiesData);
        }

        if (rmnStudy) {
            const rmnOrderData = { ...pendingRmnData, studies: [rmnStudy] };
            if (choice === 'order') {
                const userRole = currentProfile?.rol;
                setPendingOrderData(rmnOrderData);
                if (userRole === 'tecnologo' || userRole === 'transcriptora') {
                    setServiceSelectionOpen(true);
                } else if (rmnOrderData.requiresCreatinine) {
                    setCreatininePromptOpen(true);
                } else {
                    await handleCreateStudy(rmnOrderData);
                }
            } else if (choice === 'remission') {
                const tempStudyForRemission = {
                    ...rmnOrderData,
                    id: `temp_${Date.now()}`, 
                    status: 'Pendiente' as StudyStatus,
                    service: currentProfile?.servicioAsignado as GeneralService || 'C.EXT',
                    subService: currentProfile?.subServicioAsignado || 'AMB',
                    requestDate: Timestamp.now(),
                };
                setRemissionStudyData(tempStudyForRemission as unknown as Study);
                setRemissionDialogOpen(true);
            }
        }
        setPendingRmnData(null);
    };
    
    const handleCreatinineSubmit = async (creatinine: number) => {
        if (pendingOrderData) { await handleCreateStudy(pendingOrderData, { creatinine }); }
        setCreatininePromptOpen(false);
    };

    const handleServiceSelectionSubmit = async (service: GeneralService, subService: SubServiceArea) => {
        if (pendingOrderData) {
            if (pendingOrderData.requiresCreatinine) { setCreatininePromptOpen(true); } 
            else { await handleCreateStudy(pendingOrderData, { service, subService }); }
        }
        setServiceSelectionOpen(false);
    };

    const handleDuplicateConfirmation = () => {
        if (pendingDuplicateData) { handleCreateStudy(pendingDuplicateData, { skipDuplicateCheck: true }); }
        setDuplicateWarningOpen(false); setPendingDuplicateData(null); setDuplicateStudyInfo(null);
    };
  
    const studiesInDateRange = useMemo(() => {
        return searchedStudies ?? liveStudies;
    }, [searchedStudies, liveStudies]);

  const pendingStudiesSummary = useMemo<SummaryCounts>(() => {
    const initialSummary: SummaryCounts = {
        modalities: { ECO: 0, RX: 0, TAC: 0, RMN: 0, MAMO: 0, DENSITOMETRIA: 0, TODOS: 0 },
        services: { URG: 0, HOSP: 0, UCI: 0, "C.EXT": 0, TODOS: 0 },
    };
    const pendingStudies = liveStudies.filter(s => s.status === 'Pendiente' && s.studies.some(st => Modalities.includes(st.modality as any)));
    for (const service of GeneralServices) { initialSummary.services[service] = pendingStudies.filter(s => s.service === service).length; }
    for (const modality of Modalities) { initialSummary.modalities[modality] = pendingStudies.filter(s => s.studies.some(st => st.modality === modality)).length; }
    initialSummary.services.TODOS = pendingStudies.length;
    initialSummary.modalities.TODOS = pendingStudies.length;
    return initialSummary;
  }, [liveStudies]);
  
  const getFilteredStudiesForSummary = useCallback(() => {
    let relevantStudies = studiesInDateRange.filter(s => s.studies.some(st => Modalities.includes(st.modality as any)));
    if (activeFilters.service !== 'TODOS') { relevantStudies = relevantStudies.filter(s => s.service === activeFilters.service); }
    if (activeFilters.modality !== 'TODOS') { relevantStudies = relevantStudies.filter(s => s.studies.some(st => st.modality === activeFilters.modality)); }
    return relevantStudies;
  }, [studiesInDateRange, activeFilters]);

  const filteredSummary = useMemo<FilteredSummary>(() => {
    const relevantStudies = getFilteredStudiesForSummary();
    return relevantStudies.reduce((acc, study) => {
        if (study.status === 'Pendiente') { acc.pending++; } 
        else if (study.status === 'Completado' || study.status === 'Leído') { acc.completed++; }
        return acc;
    }, { pending: 0, completed: 0 });
  }, [getFilteredStudiesForSummary]);

  const reportSummary = useMemo<ReportSummaryCounts>(() => {
    const relevantStudies = getFilteredStudiesForSummary();
    return relevantStudies.reduce((acc, study) => {
        if (study.status === 'Completado') acc.pending++;
        if (study.status === 'Leído') acc.completed++;
        return acc;
    }, { pending: 0, completed: 0 });
  }, [getFilteredStudiesForSummary]);
  
  const filteredStudies = useMemo(() => {
    if (!currentProfile) return [];
    let filteredData = studiesInDateRange.filter(study => study.studies.some(s => Modalities.includes(s.modality as any)));
    if (activeFilters.status.length > 0) { filteredData = filteredData.filter(study => activeFilters.status.includes(study.status)); }
    if (activeFilters.modality !== ALL_FILTER) { filteredData = filteredData.filter(study => study.studies.some(s => s.modality === activeFilters.modality)); }
    if (activeFilters.service !== ALL_FILTER) { filteredData = filteredData.filter(study => study.service === activeFilters.service); }
    return filteredData;
  }, [studiesInDateRange, currentProfile, activeFilters]);
  
  const toggleFilter = useCallback((type: 'service' | 'modality', value: string) => {
    if (currentProfile?.rol === 'adminisonista' && type === 'service') { return; }
    setActiveFilters(prev => ({ ...prev, [type]: value, status: [] }));
  }, [currentProfile]);
  
  const toggleStatusFilter = useCallback((status: StudyStatus) => {
      setActiveFilters(prev => {
          const { service: currentService, modality: currentModality, status: prevStatus } = prev;
          const isCurrentlyActive = prevStatus.includes(status);
          let newStatusFilters: StudyStatus[] = [...prevStatus];
          if (isCurrentlyActive) {
            newStatusFilters = newStatusFilters.filter(s => s !== status);
            if(status === 'Completado' && newStatusFilters.includes('Leído')) { newStatusFilters = newStatusFilters.filter(s => s !== 'Leído'); }
          } else {
            if (status === 'Completado') { newStatusFilters = ['Completado']; } 
            else if (status === 'Pendiente'){ newStatusFilters = ['Pendiente']; } 
            else { newStatusFilters = [status]; }
          }
          return { service: currentService, modality: currentModality, status: newStatusFilters };
      });
  }, []);

  const handleManualRequest = useCallback((patientId: string) => {
    const existingStudies = studies.filter(s => s.patient.id === patientId).sort((a, b) => b.requestDate.toMillis() - a.requestDate.toMillis());
    const existingStudy = existingStudies[0];
    const initialData: Partial<Study> = existingStudy ? { id: '', ...existingStudy, patient: { ...existingStudy.patient, id: patientId }, studies: [] } : { patient: { fullName: '', id: patientId, entidad: '', birthDate: '' } , studies: [], diagnosis: { code: '', description: '' }, };
    setInitialDialogData(initialData);
    setDialogOpen(true);
}, [studies]);

  const handleEditStudy = useCallback((study: Study) => { setEditingStudy(study); setEditDialogOpen(true); }, []);

  const handleStaffStatusChange = (newStatus: UserProfile['operationalStatus']) => {
    if (userProfile && !isImpersonating) { setUserProfile({ ...userProfile, operationalStatus: newStatus }); }
  };

  const handleLoadMore = async () => {
    if (!lastVisible || searchedStudies) return;
    setIsLoadingMore(true);
    const nextQuery = query(collection(db, "studies"), orderBy("requestDate", "desc"), startAfter(lastVisible), firestoreLimit(50));
    try {
        const documentSnapshots = await getDocs(nextQuery);
        const newStudies = documentSnapshots.docs.map(doc => ({ id: doc.id, ...doc.data() } as StudyWithCompletedBy));
        setLiveStudies(prevStudies => [...prevStudies, ...newStudies]);
        const newLastVisible = documentSnapshots.docs[documentSnapshots.docs.length - 1];
        setLastVisible(newLastVisible);
        if (documentSnapshots.empty || !newLastVisible) { setHasMore(false); }
    } catch (error) {
        console.error("Error fetching more studies: ", error);
        toast({ variant: "destructive", title: "Error", description: "No se pudieron cargar más estudios." });
    }
    setIsLoadingMore(false);
  };
  
  const loadingSkeleton = (<div className='space-y-2 p-4'><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <OperatorSelectionDialog />
      <ShiftReminderDialog show={showReminder} onConfirm={confirmReminder} />
      <AlarmDialog alarm={activeAlarm} onClose={() => setActiveAlarm(null)} />
      <CreatininePromptDialog open={creatininePromptOpen} onOpenChange={setCreatininePromptOpen} onConfirm={handleCreatinineSubmit} onCancel={() => setPendingOrderData(null)}/>
      <ServiceSelectionDialog open={serviceSelectionOpen} onOpenChange={setServiceSelectionOpen} onConfirm={handleServiceSelectionSubmit} onCancel={() => setPendingOrderData(null)}/>
      <SelectStudiesDialog 
            open={selectStudiesOpen}
            onOpenChange={setSelectStudiesOpen}
            orderData={pendingOrderData}
            onConfirm={handleSelectedStudiesSubmit}
            onCancel={() => setPendingOrderData(null)}
      />
      {duplicateStudyInfo && (<DuplicateStudyDialog open={duplicateWarningOpen} onOpenChange={setDuplicateWarningOpen} onConfirm={handleDuplicateConfirmation} studyName={duplicateStudyInfo.studyName} patientName={duplicateStudyInfo.patientName}/>)}
      <RmnChoiceDialog open={rmnChoiceOpen} onOpenChange={setRmnChoiceOpen} onSelect={handleRmnChoice} />
      <RemissionRequestDialog 
        open={remissionDialogOpen} 
        onOpenChange={(isOpen) => {
            setRemissionDialogOpen(isOpen);
            if (!isOpen) {
                setInitialRemissionFile(null);
                setRemissionStudyData(null);
            }
        }} 
        studyData={remissionStudyData}
        initialFile={initialRemissionFile}
      />

      {isSummaryVisible && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <div className="lg:col-span-2">
                <UnifiedControlPanel 
                    onManualRequest={handleManualRequest} 
                    userProfile={userProfile} 
                    currentProfile={currentProfile}
                    summary={pendingStudiesSummary}
                    activeFilters={activeFilters}
                    onFilterToggle={toggleFilter}
                    onAiExtraction={handleAiExtraction}
                    aiLoading={aiLoading}
                />
              </div>
              <div className="lg:col-span-3">
                <DailySummaryWidget 
                    dutyUsers={dutyUsers} 
                    allUsers={allUsers}
                    onStatusChange={handleStaffStatusChange} 
                    onStatusFilterToggle={toggleStatusFilter}
                    filteredSummary={filteredSummary}
                    reportSummary={reportSummary}
                    activeFilters={activeFilters}
                    selectedOperator={selectedOperator}
                />
              </div>
        </div>
      )}
      
      <Card>
        <CardContent className="p-0">
          {(loading && studies.length === 0) ? (loadingSkeleton) : (
            <Suspense fallback={loadingSkeleton}>
              <StudyTable 
                studies={filteredStudies} 
                userProfile={currentProfile}
                dateRange={dateRange}
                setDateRange={setDateRange}
                activeStatusFilters={activeFilters.status}
                setActiveStatusFilters={toggleStatusFilter}
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                onSearch={handleSearch}
                onClearSearch={clearSearch}
                isSearching={isSearching}
                isSearchActive={isSearchActive}
                isSummaryVisible={isSummaryVisible}
                setIsSummaryVisible={setIsSummaryVisible}
                onEditStudy={handleEditStudy}
                hasMore={hasMore}
                onLoadMore={handleLoadMore}
                isLoadingMore={isLoadingMore}
              />
            </Suspense>
          )}
        </CardContent>
      </Card>
      <StudyDialog open={dialogOpen} onOpenChange={setDialogOpen} initialData={initialDialogData} mode="manual" />
      <EditStudyDialog open={editDialogOpen} onOpenChange={setEditDialogOpen} study={editingStudy} />
    </div>
  );
}

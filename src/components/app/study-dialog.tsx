
"use client";

import { useEffect, useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import { createStudyAction } from '@/app/actions';
import type { OrderData, Study } from '@/lib/types';
import { ALL_STUDIES } from '@/lib/studies-data';
import { ALL_CONSULTATIONS } from '@/lib/consultations-data';
import { usePathname } from 'next/navigation';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Trash2, PlusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ScrollArea } from '../ui/scroll-area';


const studySchema = z.object({
  nombre: z.string().min(1, "Nombre del estudio es requerido"),
  cups: z.string().min(1, "CUPS es requerido"),
  modality: z.string().min(1, "Modalidad es requerida"),
  details: z.string().optional(),
});

const formSchema = z.object({
  patient: z.object({
    fullName: z.string().min(1, "Nombre del paciente es requerido."),
    id: z.string().min(1, "ID del paciente es requerido."),
    idType: z.string().optional(),
    entidad: z.string().min(1, "Entidad es requerida."),
    birthDate: z.string().min(1, "Fecha de nacimiento es requerida."),
    sex: z.string().optional(),
  }),
  studies: z.array(studySchema).min(1, "Debe agregar al menos un estudio."),
  diagnosis: z.object({
    code: z.string().min(1, "Código de diagnóstico es requerido."),
    description: z.string().min(1, "La descripción del diagnóstico es requerida."),
  }),
});

export type StudyFormData = z.infer<typeof formSchema>;

interface StudyDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialData?: Partial<Study>;
    mode: 'manual' | 'edit';
}

export function StudyDialog({ open, onOpenChange, initialData, mode }: StudyDialogProps) {
    const { currentProfile } = useAuth();
    const { toast } = useToast();
    const pathname = usePathname();
    const [loading, setLoading] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);

    const isConsultationsModule = pathname.includes('/consultations');
    const searchList = isConsultationsModule ? ALL_CONSULTATIONS : ALL_STUDIES;

    const form = useForm<StudyFormData>({
        resolver: zodResolver(formSchema),
        mode: 'onChange',
    });
    
    useEffect(() => {
        if (open && mode === 'manual' && initialData) {
            const defaults: Partial<StudyFormData> = {
                patient: {
                    fullName: initialData.patient?.fullName || '',
                    id: initialData.patient?.id || '',
                    idType: initialData.patient?.idType || '',
                    entidad: initialData.patient?.entidad || '',
                    birthDate: initialData.patient?.birthDate || '',
                    sex: initialData.patient?.sex || '',
                },
                studies: initialData.studies || [],
                diagnosis: initialData.diagnosis || { code: '', description: '' },
            };
            form.reset(defaults);
        }
    }, [initialData, open, form, mode]);


    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: "studies"
    });

    const handleStudySelect = (study: { cups: string, nombre: string, modalidad?: string, especialidad?: string }) => {
        append({
            cups: study.cups,
            nombre: study.nombre,
            modality: study.modalidad || study.especialidad!,
            details: ''
        });
        setSearchOpen(false);
    };
    
    const onSubmit = async (data: StudyFormData) => {
        if (mode === 'edit') return; // Should be handled by EditStudyDialog

        setLoading(true);
        const result = await createStudyAction(data as OrderData, currentProfile);

        if (result.success) {
            toast({ title: 'Solicitudes Creadas', description: `${(result as any).studyCount} nuevas solicitudes han sido registradas.` });
            onOpenChange(false);
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.error });
        }
        
        setLoading(false);
    };

    if (mode === 'edit') {
      return null; // Edit functionality is now in EditStudyDialog
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[800px]">
                <DialogHeader>
                    <DialogTitle className="font-headline">Crear Nueva Solicitud Manual</DialogTitle>
                    <DialogDescription>Completa el siguiente formulario para registrar una o más solicitudes de estudio.</DialogDescription>
                </DialogHeader>
                
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <div className="max-h-[65vh] overflow-y-auto p-1 space-y-4">
                            <Card>
                                <CardContent className="p-4 pt-6 space-y-4">
                                    <FormLabel className="text-base font-semibold">Datos del Paciente</FormLabel>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <FormField control={form.control} name="patient.fullName" render={({ field }) => ( <FormItem><FormLabel>Nombre Completo</FormLabel><FormControl><Input placeholder="Nombre y apellidos..." {...field} /></FormControl><FormMessage /></FormItem> )}/>
                                        <div className="grid grid-cols-2 gap-2">
                                            <FormField control={form.control} name="patient.id" render={({ field }) => ( <FormItem><FormLabel>ID Paciente</FormLabel><FormControl><Input placeholder="Número..." {...field} /></FormControl><FormMessage /></FormItem> )}/>
                                            <FormField control={form.control} name="patient.idType" render={({ field }) => ( <FormItem><FormLabel>Tipo ID</FormLabel><FormControl><Input placeholder="CC, TI, RC..." {...field} /></FormControl><FormMessage /></FormItem> )}/>
                                        </div>
                                        <FormField control={form.control} name="patient.entidad" render={({ field }) => ( <FormItem><FormLabel>Entidad (EPS)</FormLabel><FormControl><Input placeholder="EPS o aseguradora..." {...field} /></FormControl><FormMessage /></FormItem> )}/>
                                        <FormField control={form.control} name="patient.birthDate" render={({ field }) => ( <FormItem><FormLabel>Fecha Nacimiento</FormLabel><FormControl><Input placeholder="DD/MM/AAAA" {...field} /></FormControl><FormMessage /></FormItem> )}/>
                                    </div>
                                </CardContent>
                            </Card>
                            
                            <Card>
                                <CardContent className="p-4 pt-6 space-y-4">
                                    <FormLabel className="text-base font-semibold">{isConsultationsModule ? 'Consultas Solicitadas' : 'Estudios Solicitados'}</FormLabel>
                                     <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                                        <PopoverTrigger asChild>
                                             <Button variant="outline" className="w-full justify-start text-left font-normal">
                                                <PlusCircle className="mr-2 h-4 w-4" />
                                                Añadir {isConsultationsModule ? 'consulta...' : 'estudio...'}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-[700px] p-0" align="start">
                                            <Command>
                                                <CommandInput placeholder={`Buscar ${isConsultationsModule ? 'consulta' : 'estudio'} por nombre o CUPS...`} />
                                                <CommandList>
                                                    <CommandEmpty>No se encontraron resultados.</CommandEmpty>
                                                     <ScrollArea className="h-72">
                                                        <CommandGroup>
                                                            {searchList.map((item) => (
                                                                <CommandItem
                                                                    key={item.cups}
                                                                    value={`${item.cups} ${item.nombre}`}
                                                                    onSelect={() => handleStudySelect(item)}
                                                                >
                                                                    <span>{item.cups} - {item.nombre}</span>
                                                                </CommandItem>
                                                            ))}
                                                        </CommandGroup>
                                                     </ScrollArea>
                                                </CommandList>
                                            </Command>
                                        </PopoverContent>
                                    </Popover>
                                    <div className="space-y-2">
                                        {fields.map((item, index) => (
                                            <div key={item.id} className="flex items-start gap-2 p-2 border rounded-lg bg-muted/50">
                                                <div className="flex-1">
                                                    <p className="font-semibold text-sm leading-tight">{item.cups} - {item.nombre}</p>
                                                    <p className="text-xs text-muted-foreground">{item.modality}</p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <FormField control={form.control} name={`studies.${index}.details`} render={({ field }) => ( 
                                                        <FormItem className="w-[180px]">
                                                            <FormControl><Input placeholder="Detalles (Opcional)" {...field} className="h-8 text-xs" /></FormControl>
                                                        </FormItem> 
                                                    )}/>
                                                    <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} className="h-8 w-8 shrink-0">
                                                        <Trash2 className="h-4 w-4 text-destructive" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <FormField control={form.control} name="studies" render={() => (<FormItem><FormMessage /></FormItem>)} />
                                </CardContent>
                            </Card>
                            
                            <Card>
                                <CardContent className="p-4 pt-6 space-y-4">
                                    <FormLabel className="text-base font-semibold">Diagnóstico</FormLabel>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <FormField control={form.control} name="diagnosis.code" render={({ field }) => ( <FormItem><FormLabel>Código CIE-10</FormLabel><FormControl><Input placeholder="Ej: I639" {...field} /></FormControl><FormMessage /></FormItem> )}/>
                                        <FormField control={form.control} name="diagnosis.description" render={({ field }) => ( <FormItem><FormLabel>Descripción Diagnóstico</FormLabel><FormControl><Input placeholder="Descripción del diagnóstico..." {...field} /></FormControl><FormMessage /></FormItem> )}/>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                        <DialogFooter className="pt-4">
                            <Button type="submit" disabled={loading} className="w-full text-base py-6">
                                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Crear Solicitud(es)"}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}

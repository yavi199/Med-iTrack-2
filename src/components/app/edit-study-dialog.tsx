
"use client";

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useToast } from '@/hooks/use-toast';
import { updateStudyAction } from '@/app/actions';
import type { OrderData, Study } from '@/lib/types';
import { ALL_STUDIES } from '@/lib/studies-data';
import { ALL_CONSULTATIONS } from '@/lib/consultations-data';
import { usePathname } from 'next/navigation';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

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
  studies: z.array(studySchema).min(1, "Debe haber un estudio.").max(1, "Solo se puede editar un estudio a la vez."),
  diagnosis: z.object({
    code: z.string().min(1, "Código de diagnóstico es requerido."),
    description: z.string().min(1, "La descripción del diagnóstico es requerida."),
  }),
});

type EditStudyFormData = z.infer<typeof formSchema>;

interface EditStudyDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    study: Study | null;
}

export function EditStudyDialog({ open, onOpenChange, study }: EditStudyDialogProps) {
    const { toast } = useToast();
    const pathname = usePathname();
    const [loading, setLoading] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);

    const isConsultationsModule = pathname.includes('/consultations');
    const searchList = isConsultationsModule ? ALL_CONSULTATIONS : ALL_STUDIES;

    const form = useForm<EditStudyFormData>({
        resolver: zodResolver(formSchema),
        mode: 'onChange',
    });

    useEffect(() => {
        if (study && open) {
            form.reset({
                patient: {
                    fullName: study.patient.fullName || '',
                    id: study.patient.id || '',
                    idType: study.patient.idType || '',
                    entidad: study.patient.entidad || '',
                    birthDate: study.patient.birthDate || '',
                    sex: study.patient.sex || '',
                },
                studies: study.studies.map(s => ({
                    cups: s.cups || '',
                    nombre: s.nombre || '',
                    modality: s.modality || '',
                    details: s.details || '',
                })),
                diagnosis: {
                    code: study.diagnosis.code || '',
                    description: study.diagnosis.description || '',
                },
            });
        }
    }, [study, open, form]);

    const handleStudySelect = (selectedStudyData: { cups: string, nombre: string, modalidad?: string, especialidad?: string }) => {
        const currentDetails = form.getValues('studies.0.details');
        form.setValue('studies.0', {
            cups: selectedStudyData.cups,
            nombre: selectedStudyData.nombre,
            modality: selectedStudyData.modalidad || selectedStudyData.especialidad!,
            details: currentDetails
        }, { shouldValidate: true, shouldDirty: true });
        setSearchOpen(false);
    };

    const onSubmit = async (data: EditStudyFormData) => {
        if (!study) return;

        setLoading(true);
        const result = await updateStudyAction(study.id, data as OrderData);

        if (result.success) {
            toast({ title: 'Solicitud Actualizada', description: 'Los datos del estudio han sido guardados.' });
            onOpenChange(false);
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.error });
        }
        setLoading(false);
    };

    if (!study) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[800px]">
                <DialogHeader>
                    <DialogTitle className="font-headline">Editar Solicitud</DialogTitle>
                    <DialogDescription>Modifique los detalles de la solicitud y guarde los cambios.</DialogDescription>
                </DialogHeader>
                
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <div className="max-h-[65vh] overflow-y-auto p-1 space-y-4">
                            <Card>
                                <CardContent className="p-4 pt-6 space-y-4">
                                    <FormLabel className="text-base font-semibold">Datos del Paciente</FormLabel>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <FormField control={form.control} name="patient.fullName" render={({ field }) => ( <FormItem><FormLabel>Nombre Completo</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem> )}/>
                                        <div className="grid grid-cols-2 gap-2">
                                            <FormField control={form.control} name="patient.id" render={({ field }) => ( <FormItem><FormLabel>ID Paciente</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem> )}/>
                                            <FormField control={form.control} name="patient.idType" render={({ field }) => ( <FormItem><FormLabel>Tipo ID</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem> )}/>
                                        </div>
                                        <FormField control={form.control} name="patient.entidad" render={({ field }) => ( <FormItem><FormLabel>Entidad (EPS)</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem> )}/>
                                        <FormField control={form.control} name="patient.birthDate" render={({ field }) => ( <FormItem><FormLabel>Fecha Nacimiento</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem> )}/>
                                    </div>
                                </CardContent>
                            </Card>
                            
                            <Card>
                                <CardContent className="p-4 pt-6 space-y-4">
                                    <FormLabel className="text-base font-semibold">{isConsultationsModule ? 'Consulta Solicitada' : 'Estudio Solicitado'}</FormLabel>
                                    <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" className={cn("w-full justify-start text-left font-normal truncate")}>
                                                <Search className="mr-2 h-4 w-4" />
                                                {form.watch('studies.0.nombre') || `Seleccionar ${isConsultationsModule ? 'consulta...' : 'estudio...'}`}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-[700px] p-0" align="start">
                                            <Command>
                                                <CommandInput placeholder={`Buscar ${isConsultationsModule ? 'consulta' : 'estudio'} por nombre o CUPS...`} />
                                                <CommandList>
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
                                    <FormField control={form.control} name="studies.0.details" render={({ field }) => ( 
                                        <FormItem>
                                            <FormLabel>Detalles Adicionales</FormLabel>
                                            <FormControl><Input placeholder="Ej: CON CONTRASTE" {...field} /></FormControl>
                                            <FormMessage />
                                        </FormItem> 
                                    )}/>
                                </CardContent>
                            </Card>
                            
                            <Card>
                                <CardContent className="p-4 pt-6 space-y-4">
                                    <FormLabel className="text-base font-semibold">Diagnóstico</FormLabel>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <FormField control={form.control} name="diagnosis.code" render={({ field }) => ( <FormItem><FormLabel>Código CIE-10</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem> )}/>
                                        <FormField control={form.control} name="diagnosis.description" render={({ field }) => ( <FormItem><FormLabel>Descripción Diagnóstico</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem> )}/>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                        <DialogFooter className="pt-4">
                            <Button type="submit" disabled={loading || !form.formState.isDirty} className="w-full text-base py-6">
                                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Actualizar Solicitud"}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
